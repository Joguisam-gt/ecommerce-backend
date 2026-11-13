/**
 * Roles del sistema y su jerarquia.
 *
 * - superuser (superusuario): acceso total, gestiona administradores, configuracion
 *   global y lectura de audit_logs.
 * - admin (administrador): operacion diaria; sin borrado fisico ni acceso a logs.
 * - user (usuario): cliente final con acceso a carrito, POS y perfil.
 *
 * El rango numerico permite expresar "solo puedes gestionar cuentas de rango inferior".
 */
export const ROLES = Object.freeze({
  SUPERUSER: 'superuser',
  ADMIN: 'admin',
  USER: 'user',
});

/** Lista de todos los roles validos (usada en validadores y $jsonSchema). */
export const ALL_ROLES = Object.freeze(Object.values(ROLES));

/** Rango jerarquico de cada rol: mayor numero, mayor privilegio. */
export const ROLE_RANK = Object.freeze({
  [ROLES.SUPERUSER]: 3,
  [ROLES.ADMIN]: 2,
  [ROLES.USER]: 1,
});

/**
 * Indica si un valor es un rol valido.
 * @param {unknown} role
 * @returns {boolean}
 */
export function isValidRole(role) {
  return typeof role === 'string' && ALL_ROLES.includes(role);
}
