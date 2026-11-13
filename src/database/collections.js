/**
 * Nombres canonicos de las colecciones.
 *
 * Centralizarlos evita cadenas magicas repetidas en repositorios, esquemas y scripts.
 * Fase 2 anade carts (carrito activo por usuario) y counters (secuencias de
 * numeracion de pedidos y facturas). Fase 3 anade purchases (compras a
 * proveedores) e inventory_losses (mermas por vencimiento o dano).
 */
export const COLLECTIONS = Object.freeze({
  USERS: 'users',
  PRODUCTS: 'products',
  COUPONS: 'coupons',
  ORDERS: 'orders',
  INVOICES: 'invoices',
  SUPPLIERS: 'suppliers',
  AUDIT_LOGS: 'audit_logs',
  CARTS: 'carts',
  COUNTERS: 'counters',
  PURCHASES: 'purchases',
  INVENTORY_LOSSES: 'inventory_losses',
});
