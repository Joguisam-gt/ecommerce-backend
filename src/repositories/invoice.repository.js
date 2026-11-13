/**
 * Repositorio de facturas: unica capa que conoce la coleccion invoices.
 *
 * Las facturas se generan dentro de la transaccion de checkout (insert con
 * sesion) y despues solo se consultan. El listado admite filtros por usuario,
 * estado y NIT, cubiertos por los indices de invoices.schema.js.
 */
import { COLLECTIONS } from '../database/collections.js';
import { INVOICE_ENTITY_TYPES } from '../constants/commerce.js';

/**
 * Fase 3: este repositorio sirve las facturas de VENTA (modulo /invoices de la
 * Fase 2). Las facturas de compra a proveedor se consultan desde el panel de
 * administracion; aqui se excluyen (las antiguas sin entityType siguen visibles).
 */
const CUSTOMER_SCOPE = Object.freeze({ entityType: { $ne: INVOICE_ENTITY_TYPES.SUPPLIER } });

export class InvoiceRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.INVOICES);
  }

  /**
   * Inserta una factura completa y la devuelve con su _id.
   * @param {object} doc
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   */
  async insert(doc, { session } = {}) {
    const { insertedId } = await this.#collection.insertOne(doc, session ? { session } : {});
    return { ...doc, _id: insertedId };
  }

  /**
   * @param {import('mongodb').ObjectId} id
   * @returns {Promise<object | null>}
   */
  findById(id) {
    return this.#collection.findOne({ _id: id, ...CUSTOMER_SCOPE });
  }

  /**
   * Factura mas reciente de un pedido.
   * @param {import('mongodb').ObjectId} orderId
   * @returns {Promise<object | null>}
   */
  findByOrderId(orderId) {
    return this.#collection.findOne({ orderId }, { sort: { issuedAt: -1 } });
  }

  /**
   * Listado paginado, de la mas reciente a la mas antigua.
   * @param {{ page: number, limit: number, userId?: import('mongodb').ObjectId, status?: string, nit?: string }} criteria
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async list({ page, limit, userId, status, nit }) {
    const filter = { ...CUSTOMER_SCOPE };
    if (userId) filter.userId = userId;
    if (status) filter.status = status;
    if (nit) filter.nit = nit;

    const [items, total] = await Promise.all([
      this.#collection
        .find(filter)
        .sort({ issuedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      this.#collection.countDocuments(filter),
    ]);
    return { items, total };
  }
}
