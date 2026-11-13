/**
 * Constantes del modulo exclusivo de superusuario (Fase 4).
 *
 * Centraliza los roles de personal, la lista blanca de colecciones purgables
 * y el documento centinela que serializa las operaciones que reducen el
 * numero de superusuarios activos.
 */
import { COLLECTIONS } from '../database/collections.js';
import { ROLES } from './roles.js';

/** Roles que forman el personal (staff): los unicos que se pueden crear desde /superuser/staff. */
export const STAFF_ROLES = Object.freeze([ROLES.ADMIN, ROLES.SUPERUSER]);

/**
 * Lista blanca de colecciones que admiten borrado fisico (purga).
 * El valor del parametro :collection se valida contra estas claves y el
 * repositorio las traduce a la coleccion real: nunca se usa el texto crudo.
 */
export const PURGEABLE_COLLECTIONS = Object.freeze({
  USERS: COLLECTIONS.USERS,
  PRODUCTS: COLLECTIONS.PRODUCTS,
  SUPPLIERS: COLLECTIONS.SUPPLIERS,
  COUPONS: COLLECTIONS.COUPONS,
});

export const ALL_PURGEABLE_COLLECTIONS = Object.freeze(Object.values(PURGEABLE_COLLECTIONS));

/**
 * Documento centinela en counters (_id cumple el patron ^[a-z_]{2,40}$ del
 * $jsonSchema de counters). Toda transaccion que degrada o desactiva a un
 * superusuario activo le aplica un $inc: dos transacciones concurrentes
 * escriben el mismo documento, MongoDB aborta una con WriteConflict y
 * withTransaction la reintenta con un recuento fresco (evita el write skew).
 */
export const SUPERUSER_GOVERNANCE_LOCK = 'superuser_governance_lock';

/** Limite maximo de la paginacion de audit_logs del superusuario. */
export const AUDIT_LOG_MAX_LIMIT = 100;

/** Limite por defecto de la paginacion de audit_logs del superusuario. */
export const AUDIT_LOG_DEFAULT_LIMIT = 20;
