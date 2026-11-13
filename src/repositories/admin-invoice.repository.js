/**
 * Repositorio de la facturacion administrativa (Fase 3) sobre invoices.
 *
 * Construye el filtro con una funcion pura (buildAdminInvoiceFilter) para
 * probarlo sin MongoDB. Toda busqueda de texto se escapa antes de usarse como regex.
 */
import { INVOICE_ENTITY_TYPES } from '../constants/commerce.js';
import { COLLECTIONS } from '../database/collections.js';
import { containsRegex } from './pipelines/customer.pipeline.js';
import { dateRangeCondition } from './pipelines/report.pipeline.js';

/**
 * Filtro de MongoDB para el listado administrativo.
 * - nit, paymentMethod, status: igualdad exacta.
 * - entityName, email: busqueda parcial sin mayusculas.
 * - shippingAddress: busqueda parcial en line1, city o state.
 * - entityType: 'cliente' incluye facturas antiguas sin entityType.
 * - startDate / endDate: rango sobre issuedAt.
 * @param {object} criteria ListAdminInvoicesQueryDTO
 * @returns {object}
 */
export function buildAdminInvoiceFilter(criteria = {}) {
  const filter = {};
  if (criteria.nit) filter.nit = criteria.nit;
  if (criteria.entityName) filter.entityName = containsRegex(criteria.entityName);
  if (criteria.paymentMethod) filter.paymentMethod = criteria.paymentMethod;
  if (criteria.email) filter.email = containsRegex(criteria.email);
  if (criteria.status) filter.status = criteria.status;

  // Tipo de entidad (compatibilidad con facturas previas a la Fase 3).
  if (criteria.entityType === INVOICE_ENTITY_TYPES.CUSTOMER) filter.entityType = { $in: [INVOICE_ENTITY_TYPES.CUSTOMER, null] };
  else if (criteria.entityType) filter.entityType = criteria.entityType;

  // Direccion de envio en cualquiera de sus campos principales.
  if (criteria.shippingAddress) {
    const pattern = containsRegex(criteria.shippingAddress);
    filter.$or = [
      { 'shippingAddress.line1': pattern },
      { 'shippingAddress.city': pattern },
      { 'shippingAddress.state': pattern },
    ];
  }

  const issuedAt = dateRangeCondition(criteria);
  if (issuedAt) filter.issuedAt = issuedAt;
  return filter;
}

export class AdminInvoiceRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.INVOICES);
  }

  /**
   * Listado paginado, de la mas reciente a la mas antigua.
   * @param {object} criteria ListAdminInvoicesQueryDTO
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async search(criteria) {
    const filter = buildAdminInvoiceFilter(criteria);
    const { page, limit } = criteria;
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

  /**
   * @param {import('mongodb').ObjectId} id
   * @returns {Promise<object | null>}
   */
  findById(id) {
    return this.#collection.findOne({ _id: id });
  }
}
