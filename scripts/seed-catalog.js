/**
 * Script: node scripts/seed-catalog.js
 *
 * Carga un catalogo de ejemplo (productos y cupones) de forma idempotente:
 * los productos se upsertan por sku y los cupones por code. Se puede ejecutar
 * varias veces sin duplicar datos.
 */
import { database } from '../src/config/database.js';
import { loadConfig } from '../src/config/env.js';
import { ALL_PAYMENT_METHODS, COUPON_TYPES, PAYMENT_METHODS as PM } from '../src/constants/commerce.js';
import { COLLECTIONS } from '../src/database/collections.js';
import { ensureCollections } from '../src/database/setup.js';
import { createLogger } from '../src/utils/logger.js';

const config = loadConfig();
const logger = createLogger({ level: 'info' });
const DAY_MS = 24 * 60 * 60 * 1000;

/** Productos de ejemplo (precios en centavos, sin impuesto). */
const PRODUCTS = [
  { sku: 'PER-TEC-001', name: 'Teclado mecanico RGB', slug: 'teclado-mecanico-rgb', description: 'Teclado mecanico con switches rojos.', priceCents: 49900, costCents: 30000, discountPercent: 0, stock: 25, category: 'perifericos', tags: ['teclado', 'rgb'], isFeatured: true, pickupAvailable: true, acceptedPaymentMethods: [...ALL_PAYMENT_METHODS], ratingAverage: 4.6, ratingCount: 38 },
  { sku: 'PER-MOU-001', name: 'Mouse inalambrico ergonomico', slug: 'mouse-inalambrico-ergonomico', description: 'Mouse inalambrico de 6 botones.', priceCents: 19900, costCents: 11000, discountPercent: 15, stock: 60, category: 'perifericos', tags: ['mouse'], isFeatured: false, pickupAvailable: true, acceptedPaymentMethods: [PM.CARD, PM.CASH_ON_DELIVERY], ratingAverage: 4.2, ratingCount: 12 },
  { sku: 'PER-AUD-001', name: 'Audifonos gamer 7.1', slug: 'audifonos-gamer-71', description: 'Audifonos con microfono desmontable.', priceCents: 34900, costCents: 20000, discountPercent: 10, stock: 1, category: 'perifericos', tags: ['audio'], isFeatured: false, pickupAvailable: false, acceptedPaymentMethods: [PM.CARD], ratingAverage: 3.9, ratingCount: 5 },
  { sku: 'MON-24-001', name: 'Monitor 24 pulgadas Full HD', slug: 'monitor-24-full-hd', description: 'Panel IPS de 75 Hz.', priceCents: 89900, costCents: 60000, discountPercent: 0, stock: 15, category: 'monitores', tags: ['monitor', 'ips'], isFeatured: true, pickupAvailable: true, acceptedPaymentMethods: [...ALL_PAYMENT_METHODS], ratingAverage: 4.8, ratingCount: 54 },
  { sku: 'MON-27-001', name: 'Monitor curvo 27 pulgadas 144Hz', slug: 'monitor-curvo-27-144hz', description: 'Monitor curvo para juegos.', priceCents: 159900, costCents: 110000, discountPercent: 20, stock: 8, category: 'monitores', tags: ['monitor', 'curvo'], isFeatured: true, pickupAvailable: false, acceptedPaymentMethods: [PM.CARD, PM.BANK_TRANSFER], ratingAverage: 4.4, ratingCount: 21 },
  { sku: 'COM-RAM-001', name: 'Memoria RAM DDR4 16GB', slug: 'memoria-ram-ddr4-16gb', description: 'Modulo DDR4 3200 MHz.', priceCents: 39900, costCents: 26000, discountPercent: 5, stock: 40, category: 'componentes', tags: ['ram'], isFeatured: false, pickupAvailable: true, acceptedPaymentMethods: [PM.CASH_ON_DELIVERY, PM.BANK_TRANSFER], ratingAverage: 0, ratingCount: 0 },
  { sku: 'COM-SSD-001', name: 'SSD NVMe 1TB', slug: 'ssd-nvme-1tb', description: 'Unidad de estado solido NVMe.', priceCents: 69900, costCents: 45000, discountPercent: 0, stock: 30, category: 'componentes', tags: ['ssd', 'nvme'], isFeatured: false, pickupAvailable: true, acceptedPaymentMethods: [...ALL_PAYMENT_METHODS], ratingAverage: 4.7, ratingCount: 33 },
  { sku: 'COM-GPU-001', name: 'Tarjeta grafica 8GB', slug: 'tarjeta-grafica-8gb', description: 'Tarjeta grafica de gama media.', priceCents: 299900, costCents: 220000, discountPercent: 12.5, stock: 3, category: 'componentes', tags: ['gpu'], isFeatured: true, pickupAvailable: false, acceptedPaymentMethods: [PM.CARD, PM.BANK_TRANSFER], ratingAverage: 4.5, ratingCount: 9 },
];

/**
 * Upsert de productos por sku.
 * @param {import('mongodb').Db} db
 * @param {Date} now
 * @returns {Promise<Map<string, import('mongodb').ObjectId>>} sku -> _id
 */
async function seedProducts(db, now) {
  const collection = db.collection(COLLECTIONS.PRODUCTS);
  const ids = new Map();
  for (const [index, product] of PRODUCTS.entries()) {
    const { sku, ...fields } = product;
    await collection.updateOne(
      { sku },
      {
        $set: { ...fields, taxRatePercent: 12, isActive: true, createdBy: null, supplierId: null, images: [], updatedAt: now },
        // Fechas escalonadas para que "newest" tenga un orden estable.
        $setOnInsert: { sku, createdAt: new Date(now.getTime() - index * DAY_MS) },
      },
      { upsert: true },
    );
    ids.set(sku, (await collection.findOne({ sku }, { projection: { _id: 1 } }))._id);
  }
  return ids;
}

/**
 * Upsert de cupones por code.
 * @param {import('mongodb').Db} db
 * @param {Date} now
 * @param {Map<string, import('mongodb').ObjectId>} productIds
 */
async function seedCoupons(db, now, productIds) {
  const monitors = PRODUCTS.filter((p) => p.category === 'monitores').map((p) => productIds.get(p.sku));
  const coupons = [
    { code: 'BIENVENIDA10', description: 'Descuento de bienvenida del 10%', discountType: COUPON_TYPES.PERCENTAGE, discountValue: 10, minOrderCents: 0, isPermanent: true, applicableProductIds: [], validFrom: now, validUntil: null },
    { code: 'MONITORES50', description: 'Q50 de descuento en monitores', discountType: COUPON_TYPES.FIXED, discountValue: 5000, minOrderCents: 0, isPermanent: false, applicableProductIds: monitors, validFrom: now, validUntil: new Date(now.getTime() + 90 * DAY_MS) },
    { code: 'EXPIRADO', description: 'Cupon vencido de ejemplo', discountType: COUPON_TYPES.PERCENTAGE, discountValue: 20, minOrderCents: 0, isPermanent: false, applicableProductIds: [], validFrom: new Date(now.getTime() - 60 * DAY_MS), validUntil: new Date(now.getTime() - 30 * DAY_MS) },
  ];
  const collection = db.collection(COLLECTIONS.COUPONS);
  for (const { code, ...fields } of coupons) {
    await collection.updateOne(
      { code },
      {
        $set: { ...fields, maxUses: null, maxUsesPerUser: null, isActive: true, createdBy: null, updatedAt: now },
        $setOnInsert: { code, usedCount: 0, createdAt: now },
      },
      { upsert: true },
    );
  }
}

try {
  const db = await database.connect(config.mongo);
  await ensureCollections(db);
  const now = new Date();
  const productIds = await seedProducts(db, now);
  await seedCoupons(db, now, productIds);
  logger.info('Catalogo de ejemplo cargado', { products: PRODUCTS.length, coupons: 3 });
} catch (error) {
  logger.error('No se pudo cargar el catalogo', { error: error.message });
  process.exitCode = 1;
} finally {
  await database.close();
}
