/**
 * Repositorio del directorio de clientes (Fase 3) sobre la coleccion users.
 *
 * Las lecturas del directorio ejecutan los pipelines puros de
 * pipelines/customer.pipeline.js. Las escrituras incluyen role: 'user' en el
 * filtro (defensa en profundidad): aunque el servicio ya lo comprueba, nunca
 * se modifica ni elimina una cuenta administrativa desde este modulo.
 * Todos los metodos reciben ObjectId ya convertidos por el servicio.
 */
import { ROLES } from '../constants/roles.js';
import { COLLECTIONS } from '../database/collections.js';
import { buildCustomerDetailPipeline, buildCustomerDirectoryPipeline } from './pipelines/customer.pipeline.js';

/** Opciones de findOneAndUpdate: devolver el documento ya modificado. */
const RETURN_AFTER = Object.freeze({ returnDocument: 'after', includeResultMetadata: false });

export class CustomerRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.USERS);
  }

  /**
   * Listado paginado del directorio con metricas.
   * @param {object} filters Ver buildCustomerDirectoryPipeline.
   * @param {{ page: number, limit: number }} pagination
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async listDirectory(filters, pagination) {
    const pipeline = buildCustomerDirectoryPipeline(filters, pagination);
    const [result] = await this.#collection.aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 10_000 }).toArray();
    return { items: result?.items ?? [], total: result?.total?.[0]?.total ?? 0 };
  }

  /**
   * Detalle con metricas de un cliente (rol user, activo o no).
   * @param {import('mongodb').ObjectId} id
   * @returns {Promise<object | null>}
   */
  async findDetailById(id) {
    const [row] = await this.#collection.aggregate(buildCustomerDetailPipeline(id), { maxTimeMS: 10_000 }).toArray();
    return row ?? null;
  }

  /**
   * Documento de users de cualquier rol (el servicio decide si es gestionable).
   * @param {import('mongodb').ObjectId} id
   * @returns {Promise<object | null>}
   */
  findById(id) {
    return this.#collection.findOne({ _id: id });
  }

  /**
   * @param {string} userCode Codigo ya normalizado.
   * @returns {Promise<object | null>}
   */
  findByUserCode(userCode) {
    return this.#collection.findOne({ userCode });
  }

  /**
   * Actualiza datos basicos de un cliente.
   * @param {import('mongodb').ObjectId} id
   * @param {object} changes
   * @param {Date} now
   */
  updateById(id, changes, now) {
    return this.#collection.findOneAndUpdate({ _id: id, role: ROLES.USER }, { $set: { ...changes, updatedAt: now } }, RETURN_AFTER);
  }

  /**
   * Borrado logico: isActive false e invalidacion de sesiones (tokenVersion + 1).
   * @param {import('mongodb').ObjectId} id
   * @param {Date} now
   */
  deactivate(id, now) {
    return this.#collection.findOneAndUpdate(
      { _id: id, role: ROLES.USER },
      { $set: { isActive: false, updatedAt: now }, $inc: { tokenVersion: 1 } },
      RETURN_AFTER,
    );
  }

  /**
   * Borrado fisico de un cliente.
   * @param {import('mongodb').ObjectId} id
   * @returns {Promise<boolean>} true si se elimino.
   */
  async deleteById(id) {
    const { deletedCount } = await this.#collection.deleteOne({ _id: id, role: ROLES.USER });
    return deletedCount === 1;
  }
}
