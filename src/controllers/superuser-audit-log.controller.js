/**
 * Controlador de la bitacora para el superusuario (Fase 4, GET /api/superuser/audit-logs).
 * Solo lectura: no existe ninguna ruta ni metodo que modifique o borre audit_logs.
 */
import { SuperuserAuditLogQueryDTO, SuperuserAuditLogResponseDTO } from '../dtos/superuser-audit-log.dto.js';

export class SuperuserAuditLogController {
  #audit;

  /** @param {{ auditService: import('../services/audit.service.js').AuditService }} deps */
  constructor({ auditService }) {
    this.#audit = auditService;
  }

  /** GET /superuser/audit-logs */
  list = async (req, res) => {
    const { items, total, page, limit } = await this.#audit.search(SuperuserAuditLogQueryDTO.from(req.query));
    res.json({
      data: SuperuserAuditLogResponseDTO.fromMany(items),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  };
}
