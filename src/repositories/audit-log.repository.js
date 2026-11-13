/**
 * Repositorio de audit_logs.
 *
 * Deliberadamente solo ofrece insertar y consultar: no hay metodos de
 * actualizacion ni borrado, lo que convierte la bitacora en append-only a
 * nivel de aplicacion.
 *
 * Fase 4: create acepta { session } opcional para insertar dentro de una
 * transaccion (AuditService.recordInTransaction) y search sirve la consulta
 * del superusuario, filtrando y ordenando por timestamp.
 */
import { COLLECTIONS } from '../database/collections.js';

/**
 * Opciones del driver con la sesion opcional.
 * @param {import('mongodb').ClientSession | undefined} session
 */
const withSession = (session) => (session ? { session } : {});

/** Orden de la consulta del superusuario: mas reciente primero y desempate estable por _id. */
export const AUDIT_SEARCH_SORT = Object.freeze({ timestamp: -1, _id: -1 });

/**
 * Construye el filtro de la consulta del superusuario (funcion pura).
 * Todos los valores llegan ya validados y convertidos (ObjectId, Date).
 * @param {{ actorId?: import('mongodb').ObjectId, actorRole?: string, action?: string,
 *           targetCollection?: string, startDate?: Date, endDate?: Date }} criteria
 * @returns {object}
 */
export function buildAuditSearchFilter(criteria = {}) {
  const filter = {};
  if (criteria.actorId) filter.actorId = criteria.actorId;
  if (criteria.actorRole) filter.actorRole = criteria.actorRole;
  if (criteria.action) filter.action = criteria.action;
  if (criteria.targetCollection) filter.targetCollection = criteria.targetCollection;
  if (criteria.startDate || criteria.endDate) {
    filter.timestamp = {};
    if (criteria.startDate) filter.timestamp.$gte = criteria.startDate;
    if (criteria.endDate) filter.timestamp.$lte = criteria.endDate;
  }
  return filter;
}

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
   * @param {{ session?: import('mongodb').ClientSession }} [options] Sesion de la transaccion (Fase 4).
   */
  async create(entry, { session } = {}) {
    const { insertedId } = await this.#collection.insertOne(entry, withSession(session));
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

  /**
   * Consulta del superusuario (Fase 4): filtros por actor, rol, accion,
   * coleccion afectada y rango sobre timestamp; orden { timestamp: -1, _id: -1 }.
   * Usa ix_audit_collection_timestamp o ix_audit_timestamp segun los filtros.
   * @param {{ page: number, limit: number, actorId?: import('mongodb').ObjectId, actorRole?: string,
   *           action?: string, targetCollection?: string, startDate?: Date, endDate?: Date }} criteria
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async search(criteria) {
    const { page, limit } = criteria;
    const filter = buildAuditSearchFilter(criteria);
    const [items, total] = await Promise.all([
      this.#collection
        .find(filter)
        .sort(AUDIT_SEARCH_SORT)
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      this.#collection.countDocuments(filter),
    ]);
    return { items, total };
  }
}
