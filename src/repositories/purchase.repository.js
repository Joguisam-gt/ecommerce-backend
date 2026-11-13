/**
 * Repositorio de compras a proveedores (coleccion purchases, Fase 3).
 *
 * Las compras se insertan dentro de la transaccion de ingreso de mercaderia y
 * despues solo se consultan (son snapshots inmutables). El conteo por
 * proveedor protege el borrado fisico de proveedores con historial.
 */
import { COLLECTIONS } from '../database/collections.js';

/**
 * Opciones del driver con la sesion opcional.
 * @param {import('mongodb').ClientSession | undefined} session
 */
const withSession = (session) => (session ? { session } : {});

/**
 * Construye el filtro del listado de compras.
 * @param {{ supplierId?: import('mongodb').ObjectId, from?: Date, to?: Date }} criteria
 * @returns {object}
 */
export function buildPurchaseFilter(criteria = {}) {
  const filter = {};
  if (criteria.supplierId) filter.supplierId = criteria.supplierId;
  const purchased = {};
  if (criteria.from) purchased.$gte = criteria.from;
  if (criteria.to) purchased.$lte = criteria.to;
  if (Object.keys(purchased).length > 0) filter.purchasedAt = purchased;
  return filter;
}

export class PurchaseRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.PURCHASES);
  }

  /**
   * Inserta una compra completa y la devuelve con su _id.
   * @param {object} doc
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   */
  async insert(doc, { session } = {}) {
    const { insertedId } = await this.#collection.insertOne(doc, withSession(session));
    return { ...doc, _id: insertedId };
  }

  /**
   * @param {import('mongodb').ObjectId} id
   * @returns {Promise<object | null>}
   */
  findById(id) {
    return this.#collection.findOne({ _id: id });
  }

  /**
   * Numero de compras registradas a un proveedor.
   * @param {import('mongodb').ObjectId} supplierId
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<number>}
   */
  countBySupplier(supplierId, { session } = {}) {
    return this.#collection.countDocuments({ supplierId }, withSession(session));
  }

  /**
   * Listado paginado, de la compra mas reciente a la mas antigua.
   * @param {{ page: number, limit: number, supplierId?: import('mongodb').ObjectId, from?: Date, to?: Date }} criteria
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async list(criteria) {
    const { page = 1, limit = 20 } = criteria;
    const filter = buildPurchaseFilter(criteria);
    const [items, total] = await Promise.all([
      this.#collection
        .find(filter)
        .sort({ purchasedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      this.#collection.countDocuments(filter),
    ]);
    return { items, total };
  }
}
