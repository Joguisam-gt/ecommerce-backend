/**
 * Pruebas de la conciliacion de transferencias bancarias (Fase 3, panel de administracion).
 *
 * Usa repositorios en memoria, el runner transaccional que restaura snapshots
 * al fallar y un reloj fijo. Cubre rechazo (pedido, stock, factura, cupon y
 * auditoria), rollback total, aprobacion, doble conciliacion, validadores,
 * DTO de la cola y controlador.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { AdminOrderController } from '../../src/controllers/admin-order.controller.js';
import { invoicesCollection } from '../../src/database/schemas/invoices.schema.js';
import { ordersCollection } from '../../src/database/schemas/orders.schema.js';
import { PendingTransferDTO, ReconcileOrderDTO } from '../../src/dtos/admin-order.dto.js';
import { AUDIT_ACTIONS } from '../../src/services/audit.service.js';
import { appendRejectionNote, OrderReconciliationService } from '../../src/services/order-reconciliation.service.js';
import { reconcileOrderSchema } from '../../src/validators/admin-order.validator.js';
import { validateSchema } from '../../src/validators/schema-validator.js';
import { adminActor, InMemoryInventoryStockRepository, RecordingAuditService } from '../helpers/admin-fakes.js';
import {
  InMemoryAdminCouponRepository,
  InMemoryAdminOrderRepository,
  makeBankTransferOrder,
  makeInvoiceForOrder,
} from '../helpers/admin-order-coupon-fakes.js';
import { InMemoryTransactionRunner, jsonSchemaErrors, makeCoupon, makeProduct } from '../helpers/checkout-fakes.js';

const NOW = new Date('2026-06-01T10:00:00Z');
const ORDER_SCHEMA = ordersCollection.validator.$jsonSchema;
const INVOICE_SCHEMA = invoicesCollection.validator.$and[0].$jsonSchema;
const CONTEXT = Object.freeze({ ip: '10.0.0.1', userAgent: 'node-test' });

describe('OrderReconciliationService', () => {
  let p1;
  let p2;
  let coupon;
  let order;
  let orders;
  let stock;
  let coupons;
  let runner;
  let audit;
  let service;

  /**
   * Construye el escenario: pedido por transferencia con 2 lineas (2 x p1, 3 x p2) y cupon.
   * @param {{ coupon?: object, order?: object, withCoupon?: boolean }} [options]
   */
  function setup(options = {}) {
    p1 = makeProduct({ stock: 8 });
    p2 = makeProduct({ stock: 2 });
    coupon = makeCoupon({ usedCount: 3, ...options.coupon });
    order = makeBankTransferOrder({
      products: [
        { product: p1, quantity: 2 },
        { product: p2, quantity: 3 },
      ],
      coupon: options.withCoupon === false ? null : coupon,
      overrides: options.order,
    });
    orders = new InMemoryAdminOrderRepository({ orders: [order], invoices: [makeInvoiceForOrder(order)] });
    stock = new InMemoryInventoryStockRepository([p1, p2]);
    coupons = new InMemoryAdminCouponRepository([coupon]);
    runner = new InMemoryTransactionRunner([orders, stock, coupons]);
    audit = new RecordingAuditService();
    service = new OrderReconciliationService({
      adminOrderRepository: orders,
      inventoryStockRepository: stock,
      adminCouponRepository: coupons,
      transactionRunner: runner,
      auditService: audit,
      clock: () => NOW,
    });
  }

  /** Estado completo para comparar antes y despues de un fallo. */
  const stateOf = () => ({
    order: structuredClone(orders.peekOrder(order._id)),
    invoice: structuredClone(orders.peekInvoice(order.invoiceId)),
    stockP1: stock.peek(p1._id).stock,
    stockP2: stock.peek(p2._id).stock,
    couponUses: coupons.peek(coupon._id).usedCount,
  });

  const reject = (reason = 'Comprobante ilegible') => ({ action: 'reject', reason });
  const approve = () => ({ action: 'approve', reason: null });

  beforeEach(() => setup());

  describe('rechazo (transaccion ACID)', () => {
    it('pedido rejected, stock devuelto por linea, factura anulada, cupon decrementado y auditoria', async () => {
      const result = await service.reconcile(adminActor, order._id.toString(), reject('Monto no recibido'), CONTEXT);

      const stored = orders.peekOrder(order._id);
      assert.equal(stored.status, 'rejected');
      assert.equal(stored.payment.status, 'rejected');
      assert.equal(stored.notes, 'Transferencia rechazada: Monto no recibido');
      assert.deepEqual(stored.updatedAt, NOW);
      assert.equal(stored.payment.bankTransfer.verifiedAt, null);

      assert.equal(stock.peek(p1._id).stock, 8 + 2);
      assert.equal(stock.peek(p2._id).stock, 2 + 3);

      const invoice = orders.peekInvoice(order.invoiceId);
      assert.equal(invoice.status, 'voided');
      assert.deepEqual(invoice.voidedAt, NOW);
      assert.equal(invoice.voidReason, 'Monto no recibido');

      assert.equal(coupons.peek(coupon._id).usedCount, 2);
      assert.equal(runner.stats.committed, 1);

      assert.equal(result.order.status, 'rejected');
      assert.equal(result.invoice.status, 'voided');
      assert.deepEqual(jsonSchemaErrors(stored, ORDER_SCHEMA), []);
      assert.deepEqual(jsonSchemaErrors(invoice, INVOICE_SCHEMA), []);

      assert.equal(audit.changes.length, 1);
      const change = audit.changes[0];
      assert.equal(change.action, AUDIT_ACTIONS.ORDER_PAYMENT_REJECTED);
      assert.equal(change.targetCollection, 'orders');
      assert.equal(change.targetId, order._id.toString());
      assert.equal(change.actor.id, adminActor.id);
      assert.deepEqual(change.context, CONTEXT);
      assert.equal(change.previousState.status, 'pending_verification');
      assert.equal(change.previousState.payment.status, 'pending_verification');
      assert.equal(change.newState.status, 'rejected');
      assert.equal(change.newState.payment.status, 'rejected');
      // La cuenta de origen se enmascara tambien en auditoria.
      assert.equal(change.previousState.payment.bankTransfer.senderAccountNumber, '****7890');
      assert.deepEqual(change.metadata.returnedLines, [
        { productId: p1._id.toString(), sku: p1.sku, quantity: 2 },
        { productId: p2._id.toString(), sku: p2.sku, quantity: 3 },
      ]);
      assert.equal(change.metadata.couponReleased, true);
      assert.equal(change.metadata.couponId, coupon._id.toString());
      assert.equal(change.metadata.invoiceStatus, 'voided');
      assert.equal(change.metadata.reason, 'Monto no recibido');
    });

    it('sin cupon no toca cupones; con usedCount 0 no baja de 0', async () => {
      setup({ withCoupon: false });
      await service.reconcile(adminActor, order._id.toString(), reject());
      assert.equal(coupons.peek(coupon._id).usedCount, 3);
      assert.equal(audit.changes[0].metadata.couponId, null);
      assert.equal(audit.changes[0].metadata.couponReleased, false);

      setup({ coupon: { usedCount: 0 } });
      await service.reconcile(adminActor, order._id.toString(), reject());
      assert.equal(coupons.peek(coupon._id).usedCount, 0);
      assert.equal(audit.changes[0].metadata.couponReleased, false);
    });

    it('conserva las notas previas y nunca supera 1000 caracteres', () => {
      assert.equal(appendRejectionNote('Entregar por la tarde', 'Sin fondos'), 'Entregar por la tarde\nTransferencia rechazada: Sin fondos');
      const long = appendRejectionNote('x'.repeat(1000), 'r'.repeat(500));
      assert.equal(long.length, 1000);
      assert.ok(long.endsWith(`Transferencia rechazada: ${'r'.repeat(500)}`));
    });
  });

  describe('rollback', () => {
    it('si falla la devolucion de stock de la segunda linea nada cambia y el runner reporta rolledBack', async () => {
      const before = stateOf();
      const original = stock.incrementStock.bind(stock);
      stock.incrementStock = async (productId, quantity, options) =>
        productId.equals(p2._id) ? false : original(productId, quantity, options);

      await assert.rejects(service.reconcile(adminActor, order._id.toString(), reject()), (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.code, 'RESTOCK_PRODUCT_NOT_FOUND');
        assert.equal(error.details.productId, p2._id.toString());
        return true;
      });

      assert.deepEqual(stateOf(), before);
      assert.equal(orders.peekOrder(order._id).status, 'pending_verification');
      assert.equal(orders.peekInvoice(order.invoiceId).status, 'pending_payment');
      assert.equal(stock.peek(p1._id).stock, 8, 'la primera linea ya devuelta se revierte');
      assert.equal(runner.stats.rolledBack, 1);
      assert.equal(runner.stats.committed, 0);
      assert.equal(audit.changes.length, 0, 'no se audita una transaccion abortada');
    });

    it('un error inesperado del driver en la segunda linea tambien revierte todo', async () => {
      const before = stateOf();
      const original = stock.incrementStock.bind(stock);
      stock.incrementStock = async (productId, quantity, options) => {
        if (productId.equals(p2._id)) throw new Error('WriteConflict');
        return original(productId, quantity, options);
      };
      await assert.rejects(service.reconcile(adminActor, order._id.toString(), reject()), /WriteConflict/);
      assert.deepEqual(stateOf(), before);
      assert.equal(runner.stats.rolledBack, 1);
    });

    it('producto eliminado del catalogo: 409 RESTOCK_PRODUCT_NOT_FOUND y rollback total', async () => {
      stock.docs.delete(p2._id.toString());
      await assert.rejects(service.reconcile(adminActor, order._id.toString(), reject()), {
        status: 409,
        code: 'RESTOCK_PRODUCT_NOT_FOUND',
      });
      assert.equal(orders.peekOrder(order._id).status, 'pending_verification');
      assert.equal(orders.peekInvoice(order.invoiceId).status, 'pending_payment');
      assert.equal(stock.peek(p1._id).stock, 8);
      assert.equal(coupons.peek(coupon._id).usedCount, 3);
    });
  });

  describe('aprobacion y doble conciliacion', () => {
    it('approve: pedido paid, pago verified con verifiedAt/verifiedBy y factura paid', async () => {
      const result = await service.reconcile(adminActor, order._id.toString(), approve(), CONTEXT);

      const stored = orders.peekOrder(order._id);
      assert.equal(stored.status, 'paid');
      assert.equal(stored.payment.status, 'verified');
      assert.deepEqual(stored.payment.bankTransfer.verifiedAt, NOW);
      assert.ok(stored.payment.bankTransfer.verifiedBy.equals(new ObjectId(adminActor.id)));
      assert.equal(orders.peekInvoice(order.invoiceId).status, 'paid');
      assert.equal(result.invoice.status, 'paid');
      assert.deepEqual(jsonSchemaErrors(stored, ORDER_SCHEMA), []);
      assert.deepEqual(jsonSchemaErrors(orders.peekInvoice(order.invoiceId), INVOICE_SCHEMA), []);

      // La aprobacion no toca stock ni cupon.
      assert.equal(stock.peek(p1._id).stock, 8);
      assert.equal(coupons.peek(coupon._id).usedCount, 3);

      const change = audit.changes[0];
      assert.equal(change.action, AUDIT_ACTIONS.ORDER_PAYMENT_APPROVED);
      assert.equal(change.previousState.status, 'pending_verification');
      assert.equal(change.newState.status, 'paid');
      assert.equal(change.metadata.invoiceStatus, 'paid');
    });

    it('doble conciliacion: la segunda responde 409 ORDER_NOT_PENDING_VERIFICATION sin cambios', async () => {
      await service.reconcile(adminActor, order._id.toString(), approve());
      const before = stateOf();

      await assert.rejects(service.reconcile(adminActor, order._id.toString(), approve()), {
        status: 409,
        code: 'ORDER_NOT_PENDING_VERIFICATION',
      });
      await assert.rejects(service.reconcile(adminActor, order._id.toString(), reject()), {
        status: 409,
        code: 'ORDER_NOT_PENDING_VERIFICATION',
      });
      assert.deepEqual(stateOf(), before, 'rechazar un pedido ya aprobado no devuelve stock');
      assert.equal(audit.changes.length, 1);
    });

    it('carrera: otro administrador concilia entre la lectura y la escritura -> 409 por la actualizacion condicional', async () => {
      const original = orders.findById.bind(orders);
      orders.findById = async (id, options) => {
        const doc = await original(id, options);
        orders.peekOrder(id).status = 'paid';
        return doc;
      };
      await assert.rejects(service.reconcile(adminActor, order._id.toString(), reject()), {
        status: 409,
        code: 'ORDER_NOT_PENDING_VERIFICATION',
      });
      assert.equal(stock.peek(p1._id).stock, 8);
      assert.equal(orders.peekInvoice(order.invoiceId).status, 'pending_payment');
      assert.equal(runner.stats.rolledBack, 1);
    });

    it('factura que ya no esta pendiente: approve aborta con 409 y revierte el pedido', async () => {
      orders.peekInvoice(order.invoiceId).status = 'voided';
      await assert.rejects(service.reconcile(adminActor, order._id.toString(), approve()), {
        status: 409,
        code: 'INVOICE_NOT_PENDING_PAYMENT',
      });
      assert.equal(orders.peekOrder(order._id).status, 'pending_verification');
      assert.equal(runner.stats.rolledBack, 1);
    });

    it('404 si el pedido no existe, 400 con id invalido y 409 si no es transferencia', async () => {
      await assert.rejects(service.reconcile(adminActor, new ObjectId().toString(), approve()), {
        status: 404,
        code: 'ORDER_NOT_FOUND',
      });
      await assert.rejects(service.reconcile(adminActor, 'no-es-un-id', approve()), { status: 400, code: 'INVALID_ID' });

      orders.peekOrder(order._id).payment.method = 'card';
      await assert.rejects(service.reconcile(adminActor, order._id.toString(), approve()), {
        status: 409,
        code: 'ORDER_NOT_PENDING_VERIFICATION',
      });
    });
  });

  describe('cola de verificacion', () => {
    it('lista solo transferencias pendientes y enmascara la cuenta de origen', async () => {
      const other = makeBankTransferOrder({ products: [{ product: p1, quantity: 1 }], overrides: { status: 'paid' } });
      orders.orders.set(other._id.toString(), other);

      const { items, total, page, limit } = await service.listPendingVerification({ page: 1, limit: 20 });
      assert.equal(total, 1);
      assert.deepEqual({ page, limit }, { page: 1, limit: 20 });

      const dto = PendingTransferDTO.from(items[0]);
      assert.equal(dto.orderNumber, order.orderNumber);
      assert.deepEqual(dto.payment.bankTransfer, {
        authorizationNumber: 'AUT-998877',
        bankName: 'Banrural',
        receiptUrl: 'https://banco.example.com/comprobantes/998877',
        transferAmount: order.totals.grandTotalCents / 100,
        senderAccountNumber: '****7890',
      });
      assert.equal(dto.totals.grandTotal, order.totals.grandTotalCents / 100);
      assert.equal(JSON.stringify(dto).includes('3-123-456789-0'), false);
    });
  });

  describe('AdminOrderController', () => {
    it('reconcile pasa actor, DTO normalizado y contexto; responde la orden y la factura', async () => {
      const controller = new AdminOrderController({ orderReconciliationService: service });
      const req = {
        user: adminActor,
        params: { id: order._id.toString() },
        body: { action: 'reject', reason: '  Comprobante   duplicado ' },
        ip: '10.0.0.9',
        get: (name) => (name === 'user-agent' ? 'agente' : undefined),
      };
      let payload;
      await controller.reconcile(req, { json: (body) => (payload = body) });
      assert.equal(payload.data.order.status, 'rejected');
      assert.equal(payload.data.invoice.status, 'voided');
      assert.equal(payload.data.invoice.voidReason, 'Comprobante duplicado');
      assert.equal(payload.data.order.payment.bankTransfer.senderAccountNumber, '****7890');
      assert.deepEqual(audit.changes[0].context, { ip: '10.0.0.9', userAgent: 'agente' });
    });
  });
});

describe('Validacion de la conciliacion', () => {
  it('reject exige motivo de 3 a 500 caracteres; approve no', () => {
    assert.deepEqual(validateSchema(reconcileOrderSchema, { action: 'approve' }), []);
    assert.deepEqual(validateSchema(reconcileOrderSchema, { action: 'reject', reason: 'Sin fondos' }), []);
    assert.equal(validateSchema(reconcileOrderSchema, { action: 'reject' })[0].field, 'reason');
    assert.equal(validateSchema(reconcileOrderSchema, { action: 'reject', reason: 'no' })[0].field, 'reason');
    assert.equal(validateSchema(reconcileOrderSchema, { action: 'reject', reason: 'x'.repeat(501) })[0].field, 'reason');
    assert.equal(validateSchema(reconcileOrderSchema, { action: 'cancel' })[0].field, 'action');
    assert.equal(validateSchema(reconcileOrderSchema, { action: 'approve', status: 'paid' })[0].message, 'Campo no permitido');
  });

  it('ReconcileOrderDTO normaliza el motivo', () => {
    assert.deepEqual(ReconcileOrderDTO.from({ action: 'reject', reason: '  a   b  c ' }), { action: 'reject', reason: 'a b c' });
    assert.deepEqual(ReconcileOrderDTO.from({ action: 'approve' }), { action: 'approve', reason: null });
  });
});
