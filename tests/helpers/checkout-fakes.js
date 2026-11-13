/**
 * Dobles en memoria para probar el checkout del POS sin MongoDB.
 *
 * Cada repositorio implementa el contrato publico del real y expone
 * snapshot()/restore(). InMemoryTransactionRunner toma un snapshot de todos
 * antes del callback y los restaura si lanza, simulando el rollback de una
 * transaccion de MongoDB. Las escrituras exigen la sesion de la transaccion
 * (requireSession) para comprobar que el servicio la propaga.
 *
 * Incluye ademas un verificador minimo de $jsonSchema (bsonType, required,
 * additionalProperties, enum, pattern, longitudes, rangos, multipleOf, arrays)
 * para afirmar que los documentos cumplen EXACTAMENTE los validadores.
 */
import { ObjectId } from 'mongodb';
import { ALL_PAYMENT_METHODS } from '../../src/constants/commerce.js';
import { CartPricingService } from '../../src/services/cart-pricing.service.js';

/**
 * Copia profunda que conserva ObjectId y Date.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepClone(value) {
  if (value instanceof ObjectId) return new ObjectId(value.toHexString());
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(deepClone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, deepClone(nested)]));
  }
  return value;
}

/**
 * Falla si una escritura transaccional llega sin sesion.
 * @param {object | undefined} session
 * @param {string} operation
 */
function assertSession(session, operation) {
  if (!session) throw new Error(`${operation} se invoco sin la sesion de la transaccion`);
}

/** Base comun: Map de documentos por clave con snapshot/restore. */
class InMemoryStore {
  /** @type {Map<string, object>} */
  docs = new Map();

  /** Copia profunda del estado actual. */
  snapshot() {
    return new Map([...this.docs].map(([key, doc]) => [key, deepClone(doc)]));
  }

  /** @param {Map<string, object>} snapshot */
  restore(snapshot) {
    this.docs = new Map([...snapshot].map(([key, doc]) => [key, deepClone(doc)]));
  }

  /** Todos los documentos (copias). */
  all() {
    return [...this.docs.values()].map(deepClone);
  }

  /** @param {unknown} id */
  peek(id) {
    return this.docs.get(id.toString());
  }
}

export class InMemoryProductRepository extends InMemoryStore {
  /** @param {object[]} [seed] */
  constructor(seed = []) {
    super();
    for (const product of seed) this.docs.set(product._id.toString(), deepClone(product));
  }

  async findManyByIds(ids) {
    const wanted = new Set(ids.map((id) => id.toString()));
    return [...this.docs.values()].filter((doc) => wanted.has(doc._id.toString())).map(deepClone);
  }

  async decrementStock(productId, quantity, { session } = {}) {
    assertSession(session, 'decrementStock');
    const doc = this.docs.get(productId.toString());
    if (!doc || !doc.isActive || doc.stock < quantity) return false;
    doc.stock -= quantity;
    return true;
  }

  async getStock(productId) {
    return this.docs.get(productId.toString())?.stock ?? null;
  }

  /** Ayuda de prueba: fija el stock (simula otra compra concurrente). */
  setStock(productId, stock) {
    this.docs.get(productId.toString()).stock = stock;
  }
}

export class InMemoryCartRepository extends InMemoryStore {
  /** @param {object[]} [seed] Carritos { userId, items, couponCode }. */
  constructor(seed = []) {
    super();
    for (const cart of seed) this.docs.set(cart.userId.toString(), deepClone(cart));
  }

  async findByUserId(userId) {
    const cart = this.docs.get(userId.toString());
    return cart ? deepClone(cart) : null;
  }

  async clear(userId, { session } = {}) {
    assertSession(session, 'cart.clear');
    const cart = this.docs.get(userId.toString());
    if (cart) Object.assign(cart, { items: [], couponCode: null });
  }
}

export class InMemoryCouponRepository extends InMemoryStore {
  /** Si es true, incrementUsage devuelve false (cupon agotado en carrera). */
  failIncrement = false;

  /** @param {object[]} [seed] */
  constructor(seed = []) {
    super();
    for (const coupon of seed) this.docs.set(coupon._id.toString(), deepClone(coupon));
  }

  async findByCode(code) {
    const coupon = [...this.docs.values()].find((doc) => doc.code === code);
    return coupon ? deepClone(coupon) : null;
  }

  async incrementUsage(couponId, { session } = {}) {
    assertSession(session, 'incrementUsage');
    const doc = this.docs.get(couponId.toString());
    if (this.failIncrement || !doc || !doc.isActive) return false;
    if (doc.maxUses != null && doc.usedCount >= doc.maxUses) return false;
    doc.usedCount += 1;
    return true;
  }
}

export class InMemoryOrderRepository extends InMemoryStore {
  async insert(doc, { session } = {}) {
    assertSession(session, 'order.insert');
    const duplicate =
      typeof doc.idempotencyKey === 'string' &&
      [...this.docs.values()].some(
        (order) => order.userId.equals(doc.userId) && order.idempotencyKey === doc.idempotencyKey,
      );
    if (duplicate) {
      throw Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyValue: { idempotencyKey: doc.idempotencyKey } });
    }
    const stored = deepClone({ ...doc, _id: doc._id ?? new ObjectId() });
    this.docs.set(stored._id.toString(), stored);
    return deepClone(stored);
  }

  async findById(id) {
    const doc = this.docs.get(id.toString());
    return doc ? deepClone(doc) : null;
  }

  async findByUserAndIdempotencyKey(userId, key) {
    const doc = [...this.docs.values()].find((order) => order.userId.equals(userId) && order.idempotencyKey === key);
    return doc ? deepClone(doc) : null;
  }

  async countByUserAndCoupon(userId, couponId) {
    return [...this.docs.values()].filter(
      (order) => order.userId.equals(userId) && order.coupon?.couponId?.equals(couponId) && order.status !== 'cancelled',
    ).length;
  }

  async listByUser(userId, { page, limit }) {
    const items = [...this.docs.values()].filter((order) => order.userId.equals(userId));
    return { items: items.slice((page - 1) * limit, page * limit).map(deepClone), total: items.length };
  }
}

export class InMemoryInvoiceRepository extends InMemoryStore {
  async insert(doc, { session } = {}) {
    assertSession(session, 'invoice.insert');
    const stored = deepClone({ ...doc, _id: doc._id ?? new ObjectId() });
    this.docs.set(stored._id.toString(), stored);
    return deepClone(stored);
  }

  async findById(id) {
    const doc = this.docs.get(id.toString());
    return doc ? deepClone(doc) : null;
  }

  async findByOrderId(orderId) {
    const doc = [...this.docs.values()].find((invoice) => invoice.orderId.equals(orderId));
    return doc ? deepClone(doc) : null;
  }

  async list({ page, limit, userId, status, nit }) {
    const items = [...this.docs.values()].filter(
      (invoice) =>
        (!userId || invoice.userId.equals(userId)) && (!status || invoice.status === status) && (!nit || invoice.nit === nit),
    );
    return { items: items.slice((page - 1) * limit, page * limit).map(deepClone), total: items.length };
  }
}

export class InMemorySequenceRepository {
  /** @type {Map<string, number>} */
  counters = new Map();

  async next(name, { session } = {}) {
    assertSession(session, 'sequence.next');
    const value = (this.counters.get(name) ?? 0) + 1;
    this.counters.set(name, value);
    return value;
  }

  /** @param {string} name */
  peek(name) {
    return this.counters.get(name) ?? 0;
  }

  snapshot() {
    return new Map(this.counters);
  }

  restore(snapshot) {
    this.counters = new Map(snapshot);
  }
}

export class InMemoryTransactionRunner {
  /** @type {Array<{ snapshot(): unknown, restore(s: unknown): void }>} */
  #participants;

  /** Gancho opcional ejecutado justo antes de abrir la transaccion (simula concurrencia). */
  beforeRun = null;

  /** Numero de transacciones abiertas, confirmadas y revertidas. */
  stats = { started: 0, committed: 0, rolledBack: 0 };

  /** @param {Array<{ snapshot(): unknown, restore(s: unknown): void }>} participants */
  constructor(participants) {
    this.#participants = participants;
  }

  /**
   * @template T
   * @param {(session: object) => Promise<T>} work
   * @returns {Promise<T>}
   */
  async run(work) {
    if (this.beforeRun) await this.beforeRun();
    const snapshots = this.#participants.map((participant) => participant.snapshot());
    const session = Object.freeze({ id: new ObjectId(), inTransaction: () => true });
    this.stats.started += 1;
    try {
      const result = await work(session);
      this.stats.committed += 1;
      return result;
    } catch (error) {
      this.#participants.forEach((participant, index) => participant.restore(snapshots[index]));
      this.stats.rolledBack += 1;
      throw error;
    }
  }
}

/**
 * Producto completo valido segun products.schema.js.
 * @param {Partial<object>} overrides
 */
export function makeProduct(overrides = {}) {
  const suffix = new ObjectId().toString().slice(-6).toUpperCase();
  return {
    _id: new ObjectId(),
    sku: `SKU-${suffix}`,
    name: `Producto ${suffix}`,
    slug: `producto-${suffix.toLowerCase()}`,
    priceCents: 10000,
    discountPercent: 0,
    taxRatePercent: 12,
    stock: 10,
    category: 'general',
    isActive: true,
    isFeatured: false,
    pickupAvailable: true,
    acceptedPaymentMethods: [...ALL_PAYMENT_METHODS],
    ratingAverage: 0,
    ratingCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Cupon valido segun coupons.schema.js.
 * @param {Partial<object>} overrides
 */
export function makeCoupon(overrides = {}) {
  return {
    _id: new ObjectId(),
    code: 'PROMO10',
    discountType: 'percentage',
    discountValue: 10,
    usedCount: 0,
    maxUses: null,
    maxUsesPerUser: null,
    isActive: true,
    isPermanent: true,
    applicableProductIds: [],
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validUntil: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Construye repositorios, CartPricingService real y el runner transaccional.
 * @param {{ products?: object[], coupons?: object[], carts?: object[], clock: () => Date }} seed
 */
export function makeCommerceDeps({ products = [], coupons = [], carts = [], clock }) {
  const productRepository = new InMemoryProductRepository(products);
  const couponRepository = new InMemoryCouponRepository(coupons);
  const cartRepository = new InMemoryCartRepository(carts);
  const orderRepository = new InMemoryOrderRepository();
  const invoiceRepository = new InMemoryInvoiceRepository();
  const sequenceRepository = new InMemorySequenceRepository();
  const cartPricingService = new CartPricingService({
    productRepository,
    couponRepository,
    couponUsageCounter: (userId, couponId, options) => orderRepository.countByUserAndCoupon(userId, couponId, options),
    clock,
  });
  const transactionRunner = new InMemoryTransactionRunner([
    productRepository,
    couponRepository,
    cartRepository,
    orderRepository,
    invoiceRepository,
    sequenceRepository,
  ]);
  return {
    productRepository,
    couponRepository,
    cartRepository,
    orderRepository,
    invoiceRepository,
    sequenceRepository,
    cartPricingService,
    transactionRunner,
  };
}

/** Comprobadores de bsonType sobre valores JS (como los serializa el driver). */
const BSON_TYPES = Object.freeze({
  objectId: (value) => value instanceof ObjectId,
  string: (value) => typeof value === 'string',
  int: (value) => Number.isInteger(value) && value >= -(2 ** 31) && value < 2 ** 31,
  long: (value) => Number.isInteger(value),
  double: (value) => typeof value === 'number' && Number.isFinite(value),
  date: (value) => value instanceof Date,
  bool: (value) => typeof value === 'boolean',
  null: (value) => value === null,
  array: (value) => Array.isArray(value),
  object: (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof ObjectId) && !(value instanceof Date),
});

/**
 * Valida un valor contra un $jsonSchema de MongoDB (subconjunto usado en el proyecto).
 * @param {unknown} value
 * @param {object} schema
 * @param {string} [path]
 * @returns {string[]} Errores con la ruta del campo.
 */
export function jsonSchemaErrors(value, schema, path = '$') {
  const errors = [];
  if (schema.bsonType) {
    const types = Array.isArray(schema.bsonType) ? schema.bsonType : [schema.bsonType];
    if (!types.some((type) => BSON_TYPES[type]?.(value))) return [`${path}: bsonType esperado ${types.join('|')}`];
  }
  if (value === null) return errors;
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: valor fuera del enum`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: minLength`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: maxLength`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path}: pattern`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: maximum`);
    if (schema.multipleOf !== undefined && value % schema.multipleOf !== 0) errors.push(`${path}: multipleOf`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: minItems`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: maxItems`);
    if (schema.items) value.forEach((item, index) => errors.push(...jsonSchemaErrors(item, schema.items, `${path}[${index}]`)));
  } else if (BSON_TYPES.object(value)) {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: requerido`);
    for (const [key, nested] of Object.entries(value)) {
      const rule = schema.properties?.[key];
      if (!rule) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key}: propiedad no permitida`);
        continue;
      }
      errors.push(...jsonSchemaErrors(nested, rule, `${path}.${key}`));
    }
  }
  return errors;
}
