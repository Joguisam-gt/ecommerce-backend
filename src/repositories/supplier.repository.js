/**
 * Repositorio de proveedores (coleccion suppliers, Fase 3).
 *
 * Unica capa que conoce la coleccion suppliers: alta, consultas con filtros
 * (codigo exacto o por prefijo, nombre y direccion por expresion regular
 * escapada, estado), detalle con el catalogo enriquecido ($lookup a products),
 * actualizacion, baja logica, borrado fisico y mantenimiento del costo de cada
 * producto en el catalogo del proveedor (usado por la transaccion de compra).
 * Todos los ids llegan ya convertidos a ObjectId.
 */
import { COLLECTIONS } from '../database/collections.js';
import { escapeRegex } from './inventory.repository.js';

/**
 * Opciones del driver con la sesion opcional.
 * @param {import('mongodb').ClientSession | undefined} session
 */
const withSession = (session) => (session ? { session } : {});

/** Patron de un codigo de proveedor completo (coincidencia exacta). */
const FULL_CODE_PATTERN = /^PRV-[0-9]{6,}$/;

/** Collation del indice por nombre: orden alfabetico sin distinguir mayusculas. */
const NAME_COLLATION = Object.freeze({ locale: 'es', strength: 2 });

/** Campos de producto que enriquecen cada entrada del catalogo. */
const CATALOG_PRODUCT_PROJECTION = Object.freeze({
  _id: 1,
  sku: 1,
  name: 1,
  stock: 1,
  priceCents: 1,
  discountPercent: 1,
  isActive: 1,
});

/**
 * Construye el filtro del listado de proveedores.
 * @param {{ supplierCode?: string, name?: string, address?: string, isActive?: boolean }} criteria
 * @returns {object}
 */
export function buildSupplierFilter(criteria = {}) {
  const filter = {};
  if (criteria.supplierCode) {
    filter.supplierCode = FULL_CODE_PATTERN.test(criteria.supplierCode)
      ? criteria.supplierCode
      : { $regex: `^${escapeRegex(criteria.supplierCode)}` };
  }
  if (criteria.name) filter.name = { $regex: escapeRegex(criteria.name), $options: 'i' };
  if (criteria.address) filter.address = { $regex: escapeRegex(criteria.address), $options: 'i' };
  if (criteria.isActive !== undefined) filter.isActive = criteria.isActive;
  return filter;
}

export class SupplierRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.SUPPLIERS);
  }

  /**
   * Inserta un proveedor completo y lo devuelve con su _id.
   * Un NIT o codigo repetido lanza el error 11000 del indice unico.
   * @param {object} doc
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   */
  async insert(doc, { session } = {}) {
    const { insertedId } = await this.#collection.insertOne(doc, withSession(session));
    return { ...doc, _id: insertedId };
  }

  /**
   * @param {import('mongodb').ObjectId} id
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<object | null>}
   */
  findById(id, { session } = {}) {
    return this.#collection.findOne({ _id: id }, withSession(session));
  }

  /**
   * Proveedor por NIT (clave del indice unico).
   * @param {string} nit
   * @returns {Promise<object | null>}
   */
  findByNit(nit) {
    return this.#collection.findOne({ nit });
  }

  /**
   * Detalle con el catalogo enriquecido: cada entrada incluye "product" con
   * sku, nombre, stock, precio de venta y descuento (null si el producto ya no existe).
   * @param {import('mongodb').ObjectId} id
   * @returns {Promise<object | null>}
   */
  async findDetailById(id) {
    const [doc] = await this.#collection
      .aggregate([
        { $match: { _id: id } },
        {
          $lookup: {
            from: COLLECTIONS.PRODUCTS,
            localField: 'catalog.productId',
            foreignField: '_id',
            pipeline: [{ $project: CATALOG_PRODUCT_PROJECTION }],
            as: 'catalogProducts',
          },
        },
      ])
      .toArray();
    if (!doc) return null;

    const { catalogProducts = [], ...supplier } = doc;
    const byId = new Map(catalogProducts.map((product) => [product._id.toString(), product]));
    return {
      ...supplier,
      catalog: (supplier.catalog ?? []).map((entry) => ({ ...entry, product: byId.get(entry.productId.toString()) ?? null })),
    };
  }

  /**
   * Listado paginado ordenado por nombre sin distinguir mayusculas (collation del indice ix_suppliers_name).
   * @param {object} criteria Filtros (ver buildSupplierFilter) mas { page, limit }.
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async list(criteria) {
    const { page = 1, limit = 20 } = criteria;
    const filter = buildSupplierFilter(criteria);
    const [items, total] = await Promise.all([
      this.#collection
        .find(filter)
        .collation(NAME_COLLATION)
        .sort({ name: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      this.#collection.countDocuments(filter),
    ]);
    return { items, total };
  }

  /**
   * Actualiza campos y devuelve el documento resultante (null si no existe).
   * @param {import('mongodb').ObjectId} id
   * @param {object} changes Campos ya normalizados (nunca supplierCode).
   * @param {Date} now
   * @returns {Promise<object | null>}
   */
  updateById(id, changes, now) {
    return this.#collection.findOneAndUpdate(
      { _id: id },
      { $set: { ...changes, updatedAt: now } },
      { returnDocument: 'after', includeResultMetadata: false },
    );
  }

  /**
   * Fija el costo de un producto en el catalogo del proveedor: actualiza la
   * entrada existente o la agrega si no existe (dos escrituras condicionales,
   * pensadas para ejecutarse dentro de la transaccion de compra).
   * @param {import('mongodb').ObjectId} supplierId
   * @param {import('mongodb').ObjectId} productId
   * @param {number} costCents
   * @param {{ session?: import('mongodb').ClientSession, now?: Date }} [options]
   * @returns {Promise<boolean>} true si el proveedor existe y quedo actualizado.
   */
  async upsertCatalogCost(supplierId, productId, costCents, { session, now = new Date() } = {}) {
    const updated = await this.#collection.updateOne(
      { _id: supplierId, 'catalog.productId': productId },
      { $set: { 'catalog.$.costCents': costCents, updatedAt: now } },
      withSession(session),
    );
    if (updated.matchedCount === 1) return true;

    const pushed = await this.#collection.updateOne(
      { _id: supplierId, 'catalog.productId': { $ne: productId } },
      { $push: { catalog: { productId, costCents } }, $set: { updatedAt: now } },
      withSession(session),
    );
    return pushed.matchedCount === 1;
  }

  /**
   * Borrado fisico.
   * @param {import('mongodb').ObjectId} id
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<boolean>}
   */
  async deleteById(id, { session } = {}) {
    const result = await this.#collection.deleteOne({ _id: id }, withSession(session));
    return result.deletedCount === 1;
  }
}
