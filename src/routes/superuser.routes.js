/**
 * Enrutador del modulo exclusivo de superusuario (Fase 4), montado en
 * /api/superuser (y /api/v1/superuser).
 *
 * Perimetro unico a nivel de router:
 * 1) authenticate: JWT valido, cuenta activa y rol ACTUAL leido de la base de datos (401 si falla);
 * 2) requireSuperuser: cualquier rol distinto de superuser, incluido admin, recibe 403 FORBIDDEN.
 * Despues, cada sub-router exige ademas su permiso fino con authorize().
 *
 * | Prefijo     | Modulo                          | Permiso fino         |
 * |-------------|---------------------------------|----------------------|
 * | /staff      | personal (admins y superusuarios) | admins:manage      |
 * | /settings   | configuracion global            | settings:manage      |
 * | /audit-logs | lectura de la bitacora          | audit:read           |
 * | /purge      | borrado fisico controlado       | records:hard_delete  |
 */
import { Router } from 'express';
import { requireSuperuser } from '../middlewares/require-superuser.js';
import { createSuperuserAuditLogRoutes } from './superuser-audit-log.routes.js';
import { createSuperuserPurgeRoutes } from './superuser-purge.routes.js';
import { createSuperuserSettingsRoutes } from './superuser-settings.routes.js';
import { createSuperuserStaffRoutes } from './superuser-staff.routes.js';

/**
 * @param {{ controllers: { staff: object, settings: object, auditLog: object, purge: object },
 *           authenticate: import('express').RequestHandler }} deps
 * @returns {Router}
 */
export function createSuperuserRoutes({ controllers, authenticate }) {
  const router = Router();

  // Perimetro comun: sesion valida y rol superuser estricto para todo el modulo.
  router.use(authenticate, requireSuperuser);

  router.use('/staff', createSuperuserStaffRoutes({ staffController: controllers.staff }));
  router.use('/settings', createSuperuserSettingsRoutes({ settingsController: controllers.settings }));
  router.use('/audit-logs', createSuperuserAuditLogRoutes({ auditLogController: controllers.auditLog }));
  router.use('/purge', createSuperuserPurgeRoutes({ purgeController: controllers.purge }));

  return router;
}
