/**
 * DTOs de audit_logs: parametros de consulta y forma de respuesta.
 */

export class ListAuditLogsQueryDTO {
  /** @param {Record<string, string>} query */
  static from(query) {
    return Object.freeze({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 50,
      action: query.action,
      entity: query.entity,
      entityId: query.entityId,
      actorId: query.actorId,
      outcome: query.outcome,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }
}

export class AuditLogResponseDTO {
  /** @param {object} log Documento de audit_logs. */
  static from(log) {
    return {
      id: log._id.toString(),
      action: log.action,
      outcome: log.outcome,
      entity: log.entity,
      entityId: log.entityId ?? null,
      actorId: log.actorId ? log.actorId.toString() : null,
      actorRole: log.actorRole ?? null,
      metadata: log.metadata ?? {},
      ip: log.ip ?? null,
      userAgent: log.userAgent ?? null,
      createdAt: log.createdAt,
    };
  }

  /** @param {object[]} logs */
  static fromMany(logs) {
    return logs.map((log) => AuditLogResponseDTO.from(log));
  }
}
