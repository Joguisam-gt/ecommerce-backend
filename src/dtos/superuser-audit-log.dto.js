/**
 * DTOs de la consulta de audit_logs del superusuario (Fase 4).
 *
 * La entrada convierte la query ya validada (role -> actorRole, fechas a Date
 * con la convencion de utils/date-range.js). La salida es una lista blanca que
 * incluye los campos de la Fase 3 (cambio completo) y de la Fase 4
 * (targetCollection, timestamp y snapshot).
 */
import { AUDIT_LOG_DEFAULT_LIMIT } from '../constants/superuser.js';
import { parseRangeBoundary } from '../utils/date-range.js';

export class SuperuserAuditLogQueryDTO {
  /** @param {Record<string, string>} query Query ya validada con superuserAuditLogsQuerySchema. */
  static from(query) {
    return Object.freeze({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : AUDIT_LOG_DEFAULT_LIMIT,
      actorId: query.actorId,
      actorRole: query.role,
      action: query.action,
      targetCollection: query.targetCollection,
      startDate: query.startDate ? parseRangeBoundary(query.startDate, 'start') : undefined,
      endDate: query.endDate ? parseRangeBoundary(query.endDate, 'end') : undefined,
    });
  }
}

/**
 * Convierte un ObjectId opcional en texto.
 * @param {unknown} value
 * @returns {string | null}
 */
const idOrNull = (value) => (value ? value.toString() : null);

export class SuperuserAuditLogResponseDTO {
  /** @param {object} log Documento de audit_logs. */
  static from(log) {
    return {
      id: log._id.toString(),
      action: log.action,
      outcome: log.outcome,
      entity: log.entity,
      entityId: log.entityId ?? null,
      targetCollection: log.targetCollection ?? null,
      targetId: log.targetId ?? log.entityId ?? null,
      actorId: idOrNull(log.actorId),
      actorRole: log.actorRole ?? null,
      metadata: log.metadata ?? {},
      previousState: log.previousState ?? null,
      newState: log.newState ?? null,
      snapshot: log.snapshot ?? null,
      ip: log.ip ?? null,
      userAgent: log.userAgent ?? null,
      timestamp: log.timestamp ?? log.createdAt,
      createdAt: log.createdAt,
    };
  }

  /** @param {object[]} logs */
  static fromMany(logs) {
    return logs.map((log) => SuperuserAuditLogResponseDTO.from(log));
  }
}
