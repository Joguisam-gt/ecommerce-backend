/**
 * Repositorio de inventario del panel de administracion (Fase 3).
 *
 * Consultas administrativas sobre la coleccion products: listado con filtros
 * dinamicos (nombre, proveedor, rango de precio de venta, fecha de ingreso,
 * categoria), detalle con los datos del proveedor ($lookup a suppliers) y
 * lecturas por id dentro de transacciones. A diferencia del catalogo publico,
 * incluye productos inactivos y expone el costo. Las escrituras de stock viven
 * en InventoryStockRepository. Todos los ids llegan ya convertidos a ObjectId.
 */
import { COLLECTIONS } from '../database/collections.js';

/**
 * Opciones del driver con la sesion opcional.
 * @param {import('mongodb').ClientSession | undefined} session
 */
const withSession = (session) => (session ? { session } : {});

/**
 * Escapa caracteres especiales para usar texto del usuario dentro de una RegExp.
 * Evita inyeccion de expresiones regulares y ReDoS.
 * @param {string} value
 * @returns {string}
 */
export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Orden por defecto: ingresos mas recientes primero, con _id como desempate estable. */
const SORT_NEWEST = Object.freeze({ createdAt: -1, _id: -1 });

/** Ordenes admitidos por el listado de inventario (siempre con desempate por _id). */
export const INVENTORY_SORTS = Object.freeze({
  newest: SORT_NEWEST,
  oldest: Object.freeze({ createdAt: 1, _id: 1 }),
  name_asc: Object.freeze({ name: 1, _id: 1 }),
  name_desc: Object.freeze({ name: -1, _id: -1 }),
  price_asc: Object.freeze({ priceCents: 1, _id: 1 }),
  price_desc: Object.freeze({ priceCents: -1, _id: -1 }),
  stock_asc: Object.freeze({ stock: 1, _id: 1 }),
  stock_desc: Object.freeze({ stock: -1, _id: -1 }),
});

/** Campos del proveedor que se incorporan al detalle de un producto. */
const SUPPLIER_PROJECTION = Object.freeze({
  _id: 1,
  supplierCode: 1,
  name: 1,
  nit: 1,
  phone: 1,
  address: 1,
  distributionDescription: 1,
  isActive: 1,
});

/**
 * Construye el filtro de MongoDB del listado de inventario.
 * @param {{ productName?: string, supplierId?: import('mongodb').ObjectId, category?: string,
 *           minPriceCents?: number, maxPriceCents?: number, createdFrom?: Date, createdTo?: Date,
 *           isActive?: boolean }} criteria
 * @returns {object}
 */
export function buildInventoryFilter(criteria = {}) {
  const filter = {};
  if (criteria.productName) filter.name = { $regex: escapeRegex(criteria.productName), $options: 'i' };
  if (criteria.supplierId) filter.supplierId = criteria.supplierId;
  if (criteria.category) filter.category = criteria.category;
  if (criteria.isActive !== undefined) filter.isActive = criteria.isActive;

  const price = {};
  if (criteria.minPriceCents !== undefined) price.$gte = criteria.minPriceCents;
  if (criteria.maxPriceCents !== undefined) price.$lte = criteria.maxPriceCents;
  if (Object.keys(price).length > 0) filter.priceCents = price;

  const created = {};
  if (criteria.createdFrom) created.$gte = criteria.createdFrom;
  if (criteria.createdTo) created.$lte = criteria.createdTo;
  if (Object.keys(created).length > 0) filter.createdAt = created;
  return filter;
}

export class InventoryRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.PRODUCTS);
  }

  /**
   * Producto por id (activo o no).
   * @param {import('mongodb').ObjectId} id
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<object | null>}
   */
  findById(id, { session } = {}) {
    return this.#collection.findOne({ _id: id }, withSession(session));
  }

  /**
   * Productos por lista de ids (activos o no).
   * @param {import('mongodb').ObjectId[]} ids
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<object[]>}
   */
  findManyByIds(ids, { session } = {}) {
    return this.#collection.find({ _id: { $in: ids } }, withSession(session)).toArray();
  }

  /**
   * Detalle de un producto con los datos de su proveedor (campo supplier, null si no tiene).
   * @param {import('mongodb').ObjectId} id
   * @returns {Promise<object | null>}
   */
  async findDetailById(id) {
    const [doc] = await this.#collection
      .aggregate([
        { $match: { _id: id } },
        {
          $lookup: {
            from: COLLECTIONS.SUPPLIERS,
            localField: 'supplierId',
            foreignField: '_id',
            pipeline: [{ $project: SUPPLIER_PROJECTION }],
            as: 'supplierDocs',
          },
        },
        { $set: { supplier: { $ifNull: [{ $first: '$supplierDocs' }, null] } } },
        { $unset: 'supplierDocs' },
      ])
      .toArray();
    return doc ?? null;
  }

  /**
   * Listado paginado con filtros dinamicos.
   * @param {object} criteria Filtros (ver buildInventoryFilter) mas { page, limit, sort }.
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async list(criteria) {
    const { page = 1, limit = 20, sort } = criteria;
    const filter = buildInventoryFilter(criteria);
    const order = { ...(INVENTORY_SORTS[sort] ?? SORT_NEWEST) };
    const [items, total] = await Promise.all([
      this.#collection
        .find(filter)
        .sort(order)
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      this.#collection.countDocuments(filter),
    ]);
    return { items, total };
  }
}
