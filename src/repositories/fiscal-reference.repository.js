/**
 * Repositorio de referencias fiscales (Fase 4, solo lectura).
 *
 * Cuenta los documentos fiscales y contables que referencian un registro
 * antes de purgarlo. Los nombres de campo salen de los $jsonSchema reales:
 * - orders: userId, items.productId (ix_orders_user_created, ix_orders_items_product).
 * - invoices: userId (venta), items.productId (venta y compra), supplierId
 *   (factura de proveedor) (ix_invoices_user_issued, ix_invoices_items_product,
 *   ix_invoices_supplier).
 * - purchases: supplierId, items.productId (ix_purchases_supplier_date, ix_purchases_items_product).
 * - products: supplierId (ix_products_supplier, parcial por $type objectId: el
 *   filtro repite el $type para que el planificador pueda usar el indice parcial).
 * Todas las consultas aceptan { session } para leer dentro de la transaccion de
 * purga y se ejecutan en serie: el driver no admite operaciones en paralelo
 * sobre la misma sesion transaccional.
 */
import { COLLECTIONS } from '../database/collections.js';
import { INVOICE_ENTITY_TYPES } from '../constants/commerce.js';

/**
 * Opciones del driver con la sesion opcional.
 * @param {import('mongodb').ClientSession | undefined} session
 */
const withSession = (session) => (session ? { session } : {});

/**
 * Filtro de igualdad sobre un ObjectId que tambien cumple el filtro parcial { $type: 'objectId' }.
 * @param {import('mongodb').ObjectId} id
 */
const objectIdEquals = (id) => ({ $eq: id, $type: 'objectId' });

export class FiscalReferenceRepository {
  #orders;
  #invoices;
  #purchases;
  #products;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#orders = db.collection(COLLECTIONS.ORDERS);
    this.#invoices = db.collection(COLLECTIONS.INVOICES);
    this.#purchases = db.collection(COLLECTIONS.PURCHASES);
    this.#products = db.collection(COLLECTIONS.PRODUCTS);
  }

  /**
   * Pedidos y facturas de venta de un cliente.
   * @param {import('mongodb').ObjectId} userId
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<{ orders: number, invoices: number }>}
   */
  async countUserReferences(userId, { session } = {}) {
    const options = withSession(session);
    const orders = await this.#orders.countDocuments({ userId }, options);
    const invoices = await this.#invoices.countDocuments({ userId }, options);
    return { orders, invoices };
  }

  /**
   * Pedidos, facturas (venta y compra) y compras que contienen un producto.
   * @param {import('mongodb').ObjectId} productId
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<{ orders: number, invoices: number, purchases: number }>}
   */
  async countProductReferences(productId, { session } = {}) {
    const options = withSession(session);
    const filter = { 'items.productId': productId };
    const orders = await this.#orders.countDocuments(filter, options);
    const invoices = await this.#invoices.countDocuments(filter, options);
    const purchases = await this.#purchases.countDocuments(filter, options);
    return { orders, invoices, purchases };
  }

  /**
   * Ids de los productos (existentes) asociados a un proveedor.
   * @param {import('mongodb').ObjectId} supplierId
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<import('mongodb').ObjectId[]>}
   */
  async findProductIdsBySupplier(supplierId, { session } = {}) {
    const products = await this.#products
      .find({ supplierId: objectIdEquals(supplierId) }, { projection: { _id: 1 }, ...withSession(session) })
      .toArray();
    return products.map((product) => product._id);
  }

  /**
   * Documentos fiscales de un proveedor: compras y facturas de proveedor por
   * supplierId, y pedidos y facturas que contienen alguno de sus productos.
   * @param {import('mongodb').ObjectId} supplierId
   * @param {import('mongodb').ObjectId[]} productIds Ids de findProductIdsBySupplier.
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<{ orders: number, invoices: number, purchases: number, supplierInvoices: number }>}
   */
  async countSupplierReferences(supplierId, productIds, { session } = {}) {
    const options = withSession(session);
    const byProducts = { 'items.productId': { $in: productIds } };
    const hasProducts = productIds.length > 0;
    const orders = hasProducts ? await this.#orders.countDocuments(byProducts, options) : 0;
    const invoices = hasProducts ? await this.#invoices.countDocuments(byProducts, options) : 0;
    const purchases = await this.#purchases.countDocuments({ supplierId }, options);
    const supplierInvoices = await this.#invoices.countDocuments(
      { supplierId: objectIdEquals(supplierId), entityType: INVOICE_ENTITY_TYPES.SUPPLIER },
      options,
    );
    return { orders, invoices, purchases, supplierInvoices };
  }
}
