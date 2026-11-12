/**
 * Nombres canonicos de las colecciones.
 *
 * Centralizarlos evita cadenas magicas repetidas en repositorios, esquemas y scripts.
 */
export const COLLECTIONS = Object.freeze({
  USERS: 'users',
  PRODUCTS: 'products',
  COUPONS: 'coupons',
  ORDERS: 'orders',
  INVOICES: 'invoices',
  SUPPLIERS: 'suppliers',
  AUDIT_LOGS: 'audit_logs',
});
