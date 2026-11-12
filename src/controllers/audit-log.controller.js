/**
 * Controlador de la bitacora de auditoria (lectura exclusiva del superusuario).
 */
import { AuditLogResponseDTO, ListAuditLogsQueryDTO } from '../dtos/audit-log.dto.js';

export class AuditLogController {
  #audit;

  /** @param {{ auditService: import('../services/audit.service.js').AuditService }} deps */
  constructor({ auditService }) {
    this.#audit = auditService;
  }

  /** GET /audit-logs */
  list = async (req, res) => {
    const { items, total, page, limit } = await this.#audit.list(ListAuditLogsQueryDTO.from(req.query));
    res.json({
      data: AuditLogResponseDTO.fromMany(items),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  };
}
