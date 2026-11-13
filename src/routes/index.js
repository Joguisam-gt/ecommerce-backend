/**
 * Enrutador raiz de la API.
 *
 * Monta cada modulo con las dependencias del contenedor. Se publica en
 * /api/v1 (ruta canonica) y en /api (alias que cumple el contrato de la
 * Fase 2: /api/store, /api/cart, /api/pos, /api/invoices). La cookie de
 * refresco solo viaja a /api/v1/auth, por lo que el refresco debe usar esa ruta.
 */
import { Router } from 'express';
import { createAdminRoutes } from './admin.routes.js';
import { createAuditLogRoutes } from './audit-log.routes.js';
import { createAuthRoutes } from './auth.routes.js';
import { createCartRoutes } from './cart.routes.js';
import { createInvoiceRoutes } from './invoice.routes.js';
import { createPosRoutes } from './pos.routes.js';
import { createStoreRoutes } from './store.routes.js';
import { createUserRoutes } from './user.routes.js';

/**
 * @param {{ controllers: Record<string, any>, middlewares: { authenticate: import('express').RequestHandler } }} container
 * @returns {Router}
 */
export function createApiRouter({ controllers, middlewares }) {
  const router = Router();
  const { authenticate } = middlewares;

  router.get('/health', controllers.health.check);

  // Fase 1: identidad y administracion.
  router.use('/auth', createAuthRoutes({ authController: controllers.auth, authenticate }));
  router.use('/users', createUserRoutes({ userController: controllers.user, authenticate }));
  router.use('/audit-logs', createAuditLogRoutes({ auditLogController: controllers.auditLog, authenticate }));

  // Fase 3: panel de administracion (JWT + RBAC admin/superuser). Solo se monta si el contenedor lo construyo.
  if (controllers.admin) {
    router.use('/admin', createAdminRoutes({ controllers: controllers.admin, authenticate }));
  }

  // Fase 2: tienda, carrito, POS y facturacion.
  router.use('/store', createStoreRoutes({ storeController: controllers.store }));
  router.use('/cart', createCartRoutes({ cartController: controllers.cart, authenticate }));
  router.use('/pos', createPosRoutes({ posController: controllers.pos, authenticate }));
  router.use('/invoices', createInvoiceRoutes({ invoiceController: controllers.invoice, authenticate }));

  return router;
}
