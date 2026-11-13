/**
 * Repositorio de pedidos del panel de administracion (Fase 3): conciliacion
 * de transferencias bancarias.
 *
 * Es la unica capa que toca el driver para esta funcionalidad. Accede a las
 * colecciones orders e invoices (la factura se actualiza en la misma
 * transaccion que el pedido). Las transiciones de estado son condicionales:
 * el filtro incluye el estado esperado, de modo que dos conciliaciones
 * simultaneas del mismo pedido nunca se aplican ambas (la segunda no encuentra
 * documento y el servicio responde 409). Todos los identificadores llegan ya
 * convertidos a ObjectId y los metodos aceptan la sesion de la transaccion.
 */
import { ORDER_STATUSES, PAYMENT_METHODS } from '../constants/commerce.js';
import { COLLECTIONS } from '../database/collections.js';

/**
 * Opciones del driver con la sesion opcional.
 * @param {import('mongodb').ClientSession | undefined} session
 */
const withSession = (session) => (session ? { session } : {});

/** Filtro de la cola de verificacion: transferencias pendientes de conciliar. */
export const PENDING_TRANSFER_FILTER = Object.freeze({
  status: ORDER_STATUSES.PENDING_VERIFICATION,
  'payment.method': PAYMENT_METHODS.BANK_TRANSFER,
});

/** Campos que necesita la cola de verificacion (el DTO decide que se expone). */
const PENDING_PROJECTION = Object.freeze({
  orderNumber: 1,
  userId: 1,
  status: 1,
  currency: 1,
  customer: 1,
  totals: 1,
  payment: 1,
  invoiceId: 1,
  createdAt: 1,
});

export class AdminOrderRepository {
  /** @type {import('mongodb').Collection} */
  #orders;

  /** @type {import('mongodb').Collection} */
  #invoices;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#orders = db.collection(COLLECTIONS.ORDERS);
    this.#invoices = db.collection(COLLECTIONS.INVOICES);
  }

  /**
   * Cola paginada de transferencias pendientes de verificacion, de la mas
   * antigua a la mas reciente (orden de llegada). Usa ix_orders_payment_status.
   * @param {{ page: number, limit: number }} pagination
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async listPendingTransfers({ page, limit }) {
    const filter = { ...PENDING_TRANSFER_FILTER };
    const [items, total] = await Promise.all([
      this.#orders
        .find(filter, { projection: PENDING_PROJECTION })
        .sort({ createdAt: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      this.#orders.countDocuments(filter),
    ]);
    return { items, total };
  }

  /**
   * Pedido por id.
   * @param {import('mongodb').ObjectId} id
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<object | null>}
   */
  findById(id, { session } = {}) {
    return this.#orders.findOne({ _id: id }, withSession(session));
  }

  /**
   * Transicion condicional de un pedido: solo actualiza si sigue en el estado esperado.
   * @param {import('mongodb').ObjectId} id
   * @param {string} expectedStatus Estado que debe tener el pedido.
   * @param {Record<string, unknown>} set Campos a fijar (admite rutas con punto).
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<object | null>} Pedido actualizado o null si no existe o cambio de estado.
   */
  updateIfStatus(id, expectedStatus, set, { session } = {}) {
    return this.#orders.findOneAndUpdate(
      { _id: id, status: expectedStatus },
      { $set: set },
      { returnDocument: 'after', ...withSession(session) },
    );
  }

  /**
   * Factura por id.
   * @param {import('mongodb').ObjectId} id
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<object | null>}
   */
  findInvoiceById(id, { session } = {}) {
    return this.#invoices.findOne({ _id: id }, withSession(session));
  }

  /**
   * Transicion condicional de una factura: solo si su estado esta entre los esperados.
   * @param {import('mongodb').ObjectId} id
   * @param {readonly string[]} expectedStatuses
   * @param {Record<string, unknown>} set
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<object | null>} Factura actualizada o null.
   */
  updateInvoiceIfStatus(id, expectedStatuses, set, { session } = {}) {
    return this.#invoices.findOneAndUpdate(
      { _id: id, status: { $in: [...expectedStatuses] } },
      { $set: set },
      { returnDocument: 'after', ...withSession(session) },
    );
  }
}
