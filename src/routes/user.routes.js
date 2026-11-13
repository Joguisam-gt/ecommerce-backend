/**
 * Rutas de usuarios (/api/v1/users).
 *
 * Cada ruta declara el permiso que necesita. Las rutas /me se registran antes
 * que /:id para que "me" no se interprete como identificador.
 *
 * | Metodo | Ruta              | Permiso           | superuser | admin | user |
 * |--------|-------------------|-------------------|-----------|-------|------|
 * | GET    | /me               | profile:read      | si        | si    | si   |
 * | PATCH  | /me               | profile:update    | si        | si    | si   |
 * | GET    | /                 | users:read        | si        | si    | no   |
 * | POST   | /                 | users:create      | si        | si(1) | no   |
 * | GET    | /:id              | users:read        | si        | si    | no   |
 * | PATCH  | /:id              | users:update      | si        | si(1) | no   |
 * | PATCH  | /:id/status       | users:deactivate  | si        | si(1) | no   |
 * | PATCH  | /:id/role         | admins:manage     | si        | no    | no   |
 * | DELETE | /:id              | users:delete      | si        | no    | no   |
 * (1) solo sobre cuentas con rol user (ver user-access.policy.js).
 * PATCH /:id/role y /:id/status se ejecutan en la transaccion de StaffService
 * (regla anti-bloqueo del ultimo superusuario). DELETE /:id delega en
 * PurgeService: 400 NOT_SOFT_DELETED si la cuenta sigue activa y 409
 * FISCAL_INTEGRITY_LOCK si tiene pedidos o facturas.
 */
import { Router } from 'express';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { idParamSchema } from '../validators/common.rules.js';
import {
  changeRoleSchema,
  changeStatusSchema,
  createUserSchema,
  listUsersQuerySchema,
  updateProfileSchema,
  updateUserSchema,
} from '../validators/user.validator.js';

/**
 * @param {{ userController: import('../controllers/user.controller.js').UserController,
 *           authenticate: import('express').RequestHandler }} deps
 * @returns {Router}
 */
export function createUserRoutes({ userController, authenticate }) {
  const router = Router();
  const validId = validate(idParamSchema, 'params');

  router.use(authenticate);

  router.get('/me', authorize(P.PROFILE_READ), userController.getMe);
  router.patch('/me', authorize(P.PROFILE_UPDATE), validate(updateProfileSchema), userController.updateMe);

  router.get('/', authorize(P.USERS_READ), validate(listUsersQuerySchema, 'query'), userController.list);
  router.post('/', authorize(P.USERS_CREATE), validate(createUserSchema), userController.create);

  router.get('/:id', authorize(P.USERS_READ), validId, userController.getById);
  router.patch('/:id', authorize(P.USERS_UPDATE), validId, validate(updateUserSchema), userController.update);
  router.patch('/:id/status', authorize(P.USERS_DEACTIVATE), validId, validate(changeStatusSchema), userController.changeStatus);
  router.patch('/:id/role', authorize(P.ADMINS_MANAGE), validId, validate(changeRoleSchema), userController.changeRole);
  router.delete('/:id', authorize(P.USERS_DELETE), validId, userController.remove);

  return router;
}
