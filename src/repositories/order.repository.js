/**
 * Repositorio de pedidos: unica capa que conoce la coleccion orders.
 *
 * Los pedidos son snapshots inmutables de la compra; aqui solo se insertan y
 * se consultan. Los metodos de escritura aceptan la sesion de la transaccion
 * de checkout. Todos los identificadores llegan ya convertidos a ObjectId.
 */
import { ORDER_STATUSES } from '../constants/commerce.js';
import { COLLECTIONS } from '../database/collections.js';

/**
 * Construye las opciones del driver incluyendo la sesion solo si existe.
 * @param {import('mongodb').ClientSession | undefined} session
 */
const withSession = (session) => (session ? { session } : {});

export class OrderRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.ORDERS);
  }

  /**
   * Inserta un pedido completo (ver CheckoutService) y lo devuelve con su _id.
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
   * Busca el pedido creado por un usuario con una clave de idempotencia (indice unico parcial).
   * @param {import('mongodb').ObjectId} userId
   * @param {string} key
   * @returns {Promise<object | null>}
   */
  findByUserAndIdempotencyKey(userId, key) {
    return this.#collection.findOne({ userId, idempotencyKey: key });
  }

  /**
   * Cuenta los pedidos no cancelados ni rechazados (Fase 3: transferencia
   * rechazada libera el cupon) de un usuario que usaron un cupon
   * (limite maxUsesPerUser). Usa el indice ix_orders_coupon_user.
   * @param {import('mongodb').ObjectId} userId
   * @param {import('mongodb').ObjectId} couponId
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<number>}
   */
  countByUserAndCoupon(userId, couponId, options = {}) {
    return this.#collection.countDocuments(
      { 'coupon.couponId': couponId, userId, status: { $nin: [ORDER_STATUSES.CANCELLED, ORDER_STATUSES.REJECTED] } },
      withSession(options.session),
    );
  }

  /**
   * Historial paginado de un usuario, del mas reciente al mas antiguo.
   * @param {import('mongodb').ObjectId} userId
   * @param {{ page: number, limit: number }} pagination
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async listByUser(userId, { page, limit }) {
    const filter = { userId };
    const [items, total] = await Promise.all([
      this.#collection
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      this.#collection.countDocuments(filter),
    ]);
    return { items, total };
  }
}
