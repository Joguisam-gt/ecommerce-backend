/**
 * Gestion de personal (Fase 4), montada en /api/superuser/staff.
 * El router padre ya aplico authenticate + requireSuperuser; aqui se exige
 * ademas el permiso fino admins:manage (defensa en profundidad).
 *
 * | Metodo | Ruta         | Cuerpo / query                                   |
 * |--------|--------------|--------------------------------------------------|
 * | GET    | /            | page, limit, role (admin/superuser), isActive, search |
 * | POST   | /            | email, password, firstName, lastName, phone?, role (admin/superuser) |
 * | PATCH  | /:id/role    | { role } (cualquier rol)                         |
 * | PATCH  | /:id/status  | { isActive: boolean }                            |
 */
import { Router } from 'express';
import { PERMISSIONS } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import {
  changeStaffRoleSchema,
  changeStaffStatusSchema,
  createStaffSchema,
  idParamSchema,
  listStaffQuerySchema,
} from '../validators/staff.validator.js';

/**
 * @param {{ staffController: import('../controllers/superuser-staff.controller.js').SuperuserStaffController }} deps
 * @returns {Router}
 */
export function createSuperuserStaffRoutes({ staffController }) {
  const router = Router();
  const validId = validate(idParamSchema, 'params');

  router.use(authorize(PERMISSIONS.ADMINS_MANAGE));

  router.get('/', validate(listStaffQuerySchema, 'query'), staffController.list);
  router.post('/', validate(createStaffSchema), staffController.create);
  router.patch('/:id/role', validId, validate(changeStaffRoleSchema), staffController.changeRole);
  router.patch('/:id/status', validId, validate(changeStaffStatusSchema), staffController.changeStatus);

  return router;
}
