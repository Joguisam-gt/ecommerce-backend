/**
 * Rutas de autenticacion (/api/v1/auth).
 *
 * register, login y refresh son publicas; logout y password requieren sesion.
 */
import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { changePasswordSchema, loginSchema, registerSchema } from '../validators/auth.validator.js';

/**
 * @param {{ authController: import('../controllers/auth.controller.js').AuthController,
 *           authenticate: import('express').RequestHandler }} deps
 * @returns {Router}
 */
export function createAuthRoutes({ authController, authenticate }) {
  const router = Router();

  router.post('/register', validate(registerSchema), authController.register);
  router.post('/login', validate(loginSchema), authController.login);
  router.post('/refresh', authController.refresh);
  router.post('/logout', authenticate, authController.logout);
  router.patch('/password', authenticate, validate(changePasswordSchema), authController.changePassword);

  return router;
}
