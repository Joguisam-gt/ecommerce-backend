/**
 * DTOs del carrito: entrada normalizada y salida con importes decimales.
 *
 * Internamente todo va en centavos; aqui se convierte a decimales (fromCents)
 * solo en el borde de la API.
 */
import { fromCents } from '../utils/money.js';

/** Respuesta del carrito con su caja. */
export class CartDTO {
  /**
   * @param {{ pricing: { lines: object[], totals: object }, coupon: object | null, issues: object[], products: Map<string, object> }} result
   * @param {{ currency: string }} options
   */
  static from({ pricing, coupon, issues, products }, { currency }) {
    const { totals } = pricing;
    return {
      currency,
      items: pricing.lines.map((line) => {
        const product = products.get(line.productId);
        return {
          productId: line.productId,
          sku: line.sku,
          name: line.name,
          imageUrl: product?.images?.[0] ?? null,
          quantity: line.quantity,
          availableStock: product?.stock ?? 0,
          unitPrice: fromCents(line.unitPriceCents),
          discountPercent: line.discountPercent,
          unitFinalPrice: fromCents(line.unitFinalPriceCents),
          taxRatePercent: line.taxRatePercent,
          subtotal: fromCents(line.subtotalCents),
          discountTotal: fromCents(line.discountTotalCents),
          taxTotal: fromCents(line.taxCents),
          grandTotal: fromCents(line.grandTotalCents),
        };
      }),
      coupon: CartDTO.#coupon(coupon, totals),
      issues: issues ?? [],
      summary: {
        subtotal: fromCents(totals.subtotalCents),
        productDiscountTotal: fromCents(totals.productDiscountCents),
        couponDiscountTotal: fromCents(totals.couponDiscountCents),
        discountTotal: fromCents(totals.discountTotalCents),
        taxTotal: fromCents(totals.taxTotalCents),
        grandTotal: fromCents(totals.grandTotalCents),
        totalItemsCount: totals.totalItemsCount,
      },
    };
  }

  /**
   * @param {object | null} coupon
   * @param {{ couponDiscountCents: number }} totals
   */
  static #coupon(coupon, totals) {
    if (!coupon) return null;
    if (!coupon.applied) {
      return { code: coupon.code, applied: false, reason: coupon.reason, message: coupon.message };
    }
    return { code: coupon.code, applied: true, discount: fromCents(totals.couponDiscountCents) };
  }
}

/** Alta de linea: productId string y cantidad numerica. */
export class AddCartItemDTO {
  /** @param {{ productId: string, quantity: number }} body */
  static from(body) {
    return { productId: String(body.productId), quantity: Number(body.quantity) };
  }
}

/** Cambio de cantidad. */
export class UpdateCartItemDTO {
  /** @param {{ quantity: number }} body */
  static from(body) {
    return { quantity: Number(body.quantity) };
  }
}

/** Aplicar cupon: codigo recortado y en mayusculas. */
export class ApplyCouponDTO {
  /** @param {{ code: string }} body */
  static from(body) {
    return { code: String(body.code).trim().toUpperCase() };
  }
}
