/**
 * Bitacora de auditoria del superusuario (Fase 4), montada en /api/superuser/audit-logs.
 * Solo GET: no existe ninguna ruta que actualice o borre audit_logs.
 * Permiso fino: audit:read.
 *
 * Query: page, limit (max 100), actorId, role, action, targetCollection,
 * startDate, endDate (ISO 8601, startDate <= endDate).
 */
import { Router } from 'express';
import { PERMISSIONS } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { superuserAuditLogsQuerySchema } from '../validators/superuser-audit-log.validator.js';

/**
 * @param {{ auditLogController: import('../controllers/superuser-audit-log.controller.js').SuperuserAuditLogController }} deps
 * @returns {Router}
 */
export function createSuperuserAuditLogRoutes({ auditLogController }) {
  const router = Router();

  router.get('/', authorize(PERMISSIONS.AUDIT_READ), validate(superuserAuditLogsQuerySchema, 'query'), auditLogController.list);

  return router;
}
