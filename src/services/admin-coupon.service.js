/**
 * Servicio de cupones del panel de administracion (Fase 3).
 *
 * Reglas de negocio:
 * - El descuento es porcentual (1..100): se guarda como discountType
 *   'percentage' y discountValue.
 * - Vigencia estricta: debe venir EXACTAMENTE uno de expiresAt (fecha futura,
 *   posterior a validFrom) o isPermanent:true; ambos o ninguno -> 422.
 *   expiresAt se guarda como validUntil (coupons.schema.js).
 * - applicableProductIds vacio = cupon global; si alguno no existe -> 422.
 * - Codigo: si no se envia (o viene vacio) se genera con CouponCodeGenerator
 *   y se reintenta ante colision del indice unico (maximo 5 intentos). Un
 *   codigo enviado por el administrador que ya existe -> 409.
 * - Actualizaciones con concurrencia optimista (updatedAt) y auditoria de
 *   cada mutacion con estado previo y nuevo.
 */
import { COUPON_TYPES } from '../constants/commerce.js';
import { COLLECTIONS } from '../database/collections.js';
import { HttpError } from '../utils/http-error.js';
import { toCents } from '../utils/money.js';
import { toObjectId } from '../utils/object-id.js';
import { AUDIT_ACTIONS } from './audit.service.js';

/** Codigo de MongoDB para violacion de indice unico. */
const MONGO_DUPLICATE_KEY = 11000;

/** Intentos maximos de generacion de codigo ante colisiones. */
export const MAX_CODE_ATTEMPTS = 5;

/**
 * Indica si un error del driver es una colision del indice unico de codigo
 * (si el driver no informa la clave se asume el unico indice unico de coupons).
 * @param {any} error
 */
const isDuplicateCode = (error) => {
  if (error?.code !== MONGO_DUPLICATE_KEY) return false;
  const key = error.keyPattern ?? error.keyValue;
  return !key || Object.hasOwn(key, 'code');
};

/**
 * Resuelve la vigencia de un cupon aplicando la regla estricta expiresAt XOR isPermanent.
 * @param {{ expiresAt?: Date, isPermanent?: boolean }} input
 * @param {{ now: Date, validFrom: Date }} context
 * @returns {{ isPermanent: boolean, validUntil: Date | null }}
 */
export function resolveExpiration({ expiresAt, isPermanent }, { now, validFrom }) {
  const hasExpiration = expiresAt !== undefined && expiresAt !== null;
  const permanent = isPermanent === true;

  if (hasExpiration && permanent) {
    throw HttpError.unprocessable('Indica expiresAt o isPermanent, no ambos', 'COUPON_EXPIRATION_CONFLICT');
  }
  if (!hasExpiration && !permanent) {
    throw HttpError.unprocessable('Debes indicar expiresAt o isPermanent: true', 'COUPON_EXPIRATION_REQUIRED');
  }
  if (permanent) return { isPermanent: true, validUntil: null };

  if (expiresAt <= now) {
    throw HttpError.unprocessable('expiresAt debe ser una fecha futura', 'COUPON_EXPIRATION_IN_PAST');
  }
  if (expiresAt <= validFrom) {
    throw HttpError.unprocessable('expiresAt debe ser posterior a validFrom', 'COUPON_EXPIRATION_BEFORE_START');
  }
  return { isPermanent: false, validUntil: expiresAt };
}

export class AdminCouponService {
  #coupons;
  #products;
  #codes;
  #audit;
  #now;
  #maxAttempts;

  /**
   * @param {{ adminCouponRepository: import('../repositories/admin-coupon.repository.js').AdminCouponRepository,
   *           adminProductQueryRepository: import('../repositories/admin-product-query.repository.js').AdminProductQueryRepository,
   *           couponCodeGenerator: import('./coupon-code.generator.js').CouponCodeGenerator,
   *           auditService: import('./audit.service.js').AuditService,
   *           clock?: () => Date, maxCodeAttempts?: number }} deps
   */
  constructor({
    adminCouponRepository,
    adminProductQueryRepository,
    couponCodeGenerator,
    auditService,
    clock = () => new Date(),
    maxCodeAttempts = MAX_CODE_ATTEMPTS,
  }) {
    this.#coupons = adminCouponRepository;
    this.#products = adminProductQueryRepository;
    this.#codes = couponCodeGenerator;
    this.#audit = auditService;
    this.#now = clock;
    this.#maxAttempts = maxCodeAttempts;
  }

  /**
   * Productos candidatos a un cupon, con filtros y paginacion. Precios en unidades -> centavos.
   * @param {{ page?: number, limit?: number, name?: string, category?: string, availability?: string,
   *           minPrice?: number, maxPrice?: number }} query
   * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
   */
  async listApplicableProducts(query = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const criteria = { page, limit };
    if (query.name) criteria.name = query.name;
    if (query.category) criteria.category = query.category;
    if (query.availability) criteria.availability = query.availability;
    if (query.minPrice !== undefined) criteria.minPriceCents = toCents(query.minPrice);
    if (query.maxPrice !== undefined) criteria.maxPriceCents = toCents(query.maxPrice);
    if (criteria.minPriceCents !== undefined && criteria.maxPriceCents !== undefined && criteria.minPriceCents > criteria.maxPriceCents) {
      throw HttpError.unprocessable('minPrice no puede ser mayor que maxPrice', 'INVALID_PRICE_RANGE');
    }
    const { items, total } = await this.#products.listApplicable(criteria);
    return { items, total, page, limit };
  }

  /**
   * Listado paginado de cupones.
   * @param {{ page?: number, limit?: number, isActive?: boolean, code?: string }} query
   */
  async list(query = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.#coupons.list({ page, limit, isActive: query.isActive, code: query.code });
    return { items, total, page, limit };
  }

  /**
   * Detalle de un cupon.
   * @param {string} id
   * @returns {Promise<object>}
   */
  async getById(id) {
    const coupon = await this.#coupons.findById(toObjectId(id));
    if (!coupon) throw HttpError.notFound('Cupon no encontrado', 'COUPON_NOT_FOUND');
    return coupon;
  }

  /**
   * Crea un cupon.
   * @param {{ id: string, role: string }} actor
   * @param {object} dto CreateCouponDTO
   * @param {{ ip?: string | null, userAgent?: string | null }} [context]
   * @returns {Promise<object>}
   */
  async create(actor, dto, context = {}) {
    const now = this.#now();
    const validFrom = dto.validFrom ?? now;
    const { isPermanent, validUntil } = resolveExpiration(dto, { now, validFrom });
    const applicableProductIds = await this.#resolveProductIds(dto.applicableProductIds ?? []);

    const base = {
      description: dto.description ?? null,
      discountType: COUPON_TYPES.PERCENTAGE,
      discountValue: dto.discountPercent,
      maxUses: dto.maxUses ?? null,
      maxUsesPerUser: dto.maxUsesPerUser ?? null,
      usedCount: 0,
      isActive: true,
      isPermanent,
      applicableProductIds,
      validFrom,
      validUntil,
      createdBy: toObjectId(actor.id),
      createdAt: now,
      updatedAt: now,
    };

    const generated = !dto.code;
    const coupon = generated ? await this.#insertWithGeneratedCode(base) : await this.#insertWithCode(dto.code, base);

    await this.#audit.recordChange({
      actor,
      action: AUDIT_ACTIONS.COUPON_CREATED,
      targetCollection: COLLECTIONS.COUPONS,
      targetId: coupon._id.toString(),
      previousState: null,
      newState: coupon,
      metadata: { code: coupon.code, generatedCode: generated },
      context,
    });
    return coupon;
  }

  /**
   * Actualiza un cupon (descripcion, descuento, productos, vigencia y estado).
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {object} dto UpdateCouponDTO (solo campos enviados)
   * @param {{ ip?: string | null, userAgent?: string | null }} [context]
   * @returns {Promise<object>}
   */
  async update(actor, id, dto, context = {}) {
    const current = await this.getById(id);
    const now = this.#now();
    const set = {};

    if (dto.description !== undefined) set.description = dto.description;
    if (dto.discountPercent !== undefined) {
      set.discountType = COUPON_TYPES.PERCENTAGE;
      set.discountValue = dto.discountPercent;
    }
    if (dto.applicableProductIds !== undefined) set.applicableProductIds = await this.#resolveProductIds(dto.applicableProductIds);
    if (dto.expiresAt !== undefined || dto.isPermanent !== undefined) {
      Object.assign(set, resolveExpiration(dto, { now, validFrom: current.validFrom }));
    }
    if (dto.isActive !== undefined) set.isActive = dto.isActive;

    const changedFields = Object.keys(set);
    const updated = await this.#applyChange(current, { ...set, updatedAt: now });

    await this.#audit.recordChange({
      actor,
      action: AUDIT_ACTIONS.COUPON_UPDATED,
      targetCollection: COLLECTIONS.COUPONS,
      targetId: updated._id.toString(),
      previousState: current,
      newState: updated,
      metadata: { code: updated.code, changedFields },
      context,
    });
    return updated;
  }

  /**
   * Desactiva un cupon. Si ya estaba inactivo se devuelve sin cambios (idempotente, sin auditoria).
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {{ ip?: string | null, userAgent?: string | null }} [context]
   * @returns {Promise<object>}
   */
  async deactivate(actor, id, context = {}) {
    const current = await this.getById(id);
    if (!current.isActive) return current;

    const updated = await this.#applyChange(current, { isActive: false, updatedAt: this.#now() });
    await this.#audit.recordChange({
      actor,
      action: AUDIT_ACTIONS.COUPON_DEACTIVATED,
      targetCollection: COLLECTIONS.COUPONS,
      targetId: updated._id.toString(),
      previousState: current,
      newState: updated,
      metadata: { code: updated.code },
      context,
    });
    return updated;
  }

  /**
   * Aplica una actualizacion con concurrencia optimista sobre el documento leido.
   * @param {object} current
   * @param {Record<string, unknown>} set
   * @returns {Promise<object>}
   */
  async #applyChange(current, set) {
    const updated = await this.#coupons.updateIfUnchanged(current._id, current.updatedAt, set);
    if (!updated) {
      throw HttpError.conflict('El cupon fue modificado por otra operacion; vuelve a intentarlo', 'COUPON_MODIFIED_CONCURRENTLY');
    }
    return updated;
  }

  /**
   * Convierte y verifica los productos aplicables (sin duplicados). 422 si alguno no existe.
   * @param {string[]} ids
   * @returns {Promise<import('mongodb').ObjectId[]>}
   */
  async #resolveProductIds(ids) {
    const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
    if (unique.length === 0) return [];
    const objectIds = unique.map((id) => toObjectId(id));
    const existing = new Set((await this.#products.findExistingIds(objectIds)).map((id) => id.toString()));
    const missing = unique.filter((id) => !existing.has(id));
    if (missing.length > 0) {
      throw HttpError.unprocessable('Algunos productos aplicables no existen', 'PRODUCTS_NOT_FOUND', { productIds: missing });
    }
    return objectIds;
  }

  /**
   * Inserta con el codigo elegido por el administrador; un duplicado es un 409.
   * @param {string} code Codigo ya normalizado.
   * @param {object} base
   */
  async #insertWithCode(code, base) {
    try {
      return await this.#coupons.insert({ code, ...base });
    } catch (error) {
      if (isDuplicateCode(error)) throw HttpError.conflict('Ya existe un cupon con ese codigo', 'COUPON_CODE_TAKEN');
      throw error;
    }
  }

  /**
   * Inserta con un codigo generado, reintentando ante colision del indice unico.
   * @param {object} base
   */
  async #insertWithGeneratedCode(base) {
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        return await this.#coupons.insert({ code: this.#codes.generate(), ...base });
      } catch (error) {
        if (!isDuplicateCode(error)) throw error;
      }
    }
    throw new HttpError(503, 'No se pudo generar un codigo de cupon unico; vuelve a intentarlo', 'COUPON_CODE_GENERATION_FAILED');
  }
}
