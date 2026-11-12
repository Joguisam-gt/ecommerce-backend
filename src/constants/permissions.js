/**
 * Catalogo de permisos y matriz rol -> permisos (RBAC).
 *
 * Las rutas nunca comprueban roles directamente: piden permisos. Asi, cambiar
 * lo que puede hacer un rol solo requiere editar esta matriz (principio
 * abierto/cerrado) y las fases siguientes reutilizan los mismos permisos.
 */
import { ROLES } from './roles.js';

export const PERMISSIONS = Object.freeze({
  // Cliente
  PROFILE_READ: 'profile:read',
  PROFILE_UPDATE: 'profile:update',
  CATALOG_READ: 'catalog:read',
  CART_MANAGE: 'cart:manage',
  POS_USE: 'pos:use',
  ORDERS_OWN: 'orders:own',

  // Gestion de usuarios
  USERS_READ: 'users:read',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_DEACTIVATE: 'users:deactivate',
  USERS_DELETE: 'users:delete',
  ADMINS_MANAGE: 'admins:manage',

  // Operacion diaria (se implementan en fases posteriores)
  PRODUCTS_MANAGE: 'products:manage',
  COUPONS_MANAGE: 'coupons:manage',
  ORDERS_MANAGE: 'orders:manage',
  INVOICES_MANAGE: 'invoices:manage',
  SUPPLIERS_MANAGE: 'suppliers:manage',

  // Exclusivos de superusuario
  RECORDS_HARD_DELETE: 'records:hard_delete',
  SETTINGS_MANAGE: 'settings:manage',
  AUDIT_READ: 'audit:read',
});

/** Permisos del cliente final. */
const USER_PERMISSIONS = [
  PERMISSIONS.PROFILE_READ,
  PERMISSIONS.PROFILE_UPDATE,
  PERMISSIONS.CATALOG_READ,
  PERMISSIONS.CART_MANAGE,
  PERMISSIONS.POS_USE,
  PERMISSIONS.ORDERS_OWN,
];

/** Permisos del administrador: los del cliente mas la operacion diaria, sin borrado fisico ni logs. */
const ADMIN_PERMISSIONS = [
  ...USER_PERMISSIONS,
  PERMISSIONS.USERS_READ,
  PERMISSIONS.USERS_CREATE,
  PERMISSIONS.USERS_UPDATE,
  PERMISSIONS.USERS_DEACTIVATE,
  PERMISSIONS.PRODUCTS_MANAGE,
  PERMISSIONS.COUPONS_MANAGE,
  PERMISSIONS.ORDERS_MANAGE,
  PERMISSIONS.INVOICES_MANAGE,
  PERMISSIONS.SUPPLIERS_MANAGE,
];

/** Permisos del superusuario: todos. */
const SUPERUSER_PERMISSIONS = Object.values(PERMISSIONS);

/** Matriz inmutable rol -> conjunto de permisos (Set para busquedas O(1)). */
export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.SUPERUSER]: Object.freeze(new Set(SUPERUSER_PERMISSIONS)),
  [ROLES.ADMIN]: Object.freeze(new Set(ADMIN_PERMISSIONS)),
  [ROLES.USER]: Object.freeze(new Set(USER_PERMISSIONS)),
});

/**
 * Indica si un rol tiene un permiso concreto. Un rol desconocido no tiene ninguno.
 * @param {string} role
 * @param {string} permission
 * @returns {boolean}
 */
export function hasPermission(role, permission) {
  const granted = Object.hasOwn(ROLE_PERMISSIONS, role) ? ROLE_PERMISSIONS[role] : null;
  return granted ? granted.has(permission) : false;
}

/**
 * Devuelve la lista de permisos de un rol (util para exponerla al frontend).
 * @param {string} role
 * @returns {string[]}
 */
export function permissionsOf(role) {
  return Object.hasOwn(ROLE_PERMISSIONS, role) ? [...ROLE_PERMISSIONS[role]] : [];
}
