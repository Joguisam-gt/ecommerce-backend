/**
 * Dobles en memoria para las pruebas del carrito y la liquidacion.
 *
 * Reproducen solo el contrato que usan CartService y CartPricingService:
 * productos (findPublicById, findManyByIds), carritos y cupones.
 */
import { ObjectId } from 'mongodb';
import { CartPricingService } from '../../src/services/cart-pricing.service.js';
import { CartService } from '../../src/services/cart.service.js';

/** Instante fijo para todas las pruebas. */
export const NOW = new Date('2026-06-15T12:00:00Z');

/**
 * Crea un producto de catalogo.
 * @param {Partial<object>} overrides
 */
export function makeProduct(overrides = {}) {
  return {
    _id: new ObjectId(),
    sku: `SKU-${new ObjectId().toString().slice(-6)}`,
    name: 'Producto',
    priceCents: 10000,
    discountPercent: 0,
    taxRatePercent: 12,
    stock: 10,
    isActive: true,
    images: [],
    ...overrides,
  };
}

/**
 * Crea un cupon valido por defecto (10%, permanente, sin limites).
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
    ...overrides,
  };
}

/** Repositorio de productos en memoria. */
export class FakeProductRepository {
  /** @param {object[]} products */
  constructor(products = []) {
    this.products = new Map(products.map((product) => [product._id.toString(), product]));
  }

  /** @param {ObjectId} id */
  async findPublicById(id) {
    const product = this.products.get(id.toString());
    return product && product.isActive ? product : null;
  }

  /** @param {ObjectId[]} ids */
  async findManyByIds(ids) {
    return ids.map((id) => this.products.get(id.toString())).filter(Boolean);
  }
}

/**
 * Copia superficial del carrito (structuredClone rompe los ObjectId).
 * @param {object} cart
 */
const copyOf = (cart) => ({ ...cart, items: cart.items.map((item) => ({ ...item })) });

/** Repositorio de carritos en memoria (un carrito por usuario). */
export class FakeCartRepository {
  constructor() {
    this.carts = new Map();
  }

  /** @param {ObjectId} userId */
  async findByUserId(userId) {
    const cart = this.carts.get(userId.toString());
    return cart ? copyOf(cart) : null;
  }

  /** Upsert de lineas. */
  async saveItems(userId, items, now) {
    const current = this.carts.get(userId.toString()) ?? { userId, couponCode: null, createdAt: now };
    const next = { ...current, items, updatedAt: now };
    this.carts.set(userId.toString(), next);
    return copyOf(next);
  }

  /** Upsert de cupon. */
  async setCouponCode(userId, code, now) {
    const current = this.carts.get(userId.toString()) ?? { userId, items: [], createdAt: now };
    const next = { ...current, couponCode: code, updatedAt: now };
    this.carts.set(userId.toString(), next);
    return copyOf(next);
  }
}

/** Repositorio de cupones en memoria. */
export class FakeCouponRepository {
  /** @param {object[]} coupons */
  constructor(coupons = []) {
    this.coupons = new Map(coupons.map((coupon) => [coupon.code, coupon]));
  }

  /** @param {string} code */
  async findByCode(code) {
    return this.coupons.get(code) ?? null;
  }
}

/**
 * Arma un CartService real con CartPricingService real y dobles de repositorios.
 * @param {{ products?: object[], coupons?: object[], usage?: (userId: ObjectId, couponId: ObjectId) => number }} [seed]
 */
export function makeCartHarness({ products = [], coupons = [], usage = () => 0 } = {}) {
  const state = { now: NOW };
  const clock = () => state.now;
  const productRepository = new FakeProductRepository(products);
  const cartRepository = new FakeCartRepository();
  const couponRepository = new FakeCouponRepository(coupons);
  const cartPricingService = new CartPricingService({
    productRepository,
    couponRepository,
    couponUsageCounter: async (userId, couponId) => usage(userId, couponId),
    clock,
  });
  const cartService = new CartService({ cartRepository, productRepository, cartPricingService, clock });
  const userId = new ObjectId();
  return {
    state,
    productRepository,
    cartRepository,
    couponRepository,
    cartPricingService,
    cartService,
    userId,
    actor: { id: userId.toString(), role: 'user' },
  };
}
