/**
 * Rutas de reportes analiticos (/api/v1/admin/reports).
 *
 * El router padre ya aplica authenticate y requireRoles(admin, superuser).
 *
 * | Metodo | Ruta                                 | Permiso      |
 * |--------|--------------------------------------|--------------|
 * | GET    | /general                             | reports:read |
 * | GET    | /products/:id/supplier-performance   | reports:read |
 */
import { Router } from 'express';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { generalReportQuerySchema, idParamSchema, supplierPerformanceQuerySchema } from '../validators/report.validator.js';

/**
 * @param {{ reportController: import('../controllers/report.controller.js').ReportController }} deps
 * @returns {Router}
 */
export function createReportRoutes({ reportController }) {
  const router = Router();
  const canRead = authorize(P.REPORTS_READ);

  router.get('/general', canRead, validate(generalReportQuerySchema, 'query'), reportController.general);
  router.get(
    '/products/:id/supplier-performance',
    canRead,
    validate(idParamSchema, 'params'),
    validate(supplierPerformanceQuerySchema, 'query'),
    reportController.supplierPerformance,
  );

  return router;
}
