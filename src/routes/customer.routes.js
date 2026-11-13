/**
 * Rutas del directorio de clientes (/api/v1/admin/customers).
 *
 * El router padre (admin.routes.js) ya aplica authenticate y
 * requireRoles(admin, superuser); aqui cada ruta exige su permiso fino.
 * Solo se gestionan cuentas con rol user (ver CustomerService).
 *
 * | Metodo | Ruta            | Permiso                                | superuser | admin |
 * |--------|-----------------|----------------------------------------|-----------|-------|
 * | GET    | /               | customers:manage                       | si        | si    |
 * | GET    | /:id            | customers:manage                       | si        | si    |
 * | PATCH  | /:id            | customers:manage                       | si        | si    |
 * | PATCH  | /:id/deactivate | customers:manage                       | si        | si    |
 * | DELETE | /:id            | customers:manage + records:hard_delete | si        | no    |
 */
import { Router } from 'express';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { idParamSchema, listCustomersQuerySchema, updateCustomerSchema } from '../validators/customer.validator.js';

/**
 * @param {{ customerController: import('../controllers/customer.controller.js').CustomerController }} deps
 * @returns {Router}
 */
export function createCustomerRoutes({ customerController }) {
  const router = Router();
  const canManage = authorize(P.CUSTOMERS_MANAGE);
  const validId = validate(idParamSchema, 'params');

  router.get('/', canManage, validate(listCustomersQuerySchema, 'query'), customerController.list);
  router.get('/:id', canManage, validId, customerController.getById);
  router.patch('/:id', canManage, validId, validate(updateCustomerSchema), customerController.update);
  router.patch('/:id/deactivate', canManage, validId, customerController.deactivate);
  router.delete('/:id', authorize(P.CUSTOMERS_MANAGE, P.RECORDS_HARD_DELETE), validId, customerController.remove);

  return router;
}
