/**
 * Repositorio de productos: unica capa que conoce la coleccion products.
 *
 * Expone el listado publico del catalogo (filtros, orden y paginacion) y el
 * descuento atomico de stock usado dentro de la transaccion del checkout.
 * Todos los metodos reciben ObjectId ya convertidos por la capa de servicio.
 */
import { COLLECTIONS } from '../database/collections.js';

/** Orden por defecto: mas recientes primero, con _id como desempate estable. */
const SORT_NEWEST = Object.freeze({ createdAt: -1, _id: -1 });

/** Tabla de ordenes soportados (siempre con desempate por _id). */
const SORTS = Object.freeze({
  newest: SORT_NEWEST,
  top_rated: Object.freeze({ ratingAverage: -1, ratingCount: -1, _id: -1 }),
  price_asc: Object.freeze({ priceCents: 1, _id: 1 }),
  price_desc: Object.freeze({ priceCents: -1, _id: -1 }),
  discount_desc: Object.freeze({ discountPercent: -1, createdAt: -1, _id: -1 }),
});

/**
 * Construye el filtro de MongoDB del catalogo publico. Siempre isActive:true.
 * @param {{ category?: string, featured?: boolean, onSale?: boolean, newerThan?: Date,
 *           topRated?: boolean, search?: string, minPriceCents?: number, maxPriceCents?: number }} criteria
 * @returns {object}
 */
export function buildProductFilter(criteria = {}) {
  const filter = { isActive: true };
  if (criteria.category) filter.category = criteria.category;
  if (criteria.featured) filter.isFeatured = true;
  if (criteria.onSale) filter.discountPercent = { $gt: 0 };
  if (criteria.newerThan) filter.createdAt = { $gte: criteria.newerThan };
  if (criteria.topRated) filter.ratingCount = { $gte: 1 };
  if (criteria.search) filter.$text = { $search: criteria.search };

  const price = {};
  if (criteria.minPriceCents !== undefined) price.$gte = criteria.minPriceCents;
  if (criteria.maxPriceCents !== undefined) price.$lte = criteria.maxPriceCents;
  if (Object.keys(price).length > 0) filter.priceCents = price;
  return filter;
}

/**
 * Resuelve el orden. Con busqueda de texto y sin orden explicito se ordena por relevancia.
 * @param {string | undefined} sort Clave de SORTS.
 * @param {boolean} hasSearch
 * @returns {{ sort: object, byScore: boolean }}
 */
export function buildProductSort(sort, hasSearch = false) {
  if (!sort && hasSearch) return { sort: { score: { $meta: 'textScore' }, _id: -1 }, byScore: true };
  return { sort: { ...(SORTS[sort] ?? SORT_NEWEST) }, byScore: false };
}

export class ProductRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.PRODUCTS);
  }

  /**
   * Producto activo por id (vista publica).
   * @param {import('mongodb').ObjectId} id
   * @returns {Promise<object | null>}
   */
  findPublicById(id) {
    return this.#collection.findOne({ _id: id, isActive: true });
  }

  /**
   * Productos por lista de ids (activos o no).
   * @param {import('mongodb').ObjectId[]} ids
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<object[]>}
   */
  findManyByIds(ids, options = {}) {
    const driverOptions = options.session ? { session: options.session } : {};
    return this.#collection.find({ _id: { $in: ids } }, driverOptions).toArray();
  }

  /**
   * Descuento atomico de stock: solo si el producto esta activo y hay unidades suficientes.
   * @param {import('mongodb').ObjectId} productId
   * @param {number} quantity
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<boolean>} true si se descontaron las unidades.
   */
  async decrementStock(productId, quantity, { session } = {}) {
    const result = await this.#collection.updateOne(
      { _id: productId, isActive: true, stock: { $gte: quantity } },
      { $inc: { stock: -quantity }, $set: { updatedAt: new Date() } },
      session ? { session } : {},
    );
    return result.modifiedCount === 1;
  }

  /**
   * Stock actual de un producto.
   * @param {import('mongodb').ObjectId} productId
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<number | null>}
   */
  async getStock(productId, { session } = {}) {
    const doc = await this.#collection.findOne({ _id: productId }, { projection: { stock: 1 }, ...(session ? { session } : {}) });
    return doc ? doc.stock : null;
  }

  /**
   * Listado publico paginado.
   * @param {object} criteria Filtros (ver buildProductFilter) mas { sort, page, limit }.
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async listPublic(criteria) {
    const { page = 1, limit = 20, sort } = criteria;
    const filter = buildProductFilter(criteria);
    const { sort: order, byScore } = buildProductSort(sort, Boolean(criteria.search));

    let cursor = this.#collection.find(filter);
    if (byScore) cursor = cursor.project({ score: { $meta: 'textScore' } });
    const [items, total] = await Promise.all([
      cursor
        .sort(order)
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      this.#collection.countDocuments(filter),
    ]);
    return { items, total };
  }
}
