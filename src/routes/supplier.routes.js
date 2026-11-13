/**
 * Rutas de proveedores (/api/v1/admin/suppliers, Fase 3).
 *
 * El router padre ya aplica authenticate y requireRoles(admin, superuser);
 * aqui cada ruta exige suppliers:manage y el borrado fisico ademas
 * records:hard_delete (solo superusuario; el servicio lo vuelve a comprobar).
 *
 * | Metodo | Ruta            | Permiso                                | superuser | admin |
 * |--------|-----------------|----------------------------------------|-----------|-------|
 * | POST   | /               | suppliers:manage                       | si        | si    |
 * | GET    | /               | suppliers:manage                       | si        | si    |
 * | GET    | /:id            | suppliers:manage                       | si        | si    |
 * | PATCH  | /:id            | suppliers:manage                       | si        | si    |
 * | PATCH  | /:id/deactivate | suppliers:manage                       | si        | si    |
 * | DELETE | /:id            | suppliers:manage + records:hard_delete | si        | no    |
 */
import { Router } from 'express';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import {
  createSupplierSchema,
  idParamSchema,
  listSuppliersQuerySchema,
  updateSupplierSchema,
} from '../validators/supplier.validator.js';

/**
 * @param {{ supplierController: import('../controllers/supplier.controller.js').SupplierController }} deps
 * @returns {Router}
 */
export function createSupplierRoutes({ supplierController }) {
  const router = Router();
  const canManage = authorize(P.SUPPLIERS_MANAGE);
  const validId = validate(idParamSchema, 'params');

  router.post('/', canManage, validate(createSupplierSchema), supplierController.create);
  router.get('/', canManage, validate(listSuppliersQuerySchema, 'query'), supplierController.list);
  router.get('/:id', canManage, validId, supplierController.getById);
  router.patch('/:id', canManage, validId, validate(updateSupplierSchema), supplierController.update);
  router.patch('/:id/deactivate', canManage, validId, supplierController.deactivate);
  router.delete('/:id', authorize(P.SUPPLIERS_MANAGE, P.RECORDS_HARD_DELETE), validId, supplierController.remove);

  return router;
}
