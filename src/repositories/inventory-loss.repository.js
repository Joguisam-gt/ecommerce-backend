/**
 * Repositorio de mermas de inventario (coleccion inventory_losses, Fase 3).
 *
 * Registro append-only: se inserta dentro de la transaccion que descuenta el
 * stock y despues solo se consulta para reportes (por producto, motivo y
 * rango de fechas, cubiertos por los indices de inventory-losses.schema.js).
 */
import { COLLECTIONS } from '../database/collections.js';

/**
 * Opciones del driver con la sesion opcional.
 * @param {import('mongodb').ClientSession | undefined} session
 */
const withSession = (session) => (session ? { session } : {});

/**
 * Construye el filtro del listado de mermas.
 * @param {{ productId?: import('mongodb').ObjectId, reason?: string, from?: Date, to?: Date }} criteria
 * @returns {object}
 */
export function buildLossFilter(criteria = {}) {
  const filter = {};
  if (criteria.productId) filter.productId = criteria.productId;
  if (criteria.reason) filter.reason = criteria.reason;
  const occurred = {};
  if (criteria.from) occurred.$gte = criteria.from;
  if (criteria.to) occurred.$lte = criteria.to;
  if (Object.keys(occurred).length > 0) filter.occurredAt = occurred;
  return filter;
}

export class InventoryLossRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.INVENTORY_LOSSES);
  }

  /**
   * Inserta una merma y la devuelve con su _id.
   * @param {object} doc
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   */
  async insert(doc, { session } = {}) {
    const { insertedId } = await this.#collection.insertOne(doc, withSession(session));
    return { ...doc, _id: insertedId };
  }

  /**
   * Listado paginado, de la mas reciente a la mas antigua.
   * @param {{ page: number, limit: number, productId?: import('mongodb').ObjectId, reason?: string, from?: Date, to?: Date }} criteria
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async list(criteria) {
    const { page = 1, limit = 20 } = criteria;
    const filter = buildLossFilter(criteria);
    const [items, total] = await Promise.all([
      this.#collection
        .find(filter)
        .sort({ occurredAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      this.#collection.countDocuments(filter),
    ]);
    return { items, total };
  }
}
