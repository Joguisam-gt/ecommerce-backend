/**
 * Pruebas del CheckoutService (Fase 2): pagos, transaccion ACID con rollback,
 * facturacion automatica, idempotencia y consulta de facturas.
 *
 * Usa el CartPricingService REAL sobre repositorios en memoria, la pasarela
 * simulada, un runner transaccional que restaura snapshots al fallar y un
 * reloj fijo.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { PAYMENT_METHODS } from '../../src/constants/commerce.js';
import { ROLES } from '../../src/constants/roles.js';
import { PosController } from '../../src/controllers/pos.controller.js';
import { invoicesCollection } from '../../src/database/schemas/invoices.schema.js';
import { ordersCollection } from '../../src/database/schemas/orders.schema.js';
import { CheckoutDTO } from '../../src/dtos/checkout.dto.js';
import { InvoiceDTO } from '../../src/dtos/invoice.dto.js';
import { OrderDTO } from '../../src/dtos/order.dto.js';
import { pciGuard } from '../../src/middlewares/pci-guard.js';
import { validateCheckout } from '../../src/middlewares/validate-checkout.js';
import { AUDIT_ACTIONS, AuditService } from '../../src/services/audit.service.js';
import { CheckoutService } from '../../src/services/checkout.service.js';
import { InvoiceService } from '../../src/services/invoice.service.js';
import { SimulatedPaymentGateway } from '../../src/services/payments/payment-gateway.js';
import { fromCents } from '../../src/utils/money.js';
import { makeCommerceDeps, makeCoupon, makeProduct, jsonSchemaErrors } from '../helpers/checkout-fakes.js';
import { actorOf, makeUser, testConfig } from '../helpers/fixtures.js';
import { InMemoryAuditLogRepository, InMemoryUserRepository } from '../helpers/in-memory-repositories.js';

const NOW = new Date('2026-06-01T10:00:00Z');
const ORDER_SCHEMA = ordersCollection.validator.$jsonSchema;
const INVOICE_SCHEMA = invoicesCollection.validator.$and[0].$jsonSchema;

/**
 * Ejecuta pciGuard + validateCheckout como lo haria Express y construye el DTO.
 * @param {object} body
 * @param {string} [idempotencyKey]
 */
function dtoFrom(body, idempotencyKey) {
  const req = { body, query: {}, get: (name) => (name === 'Idempotency-Key' ? idempotencyKey : undefined) };
  for (const middleware of [pciGuard, validateCheckout]) {
    let received;
    middleware(req, {}, (arg) => {
      received = arg;
    });
    assert.equal(received, undefined, `el cuerpo de prueba deberia ser valido: ${JSON.stringify(received?.details)}`);
  }
  return CheckoutDTO.from(body, idempotencyKey);
}

const SHIPPING = Object.freeze({ line1: '5a Avenida 10-20 zona 1', city: 'Guatemala', country: 'gt' });

const codBody = (overrides = {}) => ({
  paymentMethod: PAYMENT_METHODS.CASH_ON_DELIVERY,
  customerName: 'Ana Perez',
  email: 'Ana.Perez@Example.com',
  phone: '+502 5555-1234',
  shippingAddress: { ...SHIPPING },
  nit: '1234567-k',
  ...overrides,
});

const cardBody = (token = 'tok_visa_approved_01', overrides = {}) => ({
  paymentMethod: PAYMENT_METHODS.CARD,
  payment: { paymentToken: token, last4: '4242', cardHolderName: 'Ana Perez', cardBrand: 'Visa' },
  ...overrides,
});

const transferBody = (transferAmount, overrides = {}) => ({
  paymentMethod: PAYMENT_METHODS.BANK_TRANSFER,
  payment: {
    bankName: 'Banrural',
    senderAccountNumber: '3-123-456789-0',
    transferAmount,
    authorizationNumber: 'AUT-998877',
    receiptUrl: 'https://banco.example.com/comprobantes/998877',
  },
  ...overrides,
});

/** Logger que captura las llamadas a error. */
function capturingLogger() {
  const errors = [];
  return { errors, debug() {}, info() {}, warn() {}, error: (message, context) => errors.push({ message, context }) };
}

describe('CheckoutService', () => {
  let user;
  let actor;
  let p1;
  let p2;
  let coupon;
  let deps;
  let gateway;
  let auditLogRepository;
  let logger;
  let service;

  /** Carrito por defecto: 2 x p1 + 2 x p2 con cupon PROMO10. */
  const seedCart = (overrides = {}) => ({
    userId: user._id,
    items: [
      { productId: p1._id, quantity: 2, addedAt: NOW },
      { productId: p2._id, quantity: 2, addedAt: NOW },
    ],
    couponCode: 'PROMO10',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  /**
   * Reconstruye el escenario con productos/cupon/carrito personalizados.
   * @param {{ p1?: object, p2?: object, coupon?: object, cart?: object | null }} [options]
   */
  function setup(options = {}) {
    user = makeUser({ firstName: 'Ana', lastName: 'Perez', email: 'ana@example.com' });
    actor = actorOf(user);
    p1 = makeProduct({ priceCents: 10000, taxRatePercent: 12, stock: 10, ...options.p1 });
    p2 = makeProduct({ priceCents: 5000, discountPercent: 10, taxRatePercent: 12, stock: 5, ...options.p2 });
    coupon = makeCoupon({ code: 'PROMO10', discountType: 'percentage', discountValue: 10, maxUses: 5, ...options.coupon });
    const cart = options.cart === null ? [] : [seedCart(options.cart)];

    deps = makeCommerceDeps({ products: [p1, p2], coupons: [coupon], carts: cart, clock: () => NOW });
    gateway = new SimulatedPaymentGateway();
    auditLogRepository = new InMemoryAuditLogRepository();
    logger = capturingLogger();
    service = new CheckoutService({
      ...deps,
      userRepository: new InMemoryUserRepository([user]),
      paymentGateway: gateway,
      auditService: new AuditService({ auditLogRepository, logger, clock: () => NOW }),
      storeConfig: testConfig.store,
      logger,
      clock: () => NOW,
    });
  }

  /** Liquidacion esperada del carrito actual (mismo servicio real). */
  const expectedPricing = async () =>
    (await deps.cartPricingService.priceCart(await deps.cartRepository.findByUserId(user._id), { userId: user._id })).pricing;

  /** Estado completo para comparar antes/despues de un fallo. */
  const stateOf = () => ({
    stockP1: deps.productRepository.peek(p1._id).stock,
    stockP2: deps.productRepository.peek(p2._id).stock,
    orders: deps.orderRepository.all().length,
    invoices: deps.invoiceRepository.all().length,
    orderSeq: deps.sequenceRepository.peek('order'),
    invoiceSeq: deps.sequenceRepository.peek('invoice'),
    couponUses: deps.couponRepository.peek(coupon._id).usedCount,
    cart: deps.cartRepository.peek(user._id),
  });

  /** Afirma que los documentos cumplen exactamente los $jsonSchema. */
  const assertSchemas = (order, invoice) => {
    assert.deepEqual(jsonSchemaErrors(order, ORDER_SCHEMA), []);
    assert.deepEqual(jsonSchemaErrors(invoice, INVOICE_SCHEMA), []);
  };

  /** Afirma que pedido, factura y priceCart cuadran. */
  const assertTotalsMatch = (order, invoice, pricing) => {
    assert.deepEqual(order.totals, pricing.totals);
    assert.equal(invoice.subtotalCents, pricing.totals.subtotalCents);
    assert.equal(invoice.discountTotalCents, pricing.totals.discountTotalCents);
    assert.equal(invoice.taxTotalCents, pricing.totals.taxTotalCents);
    assert.equal(invoice.grandTotalCents, pricing.totals.grandTotalCents);
    assert.equal(
      invoice.items.reduce((acc, item) => acc + item.totalCents, 0),
      invoice.grandTotalCents,
    );
  };

  beforeEach(() => setup());

  describe('checkout exitoso por metodo de pago', () => {
    it('contra entrega: pedido confirmed, factura pending_payment con NIT, stock, cupon y carrito', async () => {
      const pricing = await expectedPricing();
      const { order, invoice, replayed } = await service.checkout(actor, dtoFrom(codBody()));

      assert.equal(replayed, false);
      assert.equal(order.status, 'confirmed');
      assert.equal(order.channel, 'pos');
      assert.equal(order.currency, 'GTQ');
      assert.deepEqual(order.payment, { method: 'cash_on_delivery', status: 'cash_due', card: null, bankTransfer: null });
      assert.equal(order.orderNumber, 'ORD-00000001');
      assert.equal(invoice.invoiceNumber, 'FAC-00000001');
      assert.ok(order.invoiceId.equals(invoice._id));
      assert.ok(invoice.orderId.equals(order._id));
      assert.equal(invoice.orderNumber, order.orderNumber);
      assert.deepEqual(order.customer, { name: 'Ana Perez', email: 'ana.perez@example.com', phone: '+502 5555-1234' });
      assert.equal(order.shippingAddress.country, 'GT');
      assert.equal(order.coupon.code, 'PROMO10');
      assert.ok(order.coupon.couponId.equals(coupon._id));

      assert.equal(invoice.nit, '1234567-K');
      assert.equal(invoice.nitType, 'nit');
      assert.equal(invoice.status, 'pending_payment');
      assert.equal(invoice.entityName, 'Ana Perez');
      assert.equal(invoice.email, 'ana.perez@example.com');
      assert.deepEqual(invoice.issuedAt, NOW);

      assertTotalsMatch(order, invoice, pricing);
      assertSchemas(order, invoice);

      assert.equal(deps.productRepository.peek(p1._id).stock, 8);
      assert.equal(deps.productRepository.peek(p2._id).stock, 3);
      assert.equal(deps.couponRepository.peek(coupon._id).usedCount, 1);
      assert.deepEqual(deps.cartRepository.peek(user._id).items, []);
      assert.equal(deps.cartRepository.peek(user._id).couponCode, null);
      assert.ok(auditLogRepository.actions().includes(AUDIT_ACTIONS.ORDER_CREATED));
      const audit = auditLogRepository.entries.find((entry) => entry.action === AUDIT_ACTIONS.ORDER_CREATED);
      assert.deepEqual(audit.metadata, {
        orderNumber: 'ORD-00000001',
        paymentMethod: 'cash_on_delivery',
        grandTotalCents: pricing.totals.grandTotalCents,
      });
    });

    it('tarjeta: pedido paid, cargo por el total, factura paid con codigo de usuario y sin token', async () => {
      const pricing = await expectedPricing();
      const { order, invoice } = await service.checkout(actor, dtoFrom(cardBody()));

      assert.equal(order.status, 'paid');
      assert.equal(order.payment.status, 'captured');
      assert.equal(gateway.charges.length, 1);
      assert.equal(gateway.charges[0].amountCents, pricing.totals.grandTotalCents);
      assert.deepEqual(Object.keys(order.payment.card).sort(), [
        'authorizationCode',
        'brand',
        'gatewayTransactionId',
        'holderName',
        'last4',
      ]);
      assert.equal(order.payment.card.gatewayTransactionId, gateway.charges[0].transactionId);
      assert.match(order.payment.card.authorizationCode, /^[0-9A-F]{6}$/);
      assert.equal(JSON.stringify(order).includes('tok_visa_approved_01'), false);

      // Sin datos del cliente en el cuerpo: se usan los del usuario.
      assert.deepEqual(order.customer, { name: 'Ana Perez', email: 'ana@example.com', phone: null });
      assert.equal(order.shippingAddress, null);
      assert.equal(invoice.nit, user._id.toString());
      assert.equal(invoice.nitType, 'user_code');
      assert.equal(invoice.status, 'paid');
      assert.equal(invoice.shippingAddress, null);

      assertTotalsMatch(order, invoice, pricing);
      assertSchemas(order, invoice);
      assert.equal(deps.productRepository.peek(p1._id).stock, 8);
      assert.equal(deps.couponRepository.peek(coupon._id).usedCount, 1);
    });

    it('transferencia: pedido pending_verification con comprobante sin verificar', async () => {
      const pricing = await expectedPricing();
      const body = transferBody(fromCents(pricing.totals.grandTotalCents), { entityName: 'Comercial Perez S.A.', nit: 'CF' });
      const { order, invoice } = await service.checkout(actor, dtoFrom(body));

      assert.equal(order.status, 'pending_verification');
      assert.equal(order.payment.status, 'pending_verification');
      assert.equal(order.payment.card, null);
      assert.deepEqual(order.payment.bankTransfer, {
        bankName: 'Banrural',
        senderAccountNumber: '3-123-456789-0',
        transferAmountCents: pricing.totals.grandTotalCents,
        authorizationNumber: 'AUT-998877',
        receiptUrl: 'https://banco.example.com/comprobantes/998877',
        verifiedAt: null,
        verifiedBy: null,
      });
      assert.equal(invoice.status, 'pending_payment');
      assert.equal(invoice.nit, 'CF');
      assert.equal(invoice.entityName, 'Comercial Perez S.A.');
      assertTotalsMatch(order, invoice, pricing);
      assertSchemas(order, invoice);
      assert.equal(gateway.charges.length, 0);
    });

    it('numera de forma correlativa pedidos y facturas', async () => {
      await service.checkout(actor, dtoFrom(codBody()));
      await deps.cartRepository.docs.set(user._id.toString(), seedCart({ couponCode: null }));
      const second = await service.checkout(actor, dtoFrom(codBody()));
      assert.equal(second.order.orderNumber, 'ORD-00000002');
      assert.equal(second.invoice.invoiceNumber, 'FAC-00000002');
      assert.equal(second.order.coupon, null);
    });
  });

  describe('rollback transaccional', () => {
    it('stock agotado en el segundo producto durante la transaccion: revierte todo y anula el cargo', async () => {
      const before = stateOf();
      // Otra venta se lleva el stock entre priceCart y la transaccion.
      deps.transactionRunner.beforeRun = () => deps.productRepository.setStock(p2._id, 1);

      await assert.rejects(service.checkout(actor, dtoFrom(cardBody())), (error) => {
        assert.equal(error.status, 409);
        assert.deepEqual(error.body, {
          error: 'INSUFFICIENT_STOCK',
          availableStock: 1,
          productId: p2._id.toString(),
          message: error.message,
        });
        return true;
      });

      const after = stateOf();
      assert.equal(after.stockP1, before.stockP1, 'el stock del primer producto debe quedar intacto');
      assert.equal(after.stockP2, 1);
      assert.equal(after.orders, 0);
      assert.equal(after.invoices, 0);
      assert.equal(after.orderSeq, before.orderSeq);
      assert.equal(after.invoiceSeq, before.invoiceSeq);
      assert.equal(after.couponUses, before.couponUses);
      assert.deepEqual(after.cart, before.cart);
      assert.equal(deps.transactionRunner.stats.rolledBack, 1);

      assert.equal(gateway.charges.length, 1);
      assert.deepEqual(gateway.voided, [gateway.charges[0].transactionId]);
      const failure = auditLogRepository.entries.find((entry) => entry.action === AUDIT_ACTIONS.CHECKOUT_FAILED);
      assert.equal(failure.outcome, 'failure');
      assert.equal(failure.metadata.reason, 'INSUFFICIENT_STOCK');
      assert.equal(failure.metadata.chargeVoided, true);
    });

    it('el segundo producto se agota entre la vista previa y la transaccion (contra entrega): rollback completo', async () => {
      const before = stateOf();
      // Una venta concurrente deja al segundo producto sin stock justo antes de la transaccion.
      deps.transactionRunner.beforeRun = () => {
        deps.productRepository.peek(p2._id).stock = 0;
      };

      await assert.rejects(service.checkout(actor, dtoFrom(codBody())), (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.body.error, 'INSUFFICIENT_STOCK');
        assert.equal(error.body.availableStock, 0);
        return true;
      });
      // Todo vuelve al estado previo salvo el stock del segundo producto, que cambio la venta concurrente.
      assert.deepEqual(stateOf(), { ...before, stockP2: 0 });
    });

    it('decrementStock falla con stock suficiente (producto desactivado): 409 PRODUCT_UNAVAILABLE y rollback', async () => {
      const before = stateOf();
      const original = deps.productRepository.decrementStock.bind(deps.productRepository);
      deps.productRepository.decrementStock = async (productId, quantity, options) =>
        productId.equals(p2._id) ? false : original(productId, quantity, options);

      await assert.rejects(service.checkout(actor, dtoFrom(codBody())), { status: 409, code: 'PRODUCT_UNAVAILABLE' });
      assert.deepEqual(stateOf(), before);
    });

    it('fallo en incrementUsage del cupon: 409 COUPON_NO_LONGER_VALID y rollback completo', async () => {
      const before = stateOf();
      deps.couponRepository.failIncrement = true;

      await assert.rejects(service.checkout(actor, dtoFrom(cardBody())), { status: 409, code: 'COUPON_NO_LONGER_VALID' });
      assert.deepEqual(stateOf(), before);
      assert.deepEqual(gateway.voided, [gateway.charges[0].transactionId]);
    });

    it('cupon agotado por maxUses entre la vista previa y la transaccion', async () => {
      deps.transactionRunner.beforeRun = () => {
        deps.couponRepository.peek(coupon._id).usedCount = 5;
      };
      await assert.rejects(service.checkout(actor, dtoFrom(codBody())), { status: 409, code: 'COUPON_NO_LONGER_VALID' });
      assert.equal(deps.productRepository.peek(p1._id).stock, 10);
      assert.equal(deps.orderRepository.all().length, 0);
    });

    it('si la anulacion del cargo falla se registra sin datos sensibles y se relanza el error original', async () => {
      deps.transactionRunner.beforeRun = () => deps.productRepository.setStock(p2._id, 0);
      gateway.voidCharge = async () => {
        throw new Error('pasarela caida');
      };

      await assert.rejects(service.checkout(actor, dtoFrom(cardBody('tok_secret_value_99'))), { status: 409, code: 'INSUFFICIENT_STOCK' });
      assert.equal(logger.errors.length, 1);
      const logged = JSON.stringify(logger.errors);
      assert.equal(logged.includes('tok_secret_value_99'), false);
      assert.equal(logged.includes('4242'), false);
      const failure = auditLogRepository.entries.find((entry) => entry.action === AUDIT_ACTIONS.CHECKOUT_FAILED);
      assert.equal(failure.metadata.chargeVoided, false);
    });
  });

  describe('pagos rechazados y errores de pasarela', () => {
    it('tarjeta rechazada (tok_decline): 402 sin tocar stock ni pedidos', async () => {
      const before = stateOf();
      await assert.rejects(service.checkout(actor, dtoFrom(cardBody('tok_decline_0001'))), (error) => {
        assert.equal(error.status, 402);
        assert.equal(error.code, 'PAYMENT_DECLINED');
        assert.deepEqual(error.details, { declineCode: 'card_declined' });
        return true;
      });
      assert.deepEqual(stateOf(), before);
      assert.equal(deps.transactionRunner.stats.started, 0);
      assert.ok(auditLogRepository.actions().includes(AUDIT_ACTIONS.PAYMENT_DECLINED));
    });

    it('fondos insuficientes (tok_insufficient): 402 con su codigo', async () => {
      await assert.rejects(service.checkout(actor, dtoFrom(cardBody('tok_insufficient_01'))), {
        status: 402,
        details: { declineCode: 'insufficient_funds' },
      });
    });

    it('error de red de la pasarela (tok_error): 502 PAYMENT_GATEWAY_ERROR', async () => {
      const before = stateOf();
      await assert.rejects(service.checkout(actor, dtoFrom(cardBody('tok_error_network'))), {
        status: 502,
        code: 'PAYMENT_GATEWAY_ERROR',
      });
      assert.deepEqual(stateOf(), before);
    });
  });

  describe('reglas de negocio previas al cobro', () => {
    it('CART_EMPTY sin carrito o con carrito vacio', async () => {
      setup({ cart: null });
      await assert.rejects(service.checkout(actor, dtoFrom(codBody())), { status: 422, code: 'CART_EMPTY' });
      setup({ cart: { items: [] } });
      await assert.rejects(service.checkout(actor, dtoFrom(codBody())), { status: 422, code: 'CART_EMPTY' });
    });

    it('INSUFFICIENT_STOCK detectado por priceCart con el cuerpo de contrato', async () => {
      setup({ p2: { stock: 1 } });
      await assert.rejects(service.checkout(actor, dtoFrom(codBody())), (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.body.error, 'INSUFFICIENT_STOCK');
        assert.equal(error.body.availableStock, 1);
        return true;
      });
      assert.equal(deps.transactionRunner.stats.started, 0);
    });

    it('PRODUCT_UNAVAILABLE si un producto se desactivo', async () => {
      setup({ p2: { isActive: false } });
      await assert.rejects(service.checkout(actor, dtoFrom(codBody())), (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.code, 'PRODUCT_UNAVAILABLE');
        assert.deepEqual(error.details.productIds, [p2._id.toString()]);
        return true;
      });
    });

    it('COUPON_NO_LONGER_VALID con el motivo si el cupon dejo de ser valido', async () => {
      setup({ coupon: { isActive: false } });
      await assert.rejects(service.checkout(actor, dtoFrom(cardBody())), (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.code, 'COUPON_NO_LONGER_VALID');
        assert.equal(error.details.reason, 'COUPON_INACTIVE');
        return true;
      });
      assert.equal(gateway.charges.length, 0, 'no se cobra si el cupon no es valido');
    });

    it('PAYMENT_METHOD_NOT_ACCEPTED con los productos que no aceptan el metodo', async () => {
      setup({ p2: { acceptedPaymentMethods: ['cash_on_delivery'] } });
      await assert.rejects(service.checkout(actor, dtoFrom(cardBody())), (error) => {
        assert.equal(error.status, 422);
        assert.equal(error.code, 'PAYMENT_METHOD_NOT_ACCEPTED');
        assert.deepEqual(error.details.productIds, [p2._id.toString()]);
        return true;
      });
      assert.equal(gateway.charges.length, 0);
    });

    it('SHIPPING_ADDRESS_REQUIRED si algun producto no admite retiro en tienda', async () => {
      setup({ p1: { pickupAvailable: false } });
      await assert.rejects(service.checkout(actor, dtoFrom(cardBody())), { status: 422, code: 'SHIPPING_ADDRESS_REQUIRED' });
      assert.equal(gateway.charges.length, 0);

      const { order } = await service.checkout(actor, dtoFrom(cardBody(undefined, { shippingAddress: { ...SHIPPING } })));
      assert.equal(order.shippingAddress.city, 'Guatemala');
    });

    it('TRANSFER_AMOUNT_MISMATCH con esperado y recibido en decimales', async () => {
      const pricing = await expectedPricing();
      const received = fromCents(pricing.totals.grandTotalCents - 1);
      await assert.rejects(service.checkout(actor, dtoFrom(transferBody(received))), (error) => {
        assert.equal(error.status, 422);
        assert.equal(error.code, 'TRANSFER_AMOUNT_MISMATCH');
        assert.deepEqual(error.details, { expected: fromCents(pricing.totals.grandTotalCents), received });
        return true;
      });
      assert.equal(deps.orderRepository.all().length, 0);
    });
  });

  describe('idempotencia', () => {
    it('la misma clave devuelve el mismo pedido sin crear otro ni cobrar de nuevo', async () => {
      const key = 'checkout-key-0001';
      const first = await service.checkout(actor, dtoFrom(cardBody(), key));
      const stockAfterFirst = deps.productRepository.peek(p1._id).stock;

      const second = await service.checkout(actor, dtoFrom(cardBody(), key));
      assert.equal(second.replayed, true);
      assert.ok(second.order._id.equals(first.order._id));
      assert.ok(second.invoice._id.equals(first.invoice._id));
      assert.equal(deps.orderRepository.all().length, 1);
      assert.equal(deps.invoiceRepository.all().length, 1);
      assert.equal(gateway.charges.length, 1);
      assert.equal(deps.productRepository.peek(p1._id).stock, stockAfterFirst);
    });

    it('reusar la clave con otro metodo de pago es un conflicto', async () => {
      await service.checkout(actor, dtoFrom(codBody(), 'checkout-key-0002'));
      await assert.rejects(service.checkout(actor, dtoFrom(cardBody(), 'checkout-key-0002')), {
        status: 409,
        code: 'IDEMPOTENCY_KEY_CONFLICT',
      });
    });

    it('carrera con la misma clave: el indice unico gana, se devuelve el pedido existente y no se anula su cargo', async () => {
      const key = 'checkout-key-race';
      const first = await service.checkout(actor, dtoFrom(cardBody(), key));

      // Segunda peticion concurrente: no vio el pedido en el paso (a).
      deps.cartRepository.docs.set(user._id.toString(), seedCart({ couponCode: null }));
      const lookup = deps.orderRepository.findByUserAndIdempotencyKey.bind(deps.orderRepository);
      let calls = 0;
      deps.orderRepository.findByUserAndIdempotencyKey = async (...args) => (calls++ === 0 ? null : lookup(...args));
      const stockBefore = deps.productRepository.peek(p1._id).stock;

      const second = await service.checkout(actor, dtoFrom(cardBody(), key));
      assert.equal(second.replayed, true);
      assert.ok(second.order._id.equals(first.order._id));
      assert.equal(deps.orderRepository.all().length, 1);
      assert.equal(deps.productRepository.peek(p1._id).stock, stockBefore, 'el rollback devuelve el stock');
      // La pasarela deduplico por clave: es el mismo cargo del ganador, no se anula.
      assert.deepEqual(gateway.voided, []);
    });
  });

  describe('PosController', () => {
    /** Respuesta falsa que captura estado, cabeceras y cuerpo. */
    const fakeResponse = () => ({
      statusCode: 200,
      headers: {},
      body: undefined,
      set(name, value) {
        this.headers[name] = value;
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    });

    it('201 en compra nueva y 200 con Idempotent-Replayed en el reintento', async () => {
      const controller = new PosController({ checkoutService: service });
      const req = {
        body: cardBody(),
        user: actor,
        ip: '127.0.0.1',
        get: (name) => (name === 'Idempotency-Key' ? 'pos-key-000001' : undefined),
      };
      const res = fakeResponse();
      await controller.checkout(req, res);
      assert.equal(res.statusCode, 201);
      assert.equal(res.body.data.order.status, 'paid');
      assert.equal(res.body.data.invoice.status, 'paid');
      assert.equal(res.headers['Idempotent-Replayed'], undefined);

      const replay = fakeResponse();
      await controller.checkout(req, replay);
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.headers['Idempotent-Replayed'], 'true');
      assert.equal(replay.body.data.order.id, res.body.data.order.id);
    });
  });

  describe('DTOs de salida', () => {
    it('OrderDTO expone decimales y oculta datos de pasarela de la tarjeta', async () => {
      const { order, invoice } = await service.checkout(actor, dtoFrom(cardBody()));
      const dto = OrderDTO.from(order);
      assert.deepEqual(dto.payment.card, { brand: 'Visa', last4: '4242', holderName: 'Ana Perez' });
      assert.equal(JSON.stringify(dto).includes(order.payment.card.gatewayTransactionId), false);
      assert.equal(dto.totals.grandTotal, fromCents(order.totals.grandTotalCents));
      assert.equal(dto.coupon.discountValue, 10);

      const invoiceDto = InvoiceDTO.from(invoice);
      assert.equal(invoiceDto.grandTotal, dto.totals.grandTotal);
      assert.equal(invoiceDto.nitType, 'user_code');
      assert.equal(invoiceDto.orderNumber, order.orderNumber);
      assert.equal(typeof invoiceDto.items[0].total, 'number');
    });

    it('OrderDTO enmascara la cuenta de origen de la transferencia', async () => {
      const pricing = await expectedPricing();
      const { order } = await service.checkout(actor, dtoFrom(transferBody(fromCents(pricing.totals.grandTotalCents))));
      const dto = OrderDTO.from(order);
      assert.equal(dto.payment.bankTransfer.senderAccountNumber, '****7890');
      assert.equal(dto.payment.bankTransfer.transferAmount, fromCents(pricing.totals.grandTotalCents));
    });
  });
});

describe('InvoiceService', () => {
  const owner = makeUser();
  const stranger = makeUser();
  const admin = makeUser({ role: ROLES.ADMIN });
  let invoiceRepository;
  let service;
  let ownInvoice;
  let foreignInvoice;

  /** Factura minima de un usuario. */
  const invoiceFor = (userId, nit) => ({
    _id: new ObjectId(),
    invoiceNumber: `FAC-${new ObjectId().toString().slice(-8)}`,
    orderId: new ObjectId(),
    orderNumber: 'ORD-00000001',
    userId,
    nit,
    nitType: 'nit',
    entityName: 'Cliente',
    email: 'cliente@example.com',
    paymentMethod: 'card',
    shippingAddress: null,
    items: [],
    currency: 'GTQ',
    subtotalCents: 100,
    discountTotalCents: 0,
    taxTotalCents: 12,
    grandTotalCents: 112,
    status: 'paid',
    issuedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  });

  beforeEach(async () => {
    ({ invoiceRepository } = makeCommerceDeps({ clock: () => NOW }));
    service = new InvoiceService({ invoiceRepository });
    const session = {};
    ownInvoice = await invoiceRepository.insert(invoiceFor(owner._id, '1111111-1'), { session });
    foreignInvoice = await invoiceRepository.insert(invoiceFor(stranger._id, '2222222-2'), { session });
  });

  it('un usuario solo lista sus facturas aunque filtre por otro userId', async () => {
    const { items, total } = await service.listForActor(actorOf(owner), { page: 1, limit: 20, userId: stranger._id.toString() });
    assert.equal(total, 1);
    assert.ok(items[0]._id.equals(ownInvoice._id));
  });

  it('un usuario recibe 404 al pedir una factura ajena o inexistente', async () => {
    await assert.rejects(service.getForActor(actorOf(owner), foreignInvoice._id.toString()), { status: 404, code: 'INVOICE_NOT_FOUND' });
    await assert.rejects(service.getForActor(actorOf(owner), new ObjectId().toString()), { status: 404, code: 'INVOICE_NOT_FOUND' });
    const mine = await service.getForActor(actorOf(owner), ownInvoice._id.toString());
    assert.ok(mine._id.equals(ownInvoice._id));
  });

  it('un admin con invoices:manage ve todas y puede filtrar por usuario y NIT', async () => {
    const all = await service.listForActor(actorOf(admin), { page: 1, limit: 20 });
    assert.equal(all.total, 2);
    const byUser = await service.listForActor(actorOf(admin), { page: 1, limit: 20, userId: stranger._id.toString() });
    assert.equal(byUser.total, 1);
    const byNit = await service.listForActor(actorOf(admin), { page: 1, limit: 20, nit: '1111111-1' });
    assert.equal(byNit.total, 1);
    const foreign = await service.getForActor(actorOf(admin), foreignInvoice._id.toString());
    assert.ok(foreign._id.equals(foreignInvoice._id));
  });
});
