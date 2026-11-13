/**
 * Rutas de auditoria (/api/v1/audit-logs). Solo lectura y solo superusuario (audit:read).
 */
import { Router } from 'express';
import { PERMISSIONS } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { listAuditLogsQuerySchema } from '../validators/audit-log.validator.js';

/**
 * @param {{ auditLogController: import('../controllers/audit-log.controller.js').AuditLogController,
 *           authenticate: import('express').RequestHandler }} deps
 * @returns {Router}
 */
export function createAuditLogRoutes({ auditLogController, authenticate }) {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize(PERMISSIONS.AUDIT_READ),
    validate(listAuditLogsQuerySchema, 'query'),
    auditLogController.list,
  );

  return router;
}
