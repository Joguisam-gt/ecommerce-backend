/**
 * Guard RBAC estricto del modulo de superusuario (Fase 4).
 *
 * Basado en requireRoles(ROLES.SUPERUSER): exige que el rol ACTUAL del usuario
 * autenticado (leido de la base de datos por authenticate) sea superuser.
 * - Sin req.user (authenticate no se ejecuto o fallo): 401 AUTH_REQUIRED.
 * - Cualquier otro rol, incluido admin: 403 FORBIDDEN.
 * Se monta a nivel de router, despues de authenticate, en /api/superuser.
 */
import { ROLES } from '../constants/roles.js';
import { requireRoles } from './authorize.js';

/** Roles admitidos por el guard (solo el superusuario). */
export const SUPERUSER_ONLY_ROLES = Object.freeze([ROLES.SUPERUSER]);

/** @type {import('express').RequestHandler} */
export const requireSuperuser = requireRoles(...SUPERUSER_ONLY_ROLES);
