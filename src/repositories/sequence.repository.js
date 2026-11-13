/**
 * Repositorio de secuencias atomicas (coleccion counters).
 *
 * Genera numeros correlativos para pedidos y facturas con un $inc atomico.
 * Llamado dentro de la transaccion de checkout, un rollback tambien revierte
 * el numero consumido, por lo que la numeracion fiscal no tiene huecos.
 */
import { COLLECTIONS } from '../database/collections.js';

export class SequenceRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.COUNTERS);
  }

  /**
   * Incrementa la secuencia y devuelve el nuevo valor (1 en la primera llamada).
   * @param {string} name Nombre de la secuencia ('order', 'invoice'); patron ^[a-z_]{2,40}$.
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<number>}
   */
  async next(name, { session } = {}) {
    const doc = await this.#collection.findOneAndUpdate(
      { _id: name },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: false, ...(session ? { session } : {}) },
    );
    return doc.seq;
  }
}
