/**
 * Motor de calculo de caja (puro, sin E/S).
 *
 * Es la unica fuente de verdad de importes: lo usan el carrito (vista previa)
 * y el checkout (montos congelados en el pedido y la factura), por lo que
 * ambos siempre coinciden.
 *
 * Convenciones (todas en centavos enteros):
 * - Los precios de catalogo NO incluyen impuesto.
 * - Orden de aplicacion por linea:
 *     subtotal          = precio original x cantidad
 *     descuento producto = (precio original x discountPercent) x cantidad
 *     neto              = subtotal - descuento producto
 *     descuento cupon   = sobre el neto de las lineas aplicables
 *     base imponible    = neto - descuento cupon
 *     impuesto          = base imponible x taxRatePercent
 *     total linea       = base imponible + impuesto
 * - discountTotal = descuento de producto + descuento de cupon.
 * - Un cupon de monto fijo se reparte proporcionalmente entre las lineas
 *   aplicables (metodo del mayor resto) y nunca supera su neto.
 */
import { COUPON_TYPES } from '../../constants/commerce.js';
import { allocateProportionally, percentOf } from '../../utils/money.js';

/**
 * @typedef {object} PricingLineInput
 * @property {string} productId
 * @property {string} sku
 * @property {string} name
 * @property {number} quantity
 * @property {number} unitPriceCents   Precio original sin impuesto.
 * @property {number} discountPercent  Descuento propio del producto (0-100).
 * @property {number} taxRatePercent   Tasa de impuesto (0-100).
 */

/**
 * @typedef {object} PricingCoupon
 * @property {string} couponId
 * @property {string} code
 * @property {'percentage' | 'fixed'} discountType
 * @property {number} discountValue    Porcentaje (1-100) o centavos.
 * @property {string[]} applicableProductIds  Vacio = aplica a todos.
 */

export class PricingCalculator {
  /**
   * Calcula importes por linea y totales.
   * @param {PricingLineInput[]} lines
   * @param {PricingCoupon | null} [coupon] Cupon YA validado por coupon.policy.js.
   * @returns {{ lines: object[], totals: object, coupon: object | null }}
   */
  calculate(lines, coupon = null) {
    const base = lines.map((line) => this.#priceLine(line));
    const couponShares = coupon ? this.#couponShares(base, coupon) : base.map(() => 0);

    const priced = base.map((line, index) => {
      const couponDiscountCents = couponShares[index];
      const taxableCents = line.netCents - couponDiscountCents;
      const taxCents = percentOf(taxableCents, line.taxRatePercent);
      return {
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        discountPercent: line.discountPercent,
        unitFinalPriceCents: line.unitFinalPriceCents,
        taxRatePercent: line.taxRatePercent,
        subtotalCents: line.subtotalCents,
        productDiscountCents: line.productDiscountCents,
        couponDiscountCents,
        discountTotalCents: line.productDiscountCents + couponDiscountCents,
        taxableCents,
        taxCents,
        grandTotalCents: taxableCents + taxCents,
      };
    });

    const totals = this.#sumTotals(priced);
    const appliedCoupon = coupon
      ? {
          couponId: coupon.couponId,
          code: coupon.code,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          discountCents: totals.couponDiscountCents,
        }
      : null;

    return { lines: priced, totals, coupon: appliedCoupon };
  }

  /**
   * Calcula los importes previos al cupon de una linea.
   * @param {PricingLineInput} line
   */
  #priceLine(line) {
    const unitDiscountCents = percentOf(line.unitPriceCents, line.discountPercent);
    const unitFinalPriceCents = line.unitPriceCents - unitDiscountCents;
    const subtotalCents = line.unitPriceCents * line.quantity;
    const productDiscountCents = unitDiscountCents * line.quantity;
    return {
      ...line,
      unitFinalPriceCents,
      subtotalCents,
      productDiscountCents,
      netCents: subtotalCents - productDiscountCents,
    };
  }

  /**
   * Devuelve el descuento de cupon asignado a cada linea (0 en las no aplicables).
   * @param {Array<{ productId: string, netCents: number }>} lines
   * @param {PricingCoupon} coupon
   * @returns {number[]}
   */
  #couponShares(lines, coupon) {
    const applies = (line) =>
      coupon.applicableProductIds.length === 0 || coupon.applicableProductIds.includes(line.productId);

    if (coupon.discountType === COUPON_TYPES.PERCENTAGE) {
      return lines.map((line) => (applies(line) ? percentOf(line.netCents, coupon.discountValue) : 0));
    }

    const weights = lines.map((line) => (applies(line) ? line.netCents : 0));
    const applicableNet = weights.reduce((acc, weight) => acc + weight, 0);
    return allocateProportionally(Math.min(coupon.discountValue, applicableNet), weights);
  }

  /**
   * Suma los importes de todas las lineas.
   * @param {object[]} lines
   */
  #sumTotals(lines) {
    const sum = (key) => lines.reduce((acc, line) => acc + line[key], 0);
    return {
      subtotalCents: sum('subtotalCents'),
      productDiscountCents: sum('productDiscountCents'),
      couponDiscountCents: sum('couponDiscountCents'),
      discountTotalCents: sum('discountTotalCents'),
      taxTotalCents: sum('taxCents'),
      grandTotalCents: sum('grandTotalCents'),
      totalItemsCount: sum('quantity'),
    };
  }
}
