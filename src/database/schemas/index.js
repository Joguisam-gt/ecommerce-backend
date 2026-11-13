/**
 * Registro de todas las definiciones de colecciones.
 *
 * Para anadir una coleccion nueva basta con crear su archivo de esquema y
 * agregarlo a esta lista (principio abierto/cerrado): el proceso de
 * sincronizacion no necesita cambios.
 */
import { usersCollection } from './users.schema.js';
import { productsCollection } from './products.schema.js';
import { couponsCollection } from './coupons.schema.js';
import { ordersCollection } from './orders.schema.js';
import { invoicesCollection } from './invoices.schema.js';
import { suppliersCollection } from './suppliers.schema.js';
import { auditLogsCollection } from './audit-logs.schema.js';
import { cartsCollection } from './carts.schema.js';
import { countersCollection } from './counters.schema.js';
import { purchasesCollection } from './purchases.schema.js';
import { inventoryLossesCollection } from './inventory-losses.schema.js';

export const COLLECTION_DEFINITIONS = Object.freeze([
  usersCollection,
  productsCollection,
  couponsCollection,
  ordersCollection,
  invoicesCollection,
  suppliersCollection,
  auditLogsCollection,
  cartsCollection,
  countersCollection,
  purchasesCollection,
  inventoryLossesCollection,
]);
