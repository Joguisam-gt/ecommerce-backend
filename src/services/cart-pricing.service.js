/**
 * Servicio de liquidacion de carrito.
 *
 * Une datos (productos, cupon, uso del cupon por el usuario) con la logica pura
 * (PricingCalculator y coupon.policy). Lo usan:
 * - CartService, para mostrar la vista previa de caja.
 * - CheckoutService, dentro o antes de la transaccion, para congelar importes.
 * Asi el total que ve el cliente y el que se cobra salen del mismo calculo.
 *
 * Nunca lanza por problemas del carrito: los devuelve en "issues" y en
 * "coupon" para que cada llamador decida (el carrito los muestra, el checkout
 * los rechaza).
 */
import { evaluateCoupon } from './pricing/coupon.policy.js';
import { PricingCalculator } from './pricing/pricing.calculator.js';

/** Codigos de incidencia por linea. */
export const CART_ISSUES = Object.freeze({
  PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
});

/**
 * Convierte un producto y una cantidad en la entrada del calculador.
 * @param {object} product Documento de products.
 * @param {number} quantity
 */
export function toPricingLine(product, quantity) {
  return {
    productId: product._id.toString(),
    sku: product.sku,
    name: product.name,
    quantity,
    unitPriceCents: product.priceCents,
    discountPercent: product.discountPercent ?? 0,
    taxRatePercent: product.taxRatePercent ?? 0,
  };
}

export class CartPricingService {
  #products;
  #coupons;
  #couponUsageCounter;
  #calculator;
  #now;

  /**
   * @param {{ productRepository: { findManyByIds(ids: import('mongodb').ObjectId[], options?: object): Promise<object[]> },
   *           couponRepository: { findByCode(code: string, options?: object): Promise<object | null> },
   *           couponUsageCounter: (userId: import('mongodb').ObjectId, couponId: import('mongodb').ObjectId, options?: object) => Promise<number>,
   *           calculator?: PricingCalculator, clock?: () => Date }} deps
   */
  constructor({ productRepository, couponRepository, couponUsageCounter, calculator = new PricingCalculator(), clock = () => new Date() }) {
    this.#products = productRepository;
    this.#coupons = couponRepository;
    this.#couponUsageCounter = couponUsageCounter;
    this.#calculator = calculator;
    this.#now = clock;
  }

  /**
   * Calcula la caja de un carrito.
   * @param {{ items: Array<{ productId: import('mongodb').ObjectId, quantity: number }>, couponCode?: string | null } | null} cart
   * @param {{ userId: import('mongodb').ObjectId, session?: import('mongodb').ClientSession }} options
   * @returns {Promise<{
   *   pricing: { lines: object[], totals: object, coupon: object | null },
   *   coupon: { code: string, applied: boolean, reason?: string, message?: string } | null,
   *   issues: Array<{ productId: string, code: string, requested: number, availableStock?: number }>,
   *   products: Map<string, object>
   * }>}
   */
  async priceCart(cart, { userId, session } = {}) {
    const items = cart?.items ?? [];
    const options = session ? { session } : {};

    const found = items.length > 0 ? await this.#products.findManyByIds(items.map((item) => item.productId), options) : [];
    const products = new Map(found.map((product) => [product._id.toString(), product]));

    const issues = [];
    const lines = [];
    for (const item of items) {
      const productId = item.productId.toString();
      const product = products.get(productId);
      if (!product || !product.isActive) {
        issues.push({ productId, code: CART_ISSUES.PRODUCT_UNAVAILABLE, requested: item.quantity });
        continue;
      }
      if (product.stock < item.quantity) {
        issues.push({ productId, code: CART_ISSUES.INSUFFICIENT_STOCK, requested: item.quantity, availableStock: product.stock });
      }
      lines.push(toPricingLine(product, item.quantity));
    }

    const withoutCoupon = this.#calculator.calculate(lines);
    if (!cart?.couponCode) {
      return { pricing: withoutCoupon, coupon: null, issues, products };
    }

    const evaluation = await this.evaluateCouponCode(cart.couponCode, withoutCoupon.lines, { userId, session });
    if (!evaluation.valid) {
      return {
        pricing: withoutCoupon,
        coupon: { code: cart.couponCode, applied: false, reason: evaluation.reason, message: evaluation.message },
        issues,
        products,
      };
    }

    return {
      pricing: this.#calculator.calculate(lines, evaluation.coupon),
      coupon: { code: cart.couponCode, applied: true },
      issues,
      products,
    };
  }

  /**
   * Evalua un codigo de cupon contra unas lineas ya calculadas sin cupon.
   * @param {string} code
   * @param {object[]} pricedLines
   * @param {{ userId: import('mongodb').ObjectId, session?: import('mongodb').ClientSession }} options
   */
  async evaluateCouponCode(code, pricedLines, { userId, session } = {}) {
    const options = session ? { session } : {};
    const coupon = await this.#coupons.findByCode(code, options);
    const userUsageCount =
      coupon && coupon.maxUsesPerUser != null && userId ? await this.#couponUsageCounter(userId, coupon._id, options) : 0;
    return evaluateCoupon(coupon, { lines: pricedLines, now: this.#now(), userUsageCount });
  }
}
