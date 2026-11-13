/**
 * Repositorio de facturas de proveedor (Fase 3).
 *
 * Escribe en la coleccion invoices las facturas contables con entityType
 * "proveedor" generadas dentro de la transaccion de compra, y las consulta
 * para el detalle de una compra. Se separa de InvoiceRepository (facturas de
 * venta a clientes) para no mezclar ambos flujos.
 */
import { INVOICE_ENTITY_TYPES } from '../constants/commerce.js';
import { COLLECTIONS } from '../database/collections.js';

export class SupplierInvoiceRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.INVOICES);
  }

  /**
   * Inserta una factura de proveedor completa y la devuelve con su _id.
   * @param {object} doc
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   */
  async insert(doc, { session } = {}) {
    const { insertedId } = await this.#collection.insertOne(doc, session ? { session } : {});
    return { ...doc, _id: insertedId };
  }

  /**
   * Factura de proveedor por id.
   * @param {import('mongodb').ObjectId} id
   * @returns {Promise<object | null>}
   */
  findById(id) {
    return this.#collection.findOne({ _id: id, entityType: INVOICE_ENTITY_TYPES.SUPPLIER });
  }
}
