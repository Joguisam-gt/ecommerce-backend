/**
 * Middlewares de autorizacion RBAC.
 *
 * authorize(...permisos) exige que el rol del usuario tenga TODOS los permisos
 * indicados. Es la forma recomendada: las rutas dependen de permisos, no de
 * roles concretos. requireRoles se ofrece para casos excepcionales.
 * Deben montarse despues de authenticate.
 */
import { hasPermission } from '../constants/permissions.js';
import { HttpError } from '../utils/http-error.js';

/**
 * @param {...string} permissions
 * @returns {import('express').RequestHandler}
 */
export function authorize(...permissions) {
  if (permissions.length === 0) throw new Error('authorize() requiere al menos un permiso');

  return function authorizeMiddleware(req, _res, next) {
    if (!req.user) return next(HttpError.unauthorized('Autenticacion requerida', 'AUTH_REQUIRED'));

    const allowed = permissions.every((permission) => hasPermission(req.user.role, permission));
    if (!allowed) return next(HttpError.forbidden('No tienes permisos para esta operacion', 'FORBIDDEN'));

    return next();
  };
}

/**
 * @param {...string} roles Roles admitidos (basta con uno).
 * @returns {import('express').RequestHandler}
 */
export function requireRoles(...roles) {
  if (roles.length === 0) throw new Error('requireRoles() requiere al menos un rol');

  return function requireRolesMiddleware(req, _res, next) {
    if (!req.user) return next(HttpError.unauthorized('Autenticacion requerida', 'AUTH_REQUIRED'));
    if (!roles.includes(req.user.role)) return next(HttpError.forbidden('No tienes permisos para esta operacion', 'FORBIDDEN'));
    return next();
  };
}
