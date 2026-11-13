/**
 * DTOs de cupones del panel de administracion: salida (cupon y producto
 * aplicable) y entrada (alta, edicion y consultas).
 *
 * Mapeo API <-> base de datos: discountPercent <-> discountValue (tipo
 * 'percentage') y expiresAt <-> validUntil. Los precios salen en unidades.
 */
import { COUPON_TYPES } from '../constants/commerce.js';
import { fromCents } from '../utils/money.js';
import { compact, normalizeText } from './normalizers.js';

/**
 * Fecha ISO validada a Date (undefined si no viene).
 * @param {string | undefined} value
 */
const toDate = (value) => (typeof value === 'string' ? new Date(value.trim()) : undefined);

/**
 * Descripcion: null o vacia se guarda como null.
 * @param {string | null | undefined} value
 */
const toDescription = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  return normalizeText(value);
};

/**
 * Ids sin espacios, en minusculas y sin duplicados.
 * @param {string[] | undefined} ids
 */
const toIds = (ids) => (Array.isArray(ids) ? [...new Set(ids.map((id) => id.trim().toLowerCase()))] : undefined);

/** Convierte un booleano de query string. */
const toBool = (value) => (value === undefined ? undefined : value === true || value === 'true');

/** Convierte un numero de query string. */
const toNum = (value) => (value === undefined ? undefined : Number(value));

export class CouponDTO {
  /**
   * @param {object | null} coupon Documento de coupons.
   * @returns {object | null}
   */
  static from(coupon) {
    if (!coupon) return null;
    const isPercentage = coupon.discountType === COUPON_TYPES.PERCENTAGE;
    const productIds = (coupon.applicableProductIds ?? []).map((id) => id.toString());
    return {
      id: coupon._id.toString(),
      code: coupon.code,
      description: coupon.description ?? null,
      discountType: coupon.discountType,
      discountPercent: isPercentage ? coupon.discountValue : null,
      // Porcentaje tal cual; monto fijo de centavos a decimales.
      discountValue: isPercentage ? coupon.discountValue : fromCents(coupon.discountValue),
      applicableProductIds: productIds,
      isGlobal: productIds.length === 0,
      isPermanent: coupon.isPermanent,
      validFrom: coupon.validFrom,
      expiresAt: coupon.validUntil ?? null,
      maxUses: coupon.maxUses ?? null,
      maxUsesPerUser: coupon.maxUsesPerUser ?? null,
      usedCount: coupon.usedCount,
      isActive: coupon.isActive,
      createdBy: coupon.createdBy ? coupon.createdBy.toString() : null,
      createdAt: coupon.createdAt,
      updatedAt: coupon.updatedAt,
    };
  }

  /** @param {object[]} coupons */
  static fromMany(coupons) {
    return coupons.map((coupon) => CouponDTO.from(coupon));
  }
}

export class ApplicableProductDTO {
  /**
   * @param {object | null} product Documento (proyeccion) de products.
   * @returns {object | null}
   */
  static from(product) {
    if (!product) return null;
    return {
      id: product._id.toString(),
      sku: product.sku,
      name: product.name,
      category: product.category,
      price: fromCents(product.priceCents),
      discountPercent: product.discountPercent ?? 0,
      stock: product.stock,
      isActive: product.isActive,
    };
  }

  /** @param {object[]} products */
  static fromMany(products) {
    return products.map((product) => ApplicableProductDTO.from(product));
  }
}

/** Alta de cupon ya validada. code null = generar automaticamente. */
export class CreateCouponDTO {
  /** @param {object} body */
  static from(body) {
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    return Object.freeze({
      code: code === '' ? null : code,
      description: toDescription(body.description) ?? null,
      discountPercent: body.discountPercent,
      applicableProductIds: toIds(body.applicableProductIds) ?? [],
      expiresAt: toDate(body.expiresAt),
      isPermanent: body.isPermanent,
      validFrom: toDate(body.validFrom),
      maxUses: body.maxUses ?? null,
      maxUsesPerUser: body.maxUsesPerUser ?? null,
    });
  }
}

/** Edicion parcial: solo los campos enviados. */
export class UpdateCouponDTO {
  /** @param {object} body */
  static from(body) {
    return Object.freeze(
      compact({
        description: toDescription(body.description),
        discountPercent: body.discountPercent,
        applicableProductIds: toIds(body.applicableProductIds),
        expiresAt: toDate(body.expiresAt),
        isPermanent: body.isPermanent,
        isActive: body.isActive,
      }),
    );
  }
}

/** Parametros del listado de cupones. */
export class ListCouponsQueryDTO {
  /** @param {Record<string, string>} query */
  static from(query) {
    return Object.freeze({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      isActive: toBool(query.isActive),
      code: query.code ? query.code.trim().toUpperCase() : undefined,
    });
  }
}

/** Parametros del filtro de productos aplicables (precios en unidades). */
export class ApplicableProductsQueryDTO {
  /** @param {Record<string, string>} query */
  static from(query) {
    return Object.freeze({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      name: query.name?.trim() || undefined,
      category: query.category?.trim() || undefined,
      availability: query.availability || undefined,
      minPrice: toNum(query.minPrice),
      maxPrice: toNum(query.maxPrice),
    });
  }
}
