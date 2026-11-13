/**
 * Rutas de cupones del panel (/api/v1/admin/coupons).
 *
 * El router padre (admin.routes.js) ya aplica authenticate y
 * requireRoles(admin, superuser); aqui se exige el permiso fino por ruta.
 * /applicable-products se registra antes que /:id para que no se interprete
 * como identificador.
 *
 * | Metodo | Ruta                 | Permiso         |
 * |--------|----------------------|-----------------|
 * | GET    | /applicable-products | coupons:manage  |
 * | GET    | /                    | coupons:manage  |
 * | POST   | /                    | coupons:manage  |
 * | GET    | /:id                 | coupons:manage  |
 * | PATCH  | /:id                 | coupons:manage  |
 * | PATCH  | /:id/deactivate      | coupons:manage  |
 */
import { Router } from 'express';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import {
  applicableProductsQuerySchema,
  createCouponSchema,
  idParamSchema,
  listCouponsQuerySchema,
  updateCouponSchema,
} from '../validators/admin-coupon.validator.js';

/**
 * @param {{ adminCouponController: import('../controllers/admin-coupon.controller.js').AdminCouponController }} deps
 * @returns {Router}
 */
export function createAdminCouponRoutes({ adminCouponController }) {
  const router = Router();
  const canManage = authorize(P.COUPONS_MANAGE);
  const validId = validate(idParamSchema, 'params');

  router.get(
    '/applicable-products',
    canManage,
    validate(applicableProductsQuerySchema, 'query'),
    adminCouponController.listApplicableProducts,
  );
  router.get('/', canManage, validate(listCouponsQuerySchema, 'query'), adminCouponController.list);
  router.post('/', canManage, validate(createCouponSchema), adminCouponController.create);

  router.get('/:id', canManage, validId, adminCouponController.getById);
  router.patch('/:id', canManage, validId, validate(updateCouponSchema), adminCouponController.update);
  router.patch('/:id/deactivate', canManage, validId, adminCouponController.deactivate);

  return router;
}
