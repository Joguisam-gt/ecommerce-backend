/**
 * Rutas de compras a proveedores (/api/v1/admin/purchases, Fase 3).
 *
 * El router padre ya aplica authenticate y requireRoles(admin, superuser);
 * aqui cada ruta exige inventory:manage (la compra ingresa mercaderia).
 *
 * | Metodo | Ruta | Permiso          |
 * |--------|------|------------------|
 * | POST   | /    | inventory:manage |
 * | GET    | /    | inventory:manage |
 * | GET    | /:id | inventory:manage |
 */
import { Router } from 'express';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { createPurchaseSchema, idParamSchema, listPurchasesQuerySchema } from '../validators/purchase.validator.js';

/**
 * @param {{ purchaseController: import('../controllers/purchase.controller.js').PurchaseController }} deps
 * @returns {Router}
 */
export function createPurchaseRoutes({ purchaseController }) {
  const router = Router();
  const canManage = authorize(P.INVENTORY_MANAGE);

  router.post('/', canManage, validate(createPurchaseSchema), purchaseController.create);
  router.get('/', canManage, validate(listPurchasesQuerySchema, 'query'), purchaseController.list);
  router.get('/:id', canManage, validate(idParamSchema, 'params'), purchaseController.getById);

  return router;
}
