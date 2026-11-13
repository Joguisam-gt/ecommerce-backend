/**
 * Rutas de inventario del panel (/api/v1/admin/inventory, Fase 3).
 *
 * El router padre (admin.routes.js) ya aplica authenticate y
 * requireRoles(admin, superuser); aqui cada ruta exige inventory:manage.
 * Las rutas /losses se registran antes que /:id.
 *
 * | Metodo | Ruta     | Permiso          |
 * |--------|----------|------------------|
 * | GET    | /losses  | inventory:manage |
 * | POST   | /losses  | inventory:manage |
 * | GET    | /        | inventory:manage |
 * | GET    | /:id     | inventory:manage |
 */
import { Router } from 'express';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import {
  idParamSchema,
  listInventoryQuerySchema,
  listLossesQuerySchema,
  recordLossSchema,
} from '../validators/inventory.validator.js';

/**
 * @param {{ inventoryController: import('../controllers/inventory.controller.js').InventoryController }} deps
 * @returns {Router}
 */
export function createInventoryRoutes({ inventoryController }) {
  const router = Router();
  const canManage = authorize(P.INVENTORY_MANAGE);

  router.get('/losses', canManage, validate(listLossesQuerySchema, 'query'), inventoryController.listLosses);
  router.post('/losses', canManage, validate(recordLossSchema), inventoryController.recordLoss);

  router.get('/', canManage, validate(listInventoryQuerySchema, 'query'), inventoryController.list);
  router.get('/:id', canManage, validate(idParamSchema, 'params'), inventoryController.getById);

  return router;
}
