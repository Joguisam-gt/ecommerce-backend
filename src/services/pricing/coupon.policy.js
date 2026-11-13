/**
 * Politica de validacion de cupones (pura, sin E/S).
 *
 * Decide si un cupon puede aplicarse a un carrito en un instante dado. El
 * llamador obtiene los datos (cupon, uso por usuario) y esta funcion solo
 * evalua reglas, por lo que es trivial de probar. Si el cupon no es valido se
 * devuelve el motivo y el calculo de caja se hace SIN cupon (el total no cambia).
 *
 * Orden de comprobacion: existencia, activo, vigencia (o isPermanent), limite
 * global, limite por usuario, productos aplicables y compra minima.
 */
import { fromCents } from '../../utils/money.js';

/** Motivos de rechazo (codigos estables para el cliente). */
export const COUPON_REJECTIONS = Object.freeze({
  NOT_FOUND: 'COUPON_NOT_FOUND',
  INACTIVE: 'COUPON_INACTIVE',
  NOT_STARTED: 'COUPON_NOT_STARTED',
  EXPIRED: 'COUPON_EXPIRED',
  USAGE_LIMIT_REACHED: 'COUPON_USAGE_LIMIT_REACHED',
  USER_LIMIT_REACHED: 'COUPON_USER_LIMIT_REACHED',
  NOT_APPLICABLE: 'COUPON_NOT_APPLICABLE',
  MIN_ORDER_NOT_MET: 'COUPON_MIN_ORDER_NOT_MET',
});

/** Mensajes legibles por motivo. */
const MESSAGES = Object.freeze({
  [COUPON_REJECTIONS.NOT_FOUND]: 'El cupon no existe',
  [COUPON_REJECTIONS.INACTIVE]: 'El cupon no esta activo',
  [COUPON_REJECTIONS.NOT_STARTED]: 'El cupon todavia no esta vigente',
  [COUPON_REJECTIONS.EXPIRED]: 'El cupon ha expirado',
  [COUPON_REJECTIONS.USAGE_LIMIT_REACHED]: 'El cupon alcanzo su limite de usos',
  [COUPON_REJECTIONS.USER_LIMIT_REACHED]: 'Ya utilizaste este cupon el maximo de veces permitido',
  [COUPON_REJECTIONS.NOT_APPLICABLE]: 'El cupon no aplica a ningun producto del carrito',
  [COUPON_REJECTIONS.MIN_ORDER_NOT_MET]: 'El carrito no alcanza la compra minima del cupon',
});

/**
 * Resultado negativo.
 * @param {string} reason
 * @param {object} [extra]
 */
const reject = (reason, extra = {}) => ({ valid: false, reason, message: MESSAGES[reason], ...extra });

/**
 * Evalua un cupon contra el carrito.
 * @param {object | null} coupon Documento de coupons (o null si no existe).
 * @param {{ lines: Array<{ productId: string, subtotalCents: number, productDiscountCents: number }>,
 *           now: Date, userUsageCount?: number }} context
 *   lines: lineas ya calculadas SIN cupon (PricingCalculator.calculate(lines)).
 * @returns {{ valid: true, coupon: import('./pricing.calculator.js').PricingCoupon } |
 *           { valid: false, reason: string, message: string }}
 */
export function evaluateCoupon(coupon, { lines, now, userUsageCount = 0 }) {
  if (!coupon) return reject(COUPON_REJECTIONS.NOT_FOUND);
  if (!coupon.isActive) return reject(COUPON_REJECTIONS.INACTIVE);
  if (coupon.validFrom && coupon.validFrom > now) return reject(COUPON_REJECTIONS.NOT_STARTED);
  if (!coupon.isPermanent && (!coupon.validUntil || coupon.validUntil <= now)) {
    return reject(COUPON_REJECTIONS.EXPIRED);
  }
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
    return reject(COUPON_REJECTIONS.USAGE_LIMIT_REACHED);
  }
  if (coupon.maxUsesPerUser != null && userUsageCount >= coupon.maxUsesPerUser) {
    return reject(COUPON_REJECTIONS.USER_LIMIT_REACHED);
  }

  const applicableIds = (coupon.applicableProductIds ?? []).map((id) => id.toString());
  const applicableLines =
    applicableIds.length === 0 ? lines : lines.filter((line) => applicableIds.includes(line.productId));
  if (applicableLines.length === 0) return reject(COUPON_REJECTIONS.NOT_APPLICABLE);

  const netCents = lines.reduce((acc, line) => acc + line.subtotalCents - line.productDiscountCents, 0);
  if (coupon.minOrderCents && netCents < coupon.minOrderCents) {
    return reject(COUPON_REJECTIONS.MIN_ORDER_NOT_MET, { minOrder: fromCents(coupon.minOrderCents) });
  }

  return {
    valid: true,
    coupon: {
      couponId: coupon._id.toString(),
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      applicableProductIds: applicableIds,
    },
  };
}
