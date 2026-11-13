/**
 * Dobles en memoria para probar la conciliacion de transferencias y la
 * gestion de cupones del panel (Fase 3) sin MongoDB.
 *
 * Cada repositorio implementa el contrato publico del real. Los que participan
 * en transacciones exponen snapshot()/restore() para InMemoryTransactionRunner
 * y exigen la sesion en sus escrituras. Incluye constructores de pedidos por
 * transferencia y de sus facturas que cumplen los $jsonSchema.
 */
import { ObjectId } from 'mongodb';
import { deepClone } from './checkout-fakes.js';

/**
 * Falla si una escritura transaccional llega sin sesion.
 * @param {object | undefined} session
 * @param {string} operation
 */
function assertSession(session, operation) {
  if (!session) throw new Error(`${operation} se invoco sin la sesion de la transaccion`);
}

/**
 * Aplica un $set con rutas con punto sobre un documento (mutandolo).
 * @param {object} doc
 * @param {Record<string, unknown>} set
 */
function applySet(doc, set) {
  for (const [path, value] of Object.entries(set)) {
    const keys = path.split('.');
    let target = doc;
    for (const key of keys.slice(0, -1)) {
      if (target[key] === null || typeof target[key] !== 'object') target[key] = {};
      target = target[key];
    }
    target[keys.at(-1)] = deepClone(value);
  }
}

/** Mapa de documentos por id con snapshot/restore. */
const cloneMap = (map) => new Map([...map].map(([key, doc]) => [key, deepClone(doc)]));

export class InMemoryAdminOrderRepository {
  /** @type {Map<string, object>} */
  orders = new Map();

  /** @type {Map<string, object>} */
  invoices = new Map();

  /** @param {{ orders?: object[], invoices?: object[] }} [seed] */
  constructor({ orders = [], invoices = [] } = {}) {
    for (const order of orders) this.orders.set(order._id.toString(), deepClone(order));
    for (const invoice of invoices) this.invoices.set(invoice._id.toString(), deepClone(invoice));
  }

  snapshot() {
    return { orders: cloneMap(this.orders), invoices: cloneMap(this.invoices) };
  }

  /** @param {{ orders: Map<string, object>, invoices: Map<string, object> }} snapshot */
  restore(snapshot) {
    this.orders = cloneMap(snapshot.orders);
    this.invoices = cloneMap(snapshot.invoices);
  }

  /** @param {unknown} id */
  peekOrder(id) {
    return this.orders.get(id.toString());
  }

  /** @param {unknown} id */
  peekInvoice(id) {
    return this.invoices.get(id.toString());
  }

  async listPendingTransfers({ page, limit }) {
    const items = [...this.orders.values()]
      .filter((order) => order.status === 'pending_verification' && order.payment?.method === 'bank_transfer')
      .sort((a, b) => a.createdAt - b.createdAt);
    return { items: items.slice((page - 1) * limit, page * limit).map(deepClone), total: items.length };
  }

  async findById(id) {
    const doc = this.orders.get(id.toString());
    return doc ? deepClone(doc) : null;
  }

  async updateIfStatus(id, expectedStatus, set, { session } = {}) {
    assertSession(session, 'order.updateIfStatus');
    const doc = this.orders.get(id.toString());
    if (!doc || doc.status !== expectedStatus) return null;
    applySet(doc, set);
    return deepClone(doc);
  }

  async findInvoiceById(id) {
    const doc = this.invoices.get(id.toString());
    return doc ? deepClone(doc) : null;
  }

  async updateInvoiceIfStatus(id, expectedStatuses, set, { session } = {}) {
    assertSession(session, 'invoice.updateInvoiceIfStatus');
    const doc = this.invoices.get(id.toString());
    if (!doc || !expectedStatuses.includes(doc.status)) return null;
    applySet(doc, set);
    return deepClone(doc);
  }
}

export class InMemoryAdminCouponRepository {
  /** @type {Map<string, object>} */
  docs = new Map();

  /** Codigos que el indice unico rechazara (simula colisiones con cupones existentes). */
  takenCodes = new Set();

  /** Codigos que se intentaron insertar (en orden). */
  insertAttempts = [];

  /** @param {object[]} [seed] */
  constructor(seed = []) {
    for (const coupon of seed) this.docs.set(coupon._id.toString(), deepClone(coupon));
  }

  snapshot() {
    return cloneMap(this.docs);
  }

  /** @param {Map<string, object>} snapshot */
  restore(snapshot) {
    this.docs = cloneMap(snapshot);
  }

  /** @param {unknown} id */
  peek(id) {
    return this.docs.get(id.toString());
  }

  async list({ page, limit, isActive, code }) {
    const items = [...this.docs.values()].filter(
      (coupon) => (isActive === undefined || coupon.isActive === isActive) && (!code || coupon.code.startsWith(code)),
    );
    return { items: items.slice((page - 1) * limit, page * limit).map(deepClone), total: items.length };
  }

  async findById(id) {
    const doc = this.docs.get(id.toString());
    return doc ? deepClone(doc) : null;
  }

  async insert(doc) {
    this.insertAttempts.push(doc.code);
    const duplicate = this.takenCodes.has(doc.code) || [...this.docs.values()].some((coupon) => coupon.code === doc.code);
    if (duplicate) {
      throw Object.assign(new Error('E11000 duplicate key error collection: coupons index: uq_coupons_code'), {
        code: 11000,
        keyPattern: { code: 1 },
        keyValue: { code: doc.code },
      });
    }
    const stored = deepClone({ ...doc, _id: doc._id ?? new ObjectId() });
    this.docs.set(stored._id.toString(), stored);
    return deepClone(stored);
  }

  async updateIfUnchanged(id, expectedUpdatedAt, set) {
    const doc = this.docs.get(id.toString());
    if (!doc || doc.updatedAt.getTime() !== expectedUpdatedAt.getTime()) return null;
    applySet(doc, set);
    return deepClone(doc);
  }

  async decrementUsage(couponId, { session, now = new Date() } = {}) {
    assertSession(session, 'coupon.decrementUsage');
    const doc = this.docs.get(couponId.toString());
    if (!doc || !(doc.usedCount > 0)) return false;
    doc.usedCount -= 1;
    doc.updatedAt = now;
    return true;
  }
}

export class InMemoryAdminProductQueryRepository {
  /** @type {Map<string, object>} */
  docs = new Map();

  /** Ultimos criterios recibidos por listApplicable. */
  lastCriteria = null;

  /** @param {object[]} [seed] */
  constructor(seed = []) {
    for (const product of seed) this.docs.set(product._id.toString(), deepClone(product));
  }

  async listApplicable(criteria) {
    this.lastCriteria = { ...criteria };
    const { page, limit } = criteria;
    const items = [...this.docs.values()]
      .filter((product) => {
        if (criteria.name && !product.name.toLowerCase().includes(criteria.name.toLowerCase())) return false;
        if (criteria.category && product.category !== criteria.category) return false;
        if (criteria.availability === 'inStock' && !(product.stock > 0)) return false;
        if (criteria.availability === 'outOfStock' && product.stock > 0) return false;
        if (criteria.minPriceCents !== undefined && product.priceCents < criteria.minPriceCents) return false;
        if (criteria.maxPriceCents !== undefined && product.priceCents > criteria.maxPriceCents) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { items: items.slice((page - 1) * limit, page * limit).map(deepClone), total: items.length };
  }

  async findExistingIds(ids) {
    return ids.filter((id) => this.docs.has(id.toString()));
  }
}

/**
 * Pedido por transferencia pendiente de verificacion, valido segun orders.schema.js.
 * @param {{ products: Array<{ product: object, quantity: number }>, coupon?: object | null, overrides?: object }} input
 */
export function makeBankTransferOrder({ products, coupon = null, overrides = {} }) {
  const created = new Date('2026-05-01T09:00:00Z');
  const items = products.map(({ product, quantity }) => {
    const subtotal = product.priceCents * quantity;
    const tax = Math.round(subtotal * 0.12);
    return {
      productId: product._id,
      sku: product.sku,
      name: product.name,
      quantity,
      unitPriceCents: product.priceCents,
      discountPercent: 0,
      unitFinalPriceCents: product.priceCents,
      taxRatePercent: 12,
      subtotalCents: subtotal,
      productDiscountCents: 0,
      couponDiscountCents: 0,
      discountTotalCents: 0,
      taxCents: tax,
      grandTotalCents: subtotal + tax,
    };
  });
  const sum = (field) => items.reduce((acc, item) => acc + item[field], 0);
  return {
    _id: new ObjectId(),
    orderNumber: `ORD-${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    userId: new ObjectId(),
    channel: 'pos',
    status: 'pending_verification',
    currency: 'GTQ',
    customer: { name: 'Ana Perez', email: 'ana@example.com', phone: null },
    shippingAddress: null,
    items,
    coupon: coupon
      ? { couponId: coupon._id, code: coupon.code, discountType: 'percentage', discountValue: 10, discountCents: 0 }
      : null,
    totals: {
      subtotalCents: sum('subtotalCents'),
      productDiscountCents: 0,
      couponDiscountCents: 0,
      discountTotalCents: 0,
      taxTotalCents: sum('taxCents'),
      grandTotalCents: sum('grandTotalCents'),
      totalItemsCount: items.reduce((acc, item) => acc + item.quantity, 0),
    },
    payment: {
      method: 'bank_transfer',
      status: 'pending_verification',
      card: null,
      bankTransfer: {
        bankName: 'Banrural',
        senderAccountNumber: '3-123-456789-0',
        transferAmountCents: sum('grandTotalCents'),
        authorizationNumber: 'AUT-998877',
        receiptUrl: 'https://banco.example.com/comprobantes/998877',
        verifiedAt: null,
        verifiedBy: null,
      },
    },
    invoiceId: new ObjectId(),
    idempotencyKey: null,
    cashierId: null,
    notes: null,
    createdAt: created,
    updatedAt: created,
    ...overrides,
  };
}

/**
 * Factura pendiente de pago del pedido, valida segun invoices.schema.js.
 * @param {object} order
 * @param {object} [overrides]
 */
export function makeInvoiceForOrder(order, overrides = {}) {
  return {
    _id: order.invoiceId,
    invoiceNumber: `FAC-${order.orderNumber.slice(4)}`,
    entityType: 'cliente',
    orderId: order._id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    nit: 'CF',
    nitType: 'nit',
    entityName: order.customer.name,
    email: order.customer.email,
    paymentMethod: 'bank_transfer',
    shippingAddress: null,
    items: order.items.map((item) => ({
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      discountCents: item.discountTotalCents,
      taxRatePercent: item.taxRatePercent,
      taxCents: item.taxCents,
      totalCents: item.grandTotalCents,
    })),
    currency: 'GTQ',
    subtotalCents: order.totals.subtotalCents,
    discountTotalCents: order.totals.discountTotalCents,
    taxTotalCents: order.totals.taxTotalCents,
    grandTotalCents: order.totals.grandTotalCents,
    status: 'pending_payment',
    issuedAt: order.createdAt,
    createdAt: order.createdAt,
    updatedAt: order.createdAt,
    ...overrides,
  };
}
