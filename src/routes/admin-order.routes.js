/**
 * Rutas de conciliacion de transferencias (/api/v1/admin/orders).
 *
 * El router padre (admin.routes.js) ya aplica authenticate y
 * requireRoles(admin, superuser); aqui se exige el permiso fino por ruta.
 *
 * | Metodo | Ruta                  | Permiso        |
 * |--------|-----------------------|----------------|
 * | GET    | /pending-verification | orders:manage  |
 * | PATCH  | /:id/reconcile        | orders:manage  |
 */
import { Router } from 'express';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import {
  idParamSchema,
  listPendingVerificationQuerySchema,
  reconcileOrderSchema,
} from '../validators/admin-order.validator.js';

/**
 * @param {{ adminOrderController: import('../controllers/admin-order.controller.js').AdminOrderController }} deps
 * @returns {Router}
 */
export function createAdminOrderRoutes({ adminOrderController }) {
  const router = Router();
  const canManage = authorize(P.ORDERS_MANAGE);

  router.get(
    '/pending-verification',
    canManage,
    validate(listPendingVerificationQuerySchema, 'query'),
    adminOrderController.listPendingVerification,
  );
  router.patch(
    '/:id/reconcile',
    canManage,
    validate(idParamSchema, 'params'),
    validate(reconcileOrderSchema),
    adminOrderController.reconcile,
  );

  return router;
}
