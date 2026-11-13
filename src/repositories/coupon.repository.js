/**
 * Repositorio de cupones: unica capa que conoce la coleccion coupons.
 *
 * El consumo de un uso es atomico: el propio filtro del update comprueba el
 * limite global, de modo que dos compras simultaneas nunca superan maxUses.
 */
import { COLLECTIONS } from '../database/collections.js';

export class CouponRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.COUPONS);
  }

  /**
   * Busca un cupon por codigo.
   * @param {string} code Codigo ya normalizado en mayusculas.
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<object | null>}
   */
  findByCode(code, options = {}) {
    return this.#collection.findOne({ code }, options.session ? { session: options.session } : {});
  }

  /**
   * Suma un uso respetando el limite global de forma atomica.
   * @param {import('mongodb').ObjectId} couponId
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<boolean>} false si el cupon ya no admite mas usos o esta inactivo.
   */
  async incrementUsage(couponId, { session } = {}) {
    const result = await this.#collection.updateOne(
      {
        _id: couponId,
        isActive: true,
        $or: [{ maxUses: null }, { maxUses: { $exists: false } }, { $expr: { $lt: ['$usedCount', '$maxUses'] } }],
      },
      { $inc: { usedCount: 1 }, $set: { updatedAt: new Date() } },
      { session },
    );
    return result.modifiedCount === 1;
  }
}
