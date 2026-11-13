/**
 * Rutas del punto de venta (/api/pos).
 *
 * | Metodo | Ruta      | Permiso  | superuser | admin | user |
 * |--------|-----------|----------|-----------|-------|------|
 * | POST   | /checkout | pos:use  | si        | si    | si   |
 *
 * Orden de middlewares: authenticate -> authorize -> maintenanceGuard (Fase 4,
 * opcional: 503 MAINTENANCE_MODE si la tienda esta en mantenimiento) ->
 * pciGuard (antes de validar, para que ningun dato de tarjeta llegue a otras
 * capas) -> validateCheckout (esquema segun el metodo de pago e Idempotency-Key).
 */
import { Router } from 'express';
import { PERMISSIONS } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { pciGuard } from '../middlewares/pci-guard.js';
import { validateCheckout } from '../middlewares/validate-checkout.js';

/**
 * @param {{ posController: import('../controllers/pos.controller.js').PosController,
 *           authenticate: import('express').RequestHandler,
 *           maintenanceGuard?: import('express').RequestHandler }} deps
 * @returns {Router}
 */
export function createPosRoutes({ posController, authenticate, maintenanceGuard }) {
  const router = Router();
  // Guard opcional: sin el, la ruta queda exactamente como en la Fase 2.
  const maintenance = maintenanceGuard ? [maintenanceGuard] : [];

  router.post(
    '/checkout',
    authenticate,
    authorize(PERMISSIONS.POS_USE),
    ...maintenance,
    pciGuard,
    validateCheckout,
    posController.checkout,
  );

  return router;
}
