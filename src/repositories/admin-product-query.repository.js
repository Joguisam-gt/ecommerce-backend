/**
 * Repositorio de consulta de productos del panel de administracion (Fase 3).
 *
 * Solo lectura: filtro de productos aplicables a un cupon (nombre, rango de
 * precio, categoria y disponibilidad) y comprobacion de existencia de ids.
 * A diferencia del catalogo publico incluye productos inactivos, porque el
 * administrador puede preparar un cupon antes de publicar un producto.
 */
import { AVAILABILITY } from '../constants/commerce.js';
import { COLLECTIONS } from '../database/collections.js';

/** Campos devueltos al panel (sin costo ni datos de proveedor). */
const APPLICABLE_PROJECTION = Object.freeze({
  sku: 1,
  name: 1,
  category: 1,
  priceCents: 1,
  discountPercent: 1,
  stock: 1,
  isActive: 1,
});

/**
 * Escapa los metacaracteres de una expresion regular (evita ReDoS e inyeccion de patrones).
 * @param {string} text
 */
export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Construye el filtro de MongoDB de productos aplicables.
 * @param {{ name?: string, category?: string, availability?: string,
 *           minPriceCents?: number, maxPriceCents?: number }} criteria
 * @returns {object}
 */
export function buildApplicableProductFilter(criteria = {}) {
  const filter = {};
  if (criteria.name) filter.name = { $regex: escapeRegex(criteria.name), $options: 'i' };
  if (criteria.category) filter.category = criteria.category;
  if (criteria.availability === AVAILABILITY.IN_STOCK) filter.stock = { $gt: 0 };
  if (criteria.availability === AVAILABILITY.OUT_OF_STOCK) filter.stock = { $lte: 0 };

  const price = {};
  if (criteria.minPriceCents !== undefined) price.$gte = criteria.minPriceCents;
  if (criteria.maxPriceCents !== undefined) price.$lte = criteria.maxPriceCents;
  if (Object.keys(price).length > 0) filter.priceCents = price;
  return filter;
}

export class AdminProductQueryRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.PRODUCTS);
  }

  /**
   * Listado paginado de productos aplicables, ordenado por nombre.
   * @param {{ page: number, limit: number } & Parameters<typeof buildApplicableProductFilter>[0]} criteria
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async listApplicable({ page, limit, ...criteria }) {
    const filter = buildApplicableProductFilter(criteria);
    const [items, total] = await Promise.all([
      this.#collection
        .find(filter, { projection: APPLICABLE_PROJECTION })
        .sort({ name: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      this.#collection.countDocuments(filter),
    ]);
    return { items, total };
  }

  /**
   * Devuelve los ids (de la lista dada) que existen en products.
   * @param {import('mongodb').ObjectId[]} ids
   * @returns {Promise<import('mongodb').ObjectId[]>}
   */
  async findExistingIds(ids) {
    if (ids.length === 0) return [];
    const docs = await this.#collection.find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray();
    return docs.map((doc) => doc._id);
  }
}
