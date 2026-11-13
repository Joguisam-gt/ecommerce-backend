/**
 * Rutas de la facturacion administrativa (/api/v1/admin/invoices).
 *
 * El router padre ya aplica authenticate y requireRoles(admin, superuser).
 *
 * | Metodo | Ruta | Permiso         | Descripcion                                   |
 * |--------|------|-----------------|-----------------------------------------------|
 * | GET    | /    | invoices:manage | listado con filtros (cliente y proveedor)     |
 * | GET    | /:id | invoices:manage | detalle con desglose de productos y totales   |
 */
import { Router } from 'express';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { idParamSchema, listAdminInvoicesQuerySchema } from '../validators/admin-invoice.validator.js';

/**
 * @param {{ adminInvoiceController: import('../controllers/admin-invoice.controller.js').AdminInvoiceController }} deps
 * @returns {Router}
 */
export function createAdminInvoiceRoutes({ adminInvoiceController }) {
  const router = Router();
  const canManage = authorize(P.INVOICES_MANAGE);

  router.get('/', canManage, validate(listAdminInvoicesQuerySchema, 'query'), adminInvoiceController.list);
  router.get('/:id', canManage, validate(idParamSchema, 'params'), adminInvoiceController.getById);

  return router;
}
