/**
 * Enrutador raiz de la API versionada (/api/v1).
 *
 * Monta cada modulo con las dependencias del contenedor. Las fases siguientes
 * (productos, carrito, pedidos...) se anaden aqui sin modificar los existentes.
 */
import { Router } from 'express';
import { createAuditLogRoutes } from './audit-log.routes.js';
import { createAuthRoutes } from './auth.routes.js';
import { createUserRoutes } from './user.routes.js';

/**
 * @param {{ controllers: Record<string, any>, middlewares: { authenticate: import('express').RequestHandler } }} container
 * @returns {Router}
 */
export function createApiRouter({ controllers, middlewares }) {
  const router = Router();
  const { authenticate } = middlewares;

  router.get('/health', controllers.health.check);
  router.use('/auth', createAuthRoutes({ authController: controllers.auth, authenticate }));
  router.use('/users', createUserRoutes({ userController: controllers.user, authenticate }));
  router.use('/audit-logs', createAuditLogRoutes({ auditLogController: controllers.auditLog, authenticate }));

  return router;
}
