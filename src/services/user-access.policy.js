/**
 * Politica de acceso entre usuarios (reglas jerarquicas del RBAC).
 *
 * Los permisos dicen QUE operacion puede hacer un rol; esta politica decide
 * SOBRE QUIEN puede hacerla. Son funciones puras, sin E/S, faciles de probar.
 *
 * Reglas:
 * - superuser gestiona cualquier cuenta y puede asignar cualquier rol.
 * - admin solo gestiona cuentas de rango inferior (clientes) y solo asigna el rol user.
 * - user no gestiona cuentas ajenas.
 * - Nadie puede cambiar su propio rol, desactivarse ni borrarse a si mismo.
 */
import { ROLE_RANK, ROLES, isValidRole } from '../constants/roles.js';

/**
 * @param {string} actorRole
 * @param {string} targetRole
 * @returns {boolean} true si el actor tiene un rango estrictamente superior.
 */
export function outranks(actorRole, targetRole) {
  return (ROLE_RANK[actorRole] ?? 0) > (ROLE_RANK[targetRole] ?? 0);
}

/**
 * @param {{ role: string }} actor
 * @param {{ role: string }} target
 * @returns {boolean}
 */
export function canManageUser(actor, target) {
  if (actor.role === ROLES.SUPERUSER) return true;
  if (actor.role === ROLES.ADMIN) return outranks(actor.role, target.role);
  return false;
}

/**
 * @param {string} actorRole
 * @param {string} role Rol que se quiere asignar.
 * @returns {boolean}
 */
export function canAssignRole(actorRole, role) {
  if (!isValidRole(role)) return false;
  if (actorRole === ROLES.SUPERUSER) return true;
  if (actorRole === ROLES.ADMIN) return role === ROLES.USER;
  return false;
}

/**
 * @param {{ id: string }} actor
 * @param {{ _id: { toString(): string } }} target
 * @returns {boolean}
 */
export function isSelf(actor, target) {
  return actor.id === target._id.toString();
}
