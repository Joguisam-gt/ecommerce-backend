/**
 * Repositorio de carritos: unica capa que conoce la coleccion carts.
 *
 * Hay un carrito por usuario (indice unico en userId). Las escrituras usan
 * upsert atomico para que dos peticiones concurrentes no creen duplicados.
 */
import { COLLECTIONS } from '../database/collections.js';

/** Opciones de findOneAndUpdate: upsert y devolver el documento ya modificado. */
const UPSERT_AFTER = Object.freeze({ upsert: true, returnDocument: 'after', includeResultMetadata: false });

export class CartRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.CARTS);
  }

  /**
   * Busca el carrito de un usuario.
   * @param {import('mongodb').ObjectId} userId
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<object | null>}
   */
  findByUserId(userId, options = {}) {
    return this.#collection.findOne({ userId }, options.session ? { session: options.session } : {});
  }

  /**
   * Reemplaza las lineas del carrito (crea el carrito si no existe).
   * @param {import('mongodb').ObjectId} userId
   * @param {Array<{ productId: import('mongodb').ObjectId, quantity: number, addedAt: Date }>} items
   * @param {Date} now
   * @returns {Promise<object>} Carrito actualizado.
   */
  saveItems(userId, items, now) {
    return this.#collection.findOneAndUpdate(
      { userId },
      { $set: { items, updatedAt: now }, $setOnInsert: { userId, couponCode: null, createdAt: now } },
      UPSERT_AFTER,
    );
  }

  /**
   * Fija o elimina el cupon del carrito (crea el carrito si no existe).
   * @param {import('mongodb').ObjectId} userId
   * @param {string | null} code Codigo en mayusculas o null.
   * @param {Date} now
   * @returns {Promise<object>} Carrito actualizado.
   */
  setCouponCode(userId, code, now) {
    return this.#collection.findOneAndUpdate(
      { userId },
      { $set: { couponCode: code, updatedAt: now }, $setOnInsert: { userId, items: [], createdAt: now } },
      UPSERT_AFTER,
    );
  }

  /**
   * Vacia el carrito y quita el cupon. Lo usa el checkout dentro de la transaccion.
   * @param {import('mongodb').ObjectId} userId
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   */
  clear(userId, { session } = {}) {
    return this.#collection.updateOne(
      { userId },
      { $set: { items: [], couponCode: null, updatedAt: new Date() } },
      { session },
    );
  }
}
