/**
 * Repositorio de audit_logs.
 *
 * Deliberadamente solo ofrece insertar y consultar: no hay metodos de
 * actualizacion ni borrado, lo que convierte la bitacora en append-only a
 * nivel de aplicacion.
 */
import { COLLECTIONS } from '../database/collections.js';

export class AuditLogRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.AUDIT_LOGS);
  }

  /**
   * Inserta una entrada de auditoria.
   * @param {object} entry
   */
  async create(entry) {
    const { insertedId } = await this.#collection.insertOne(entry);
    return { ...entry, _id: insertedId };
  }

  /**
   * Consulta paginada con filtros opcionales, ordenada de mas reciente a mas antigua.
   * @param {{ page: number, limit: number, action?: string, entity?: string, entityId?: string,
   *           actorId?: import('mongodb').ObjectId, outcome?: string, from?: Date, to?: Date }} criteria
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async list({ page, limit, action, entity, entityId, actorId, outcome, from, to }) {
    const filter = {};
    if (action) filter.action = action;
    if (entity) filter.entity = entity;
    if (entityId) filter.entityId = entityId;
    if (actorId) filter.actorId = actorId;
    if (outcome) filter.outcome = outcome;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to) filter.createdAt.$lte = to;
    }

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
