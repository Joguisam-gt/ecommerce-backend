/**
 * Servicio de checkout del POS: cobro seguro, transaccion ACID de inventario
 * y facturacion automatica.
 *
 * Flujo (checkout):
 *   a) Idempotencia: si el usuario ya creo un pedido con la misma clave, se
 *      devuelve ese pedido y su factura (replayed) sin volver a cobrar.
 *   b-f) Validaciones de negocio FUERA de la transaccion: carrito no vacio,
 *      liquidacion con CartPricingService (mismo calculo que la vista previa),
 *      stock, cupon vigente, metodo de pago aceptado por cada producto,
 *      direccion de envio y monto exacto de la transferencia.
 *   g) Tarjeta: el cargo se hace ANTES de la transaccion, nunca dentro, porque
 *      withTransaction puede reintentar el callback y repetiria el cobro.
 *   h) Transaccion (todo o nada): descuento condicional de stock, uso del
 *      cupon, numeracion correlativa, pedido, factura y vaciado del carrito.
 *   i) Si la transaccion falla, se anula el cargo de tarjeta (compensacion) y
 *      se audita el fallo.
 *   j) Tras el commit se audita el pedido creado.
 *
 * PCI-DSS: el token de pago solo viaja a la pasarela; el pedido guarda marca,
 * ultimos 4, titular, codigo de autorizacion e id de transaccion.
 */
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import {
  INITIAL_INVOICE_STATUS,
  INITIAL_ORDER_STATUS,
  INITIAL_PAYMENT_STATUS,
  INVOICE_ENTITY_TYPES,
  NIT_TYPES,
  ORDER_CHANNELS,
  PAYMENT_METHODS,
} from '../constants/commerce.js';
import { HttpError } from '../utils/http-error.js';
import { fromCents } from '../utils/money.js';
import { toObjectId } from '../utils/object-id.js';
import { AUDIT_ACTIONS } from './audit.service.js';
import { CART_ISSUES } from './cart-pricing.service.js';

const ENTITY = 'order';

/** Codigo de MongoDB para violacion de indice unico. */
const MONGO_DUPLICATE_KEY = 11000;

/** Campos de una linea de pedido segun orders.schema.js (orderItem). */
const ORDER_ITEM_FIELDS = Object.freeze([
  'sku',
  'name',
  'quantity',
  'unitPriceCents',
  'discountPercent',
  'unitFinalPriceCents',
  'taxRatePercent',
  'subtotalCents',
  'productDiscountCents',
  'couponDiscountCents',
  'discountTotalCents',
  'taxCents',
  'grandTotalCents',
]);

/** Campos de los totales del pedido segun orders.schema.js. */
const ORDER_TOTAL_FIELDS = Object.freeze([
  'subtotalCents',
  'productDiscountCents',
  'couponDiscountCents',
  'discountTotalCents',
  'taxTotalCents',
  'grandTotalCents',
  'totalItemsCount',
]);

/**
 * Copia solo las claves indicadas.
 * @param {object} source
 * @param {readonly string[]} keys
 */
const pick = (source, keys) => Object.fromEntries(keys.map((key) => [key, source[key]]));

/**
 * 409 de cupon que dejo de ser valido entre el carrito y el pago.
 * @param {object} details
 */
const couponNoLongerValid = (details) =>
  new HttpError(409, 'El cupon del carrito ya no es valido', 'COUPON_NO_LONGER_VALID', details);

/**
 * Formatea un numero correlativo: PREFIJO-00000001.
 * @param {string} prefix
 * @param {number} seq
 */
const formatNumber = (prefix, seq) => `${prefix}-${String(seq).padStart(8, '0')}`;

/** Longitud maxima de customer.name y entityName en los $jsonSchema. */
const MAX_NAME_LENGTH = 160;

/**
 * Nombre completo del usuario (firstName y lastName admiten 80 cada uno: se recorta a 160).
 * @param {{ firstName: string, lastName: string }} user
 */
const fullNameOf = (user) => `${user.firstName} ${user.lastName}`.slice(0, MAX_NAME_LENGTH);

export class CheckoutService {
  #users;
  #carts;
  #products;
  #coupons;
  #orders;
  #invoices;
  #sequences;
  #pricing;
  #gateway;
  #transactions;
  #audit;
  #store;
  #logger;
  #now;

  /**
   * @param {{ userRepository: object, cartRepository: object, productRepository: object, couponRepository: object,
   *           orderRepository: object, invoiceRepository: object, sequenceRepository: object,
   *           cartPricingService: import('./cart-pricing.service.js').CartPricingService,
   *           paymentGateway: import('./payments/payment-gateway.js').PaymentGateway,
   *           transactionRunner: { run: (work: (session: object) => Promise<any>) => Promise<any> },
   *           auditService: import('./audit.service.js').AuditService,
   *           storeConfig: { currency: string, orderNumberPrefix: string, invoiceNumberPrefix: string },
   *           logger: object, clock?: () => Date }} deps
   */
  constructor({
    userRepository,
    cartRepository,
    productRepository,
    couponRepository,
    orderRepository,
    invoiceRepository,
    sequenceRepository,
    cartPricingService,
    paymentGateway,
    transactionRunner,
    auditService,
    storeConfig,
    logger,
    clock = () => new Date(),
  }) {
    this.#users = userRepository;
    this.#carts = cartRepository;
    this.#products = productRepository;
    this.#coupons = couponRepository;
    this.#orders = orderRepository;
    this.#invoices = invoiceRepository;
    this.#sequences = sequenceRepository;
    this.#pricing = cartPricingService;
    this.#gateway = paymentGateway;
    this.#transactions = transactionRunner;
    this.#audit = auditService;
    this.#store = storeConfig;
    this.#logger = logger;
    this.#now = clock;
  }

  /**
   * Confirma la compra del carrito del usuario autenticado.
   * @param {{ id: string, role: string }} actor req.user
   * @param {import('../dtos/checkout.dto.js').CheckoutDTO} dto
   * @param {{ ip?: string | null, userAgent?: string | null }} [context]
   * @returns {Promise<{ order: object, invoice: object, replayed: boolean }>}
   */
  async checkout(actor, dto, context = {}) {
    const userId = toObjectId(actor.id);

    // a) Reintento idempotente: mismo resultado, sin cobrar de nuevo.
    if (dto.idempotencyKey) {
      const replay = await this.#findReplay(userId, dto);
      if (replay) return replay;
    }

    // b) Usuario y carrito.
    const user = await this.#users.findById(userId);
    if (!user) throw HttpError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');
    const cart = await this.#carts.findByUserId(userId);
    if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
      throw HttpError.unprocessable('El carrito esta vacio', 'CART_EMPTY');
    }

    // c-f) Liquidacion y reglas de negocio previas al cobro.
    const priced = await this.#pricing.priceCart(cart, { userId });
    this.#assertCartIsPurchasable(cart, priced);
    this.#assertPaymentMethodAccepted(dto.paymentMethod, priced);
    this.#assertShipping(dto, priced);
    this.#assertTransferAmount(dto, priced.pricing.totals);

    const customer = {
      name: dto.customerName ?? fullNameOf(user),
      email: dto.email ?? user.email,
      phone: dto.phone ?? user.phone ?? null,
    };

    // g) Cobro con tarjeta antes de la transaccion.
    const charge =
      dto.paymentMethod === PAYMENT_METHODS.CARD
        ? await this.#chargeCard(actor, userId, dto, priced.pricing.totals.grandTotalCents, context)
        : null;

    // h) Transaccion ACID.
    let result;
    try {
      result = await this.#transactions.run((session) =>
        this.#persistOrder(session, { user, userId, dto, customer, pricing: priced.pricing, charge }),
      );
    } catch (error) {
      // i) Compensacion y auditoria del fallo.
      return this.#handleTransactionFailure(error, { actor, userId, dto, charge, context });
    }

    // j) Auditoria del pedido confirmado.
    await this.#audit.record({
      action: AUDIT_ACTIONS.ORDER_CREATED,
      entity: ENTITY,
      entityId: result.order._id.toString(),
      actor,
      metadata: {
        orderNumber: result.order.orderNumber,
        paymentMethod: dto.paymentMethod,
        grandTotalCents: result.order.totals.grandTotalCents,
      },
      context,
    });

    return { order: result.order, invoice: result.invoice, replayed: false };
  }

  /**
   * Busca un pedido previo con la misma clave de idempotencia.
   * @param {ObjectId} userId
   * @param {object} dto
   * @returns {Promise<{ order: object, invoice: object, replayed: true } | null>}
   */
  async #findReplay(userId, dto) {
    const order = await this.#orders.findByUserAndIdempotencyKey(userId, dto.idempotencyKey);
    if (!order) return null;
    if (order.payment?.method !== dto.paymentMethod) {
      throw HttpError.conflict(
        'La clave de idempotencia ya se uso con otro metodo de pago',
        'IDEMPOTENCY_KEY_CONFLICT',
      );
    }
    const invoice = (await this.#invoices.findById(order.invoiceId)) ?? (await this.#invoices.findByOrderId(order._id));
    return { order, invoice, replayed: true };
  }

  /**
   * c) Stock, productos disponibles y vigencia del cupon segun priceCart.
   * @param {object} cart
   * @param {object} priced Resultado de priceCart.
   */
  #assertCartIsPurchasable(cart, priced) {
    const shortage = priced.issues.find((issue) => issue.code === CART_ISSUES.INSUFFICIENT_STOCK);
    if (shortage) throw HttpError.insufficientStock(shortage.availableStock, shortage.productId);

    const unavailable = priced.issues.filter((issue) => issue.code === CART_ISSUES.PRODUCT_UNAVAILABLE);
    if (unavailable.length > 0) {
      throw new HttpError(409, 'Hay productos del carrito que ya no estan disponibles', 'PRODUCT_UNAVAILABLE', {
        productIds: unavailable.map((issue) => issue.productId),
      });
    }

    if (cart.couponCode && priced.coupon && !priced.coupon.applied) {
      throw couponNoLongerValid({ code: priced.coupon.code, reason: priced.coupon.reason });
    }
  }

  /**
   * d) Cada producto debe aceptar el metodo de pago elegido.
   * @param {string} method
   * @param {object} priced
   */
  #assertPaymentMethodAccepted(method, priced) {
    const rejected = priced.pricing.lines
      .map((line) => priced.products.get(line.productId))
      .filter((product) => !(product.acceptedPaymentMethods ?? []).includes(method))
      .map((product) => product._id.toString());
    if (rejected.length > 0) {
      throw HttpError.unprocessable(
        'Algunos productos no aceptan el metodo de pago elegido',
        'PAYMENT_METHOD_NOT_ACCEPTED',
        { paymentMethod: method, productIds: [...new Set(rejected)] },
      );
    }
  }

  /**
   * e) Sin direccion, todos los productos deben poder retirarse en tienda.
   * @param {object} dto
   * @param {object} priced
   */
  #assertShipping(dto, priced) {
    if (dto.shippingAddress) return;
    const needsShipping = priced.pricing.lines.some(
      (line) => priced.products.get(line.productId)?.pickupAvailable === false,
    );
    if (needsShipping) {
      throw HttpError.unprocessable(
        'Hay productos sin retiro en tienda: indica una direccion de envio',
        'SHIPPING_ADDRESS_REQUIRED',
      );
    }
  }

  /**
   * f) La transferencia debe cubrir exactamente el total a pagar.
   * @param {object} dto
   * @param {{ grandTotalCents: number }} totals
   */
  #assertTransferAmount(dto, totals) {
    if (dto.paymentMethod !== PAYMENT_METHODS.BANK_TRANSFER) return;
    if (dto.payment.transferAmountCents !== totals.grandTotalCents) {
      throw HttpError.unprocessable(
        'El monto transferido no coincide con el total del pedido',
        'TRANSFER_AMOUNT_MISMATCH',
        { expected: fromCents(totals.grandTotalCents), received: fromCents(dto.payment.transferAmountCents) },
      );
    }
  }

  /**
   * g) Cobra con la pasarela. Rechazo -> 402; fallo de pasarela -> 502.
   * La clave de idempotencia de la pasarela se acota al usuario para que dos
   * usuarios con la misma cabecera nunca compartan un cargo.
   * @returns {Promise<{ transactionId: string, authorizationCode: string }>}
   */
  async #chargeCard(actor, userId, dto, amountCents, context) {
    const { paymentToken, cardBrand, last4 } = dto.payment;
    const idempotencyKey = dto.idempotencyKey ? `chk_${userId}_${dto.idempotencyKey}` : randomUUID();

    let result;
    try {
      result = await this.#gateway.charge({
        amountCents,
        currency: this.#store.currency,
        paymentToken,
        cardBrand,
        last4,
        idempotencyKey,
        description: `Compra POS ${userId}`,
      });
    } catch (error) {
      await this.#recordFailure(actor, dto, context, { stage: 'payment', reason: 'PAYMENT_GATEWAY_ERROR' });
      if (error instanceof HttpError) throw error;
      throw HttpError.badGateway('La pasarela de pago no respondio', 'PAYMENT_GATEWAY_ERROR');
    }

    if (!result?.approved) {
      await this.#audit.record({
        action: AUDIT_ACTIONS.PAYMENT_DECLINED,
        entity: 'payment',
        entityId: null,
        outcome: 'failure',
        actor,
        metadata: { declineCode: result?.declineCode ?? 'unknown', amountCents, cardBrand, last4 },
        context,
      });
      throw new HttpError(402, 'El pago fue rechazado', 'PAYMENT_DECLINED', {
        declineCode: result?.declineCode ?? 'card_declined',
      });
    }

    return { transactionId: result.transactionId, authorizationCode: result.authorizationCode };
  }

  /**
   * h) Callback de la transaccion. Idempotente: no muta estado externo y todo
   * se escribe con la sesion, de modo que un reintento parte de cero.
   * Orden: stock -> cupon -> numeracion -> pedido -> factura -> carrito.
   * @param {import('mongodb').ClientSession} session
   * @param {{ user: object, userId: ObjectId, dto: object, customer: object, pricing: object,
   *           charge: { transactionId: string, authorizationCode: string } | null }} input
   * @returns {Promise<{ order: object, invoice: object }>}
   */
  async #persistOrder(session, { user, userId, dto, customer, pricing, charge }) {
    // 1. Descuento condicional de stock (filtro stock >= cantidad): sin sobreventa.
    for (const line of pricing.lines) {
      const productId = toObjectId(line.productId);
      const decremented = await this.#products.decrementStock(productId, line.quantity, { session });
      if (!decremented) {
        const stock = await this.#products.getStock(productId, { session });
        // Si hay stock suficiente el fallo se debe a que el producto se elimino o desactivo.
        if (stock === null || stock >= line.quantity) {
          throw HttpError.conflict('Un producto del carrito ya no esta disponible', 'PRODUCT_UNAVAILABLE');
        }
        throw HttpError.insufficientStock(stock, line.productId);
      }
    }

    // 2. Uso del cupon (respeta maxUses de forma atomica).
    if (pricing.coupon) {
      const counted = await this.#coupons.incrementUsage(toObjectId(pricing.coupon.couponId), { session });
      if (!counted) throw couponNoLongerValid({ code: pricing.coupon.code, reason: 'COUPON_USAGE_LIMIT_REACHED' });
    }

    // 3. Numeracion correlativa (se revierte con la transaccion: sin huecos).
    const orderNumber = formatNumber(this.#store.orderNumberPrefix, await this.#sequences.next('order', { session }));
    const invoiceNumber = formatNumber(this.#store.invoiceNumberPrefix, await this.#sequences.next('invoice', { session }));

    const now = this.#now();
    const orderId = new ObjectId();
    const invoiceId = new ObjectId();
    const shippingAddress = dto.shippingAddress ? { ...dto.shippingAddress } : null;

    // 4. Pedido (snapshot inmutable).
    const order = await this.#orders.insert(
      {
        _id: orderId,
        orderNumber,
        userId,
        channel: ORDER_CHANNELS.POS,
        status: INITIAL_ORDER_STATUS[dto.paymentMethod],
        currency: this.#store.currency,
        customer: { ...customer },
        shippingAddress,
        items: pricing.lines.map((line) => ({ productId: toObjectId(line.productId), ...pick(line, ORDER_ITEM_FIELDS) })),
        coupon: pricing.coupon
          ? {
              couponId: toObjectId(pricing.coupon.couponId),
              code: pricing.coupon.code,
              discountType: pricing.coupon.discountType,
              discountValue: pricing.coupon.discountValue,
              discountCents: pricing.coupon.discountCents,
            }
          : null,
        totals: pick(pricing.totals, ORDER_TOTAL_FIELDS),
        payment: this.#buildPayment(dto, charge),
        invoiceId,
        idempotencyKey: dto.idempotencyKey ?? null,
        cashierId: null,
        notes: dto.notes ?? null,
        createdAt: now,
        updatedAt: now,
      },
      { session },
    );

    // 5. Factura (documento fiscal).
    const invoice = await this.#invoices.insert(
      {
        _id: invoiceId,
        invoiceNumber,
        entityType: INVOICE_ENTITY_TYPES.CUSTOMER,
        orderId,
        orderNumber,
        userId,
        nit: dto.nit ?? userId.toString(),
        nitType: dto.nit ? NIT_TYPES.NIT : NIT_TYPES.USER_CODE,
        entityName: dto.entityName ?? customer.name ?? fullNameOf(user),
        email: customer.email,
        paymentMethod: dto.paymentMethod,
        shippingAddress: shippingAddress ? { ...shippingAddress } : null,
        items: pricing.lines.map((line) => ({
          productId: toObjectId(line.productId),
          sku: line.sku,
          name: line.name,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          discountCents: line.discountTotalCents,
          taxRatePercent: line.taxRatePercent,
          taxCents: line.taxCents,
          totalCents: line.grandTotalCents,
        })),
        currency: this.#store.currency,
        subtotalCents: pricing.totals.subtotalCents,
        discountTotalCents: pricing.totals.discountTotalCents,
        taxTotalCents: pricing.totals.taxTotalCents,
        grandTotalCents: pricing.totals.grandTotalCents,
        status: INITIAL_INVOICE_STATUS[dto.paymentMethod],
        issuedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      { session },
    );

    // 6. Vaciado del carrito.
    await this.#carts.clear(userId, { session });

    return { order, invoice };
  }

  /**
   * Subdocumento payment del pedido (sin token de tarjeta).
   * @param {object} dto
   * @param {{ transactionId: string, authorizationCode: string } | null} charge
   */
  #buildPayment(dto, charge) {
    const method = dto.paymentMethod;
    const card =
      method === PAYMENT_METHODS.CARD
        ? {
            brand: dto.payment.cardBrand,
            last4: dto.payment.last4,
            holderName: dto.payment.cardHolderName,
            authorizationCode: charge.authorizationCode,
            gatewayTransactionId: charge.transactionId,
          }
        : null;
    const bankTransfer =
      method === PAYMENT_METHODS.BANK_TRANSFER
        ? {
            bankName: dto.payment.bankName,
            senderAccountNumber: dto.payment.senderAccountNumber,
            transferAmountCents: dto.payment.transferAmountCents,
            authorizationNumber: dto.payment.authorizationNumber,
            receiptUrl: dto.payment.receiptUrl,
            verifiedAt: null,
            verifiedBy: null,
          }
        : null;
    return { method, status: INITIAL_PAYMENT_STATUS[method], card, bankTransfer };
  }

  /**
   * i) La transaccion fallo (ya hubo rollback). Si fue una carrera con la
   * misma clave de idempotencia y el otro intento ya confirmo, se devuelve
   * ese pedido. En otro caso se anula el cargo de tarjeta, se audita y se
   * relanza el error original.
   * @param {Error} error
   * @returns {Promise<{ order: object, invoice: object, replayed: true }>}
   */
  async #handleTransactionFailure(error, { actor, userId, dto, charge, context }) {
    if (dto.idempotencyKey && error?.code === MONGO_DUPLICATE_KEY) {
      const replay = await this.#findReplay(userId, dto).catch(() => null);
      if (replay) {
        // Misma clave en la pasarela => mismo cargo: solo se anula si es distinto.
        const winnerTransaction = replay.order.payment?.card?.gatewayTransactionId;
        if (charge && charge.transactionId !== winnerTransaction) await this.#voidCharge(charge);
        return replay;
      }
    }

    const chargeVoided = charge ? await this.#voidCharge(charge) : false;
    await this.#recordFailure(actor, dto, context, {
      stage: 'transaction',
      reason: error instanceof HttpError ? error.code : 'TRANSACTION_ERROR',
      ...(charge ? { chargeVoided } : {}),
    });
    throw error;
  }

  /**
   * Anula un cargo. Nunca lanza: un fallo se registra (sin datos sensibles)
   * para conciliacion manual y se conserva el error original del checkout.
   * @param {{ transactionId: string }} charge
   * @returns {Promise<boolean>}
   */
  async #voidCharge(charge) {
    try {
      const { voided } = await this.#gateway.voidCharge({ transactionId: charge.transactionId, reason: 'checkout_failed' });
      if (!voided) {
        this.#logger.error('La pasarela no anulo el cargo de un checkout fallido', { transactionId: charge.transactionId });
      }
      return voided === true;
    } catch (voidError) {
      this.#logger.error('No se pudo anular el cargo de un checkout fallido', {
        transactionId: charge.transactionId,
        error: voidError?.code ?? voidError?.name ?? 'Error',
      });
      return false;
    }
  }

  /**
   * Audita un checkout fallido.
   * @param {object} actor
   * @param {object} dto
   * @param {object} context
   * @param {object} metadata
   */
  #recordFailure(actor, dto, context, metadata) {
    return this.#audit.record({
      action: AUDIT_ACTIONS.CHECKOUT_FAILED,
      entity: ENTITY,
      entityId: null,
      outcome: 'failure',
      actor,
      metadata: { paymentMethod: dto.paymentMethod, ...metadata },
      context,
    });
  }
}
