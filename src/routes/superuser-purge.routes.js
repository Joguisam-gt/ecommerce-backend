/**
 * Purga (borrado fisico) del superusuario (Fase 4), montada en /api/superuser/purge.
 * Permiso fino: records:hard_delete. :collection en la lista blanca
 * (users, products, suppliers, coupons) y :id ObjectId; otro valor responde 400.
 */
import { Router } from 'express';
import { PERMISSIONS } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { purgeParamsSchema } from '../validators/purge.validator.js';

/**
 * @param {{ purgeController: import('../controllers/superuser-purge.controller.js').SuperuserPurgeController }} deps
 * @returns {Router}
 */
export function createSuperuserPurgeRoutes({ purgeController }) {
  const router = Router();

  router.delete(
    '/:collection/:id',
    authorize(PERMISSIONS.RECORDS_HARD_DELETE),
    validate(purgeParamsSchema, 'params'),
    purgeController.purge,
  );

  return router;
}
