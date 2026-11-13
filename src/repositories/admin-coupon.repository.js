/**
 * Repositorio de cupones del panel de administracion (Fase 3).
 *
 * Unica capa que toca el driver para la gestion de cupones: alta, consulta,
 * actualizacion con control de concurrencia optimista (el filtro incluye el
 * updatedAt leido, asi una edicion simultanea no se pisa en silencio) y
 * liberacion de un uso al rechazar una transferencia. La unicidad del codigo
 * la garantiza el indice uq_coupons_code: insert propaga el error 11000 para
 * que el servicio decida (409 o reintento con otro codigo generado).
 */
import { COLLECTIONS } from '../database/collections.js';
import { escapeRegex } from './admin-product-query.repository.js';

/**
 * Opciones del driver con la sesion opcional.
 * @param {import('mongodb').ClientSession | undefined} session
 */
const withSession = (session) => (session ? { session } : {});

/**
 * Filtro del listado de cupones.
 * @param {{ isActive?: boolean, code?: string }} criteria code ya en mayusculas.
 * @returns {object}
 */
export function buildCouponFilter({ isActive, code } = {}) {
  const filter = {};
  if (isActive !== undefined) filter.isActive = isActive;
  // Prefijo anclado: aprovecha el indice uq_coupons_code.
  if (code) filter.code = { $regex: `^${escapeRegex(code)}` };
  return filter;
}

export class AdminCouponRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.COUPONS);
  }

  /**
   * Listado paginado, del mas reciente al mas antiguo.
   * @param {{ page: number, limit: number, isActive?: boolean, code?: string }} criteria
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async list({ page, limit, ...criteria }) {
    const filter = buildCouponFilter(criteria);
    const [items, total] = await Promise.all([
      this.#collection
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      this.#collection.countDocuments(filter),
    ]);
    return { items, total };
  }

  /**
   * @param {import('mongodb').ObjectId} id
   * @returns {Promise<object | null>}
   */
  findById(id) {
    return this.#collection.findOne({ _id: id });
  }

  /**
   * Inserta un cupon completo. Un codigo repetido lanza el error 11000 del driver.
   * @param {object} doc
   * @returns {Promise<object>}
   */
  async insert(doc) {
    const { insertedId } = await this.#collection.insertOne(doc);
    return { ...doc, _id: insertedId };
  }

  /**
   * Actualizacion con concurrencia optimista: solo aplica si updatedAt no cambio desde la lectura.
   * @param {import('mongodb').ObjectId} id
   * @param {Date} expectedUpdatedAt updatedAt del documento leido.
   * @param {Record<string, unknown>} set
   * @returns {Promise<object | null>} Cupon actualizado o null si no existe o fue modificado.
   */
  updateIfUnchanged(id, expectedUpdatedAt, set) {
    return this.#collection.findOneAndUpdate(
      { _id: id, updatedAt: expectedUpdatedAt },
      { $set: set },
      { returnDocument: 'after' },
    );
  }

  /**
   * Libera un uso del cupon ($inc -1) sin bajar de 0 (el filtro exige usedCount > 0).
   * @param {import('mongodb').ObjectId} couponId
   * @param {{ session?: import('mongodb').ClientSession, now?: Date }} [options]
   * @returns {Promise<boolean>} true si se decremento.
   */
  async decrementUsage(couponId, { session, now = new Date() } = {}) {
    const result = await this.#collection.updateOne(
      { _id: couponId, usedCount: { $gt: 0 } },
      { $inc: { usedCount: -1 }, $set: { updatedAt: now } },
      withSession(session),
    );
    return result.modifiedCount === 1;
  }
}
