/**
 * Rutas de facturas (/api/invoices). Requieren sesion; el alcance de los
 * datos lo decide InvoiceService (propias o todas con invoices:manage).
 *
 * | Metodo | Ruta | Acceso                                  |
 * |--------|------|-----------------------------------------|
 * | GET    | /    | autenticado (propias o todas si manage) |
 * | GET    | /:id | autenticado (404 si es ajena)           |
 */
import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { idParamSchema } from '../validators/common.rules.js';
import { listInvoicesQuerySchema } from '../validators/invoice.validator.js';

/**
 * @param {{ invoiceController: import('../controllers/invoice.controller.js').InvoiceController,
 *           authenticate: import('express').RequestHandler }} deps
 * @returns {Router}
 */
export function createInvoiceRoutes({ invoiceController, authenticate }) {
  const router = Router();

  router.use(authenticate);
  router.get('/', validate(listInvoicesQuerySchema, 'query'), invoiceController.list);
  router.get('/:id', validate(idParamSchema, 'params'), invoiceController.getById);

  return router;
}
