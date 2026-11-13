/**
 * Definicion de la coleccion products: validador $jsonSchema e indices.
 *
 * Fase 2 anade los atributos comerciales del catalogo: descuento propio del
 * producto, tasa de impuesto, destacado, valoracion, retiro en tienda y
 * metodos de pago aceptados. Los precios se guardan en centavos y SIN impuesto
 * (el impuesto se calcula en caja sobre la base ya descontada).
 *
 * Indices pensados para cada filtro del catalogo publico (siempre con isActive
 * como prefijo): categoria, destacados, mejor valorados, nuevos y en oferta.
 */
import { COLLECTIONS } from '../collections.js';
import { ALL_PAYMENT_METHODS } from '../../constants/commerce.js';
import * as t from './schema-types.js';

export const productsCollection = Object.freeze({
  name: COLLECTIONS.PRODUCTS,
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'products',
      additionalProperties: false,
      required: [
        'sku',
        'name',
        'slug',
        'priceCents',
        'discountPercent',
        'taxRatePercent',
        'stock',
        'category',
        'isActive',
        'isFeatured',
        'pickupAvailable',
        'acceptedPaymentMethods',
        'ratingAverage',
        'ratingCount',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        _id: t.objectId,
        sku: { bsonType: 'string', pattern: '^[A-Z0-9-]{3,40}$' },
        name: t.string(1, 160),
        slug: { bsonType: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 180 },
        description: t.nullableString(5000),
        priceCents: t.money,
        costCents: { ...t.money, bsonType: ['int', 'long', 'double', 'null'] },
        discountPercent: t.percent,
        taxRatePercent: t.percent,
        stock: t.nonNegativeInt,
        category: t.string(1, 80),
        tags: { bsonType: 'array', maxItems: 20, items: t.string(1, 40) },
        images: { bsonType: 'array', maxItems: 10, items: t.string(1, 2048) },
        isFeatured: t.bool,
        pickupAvailable: t.bool,
        acceptedPaymentMethods: {
          bsonType: 'array',
          minItems: 1,
          uniqueItems: true,
          items: t.enumOf(ALL_PAYMENT_METHODS),
        },
        ratingAverage: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: 5 },
        ratingCount: t.nonNegativeInt,
        supplierId: t.nullableObjectId,
        isActive: t.bool,
        createdBy: t.nullableObjectId,
        ...t.timestamps,
      },
    },
  },
  indexes: [
    { key: { sku: 1 }, name: 'uq_products_sku', unique: true },
    { key: { slug: 1 }, name: 'uq_products_slug', unique: true },
    { key: { isActive: 1, category: 1, createdAt: -1 }, name: 'ix_products_active_category_created' },
    { key: { isActive: 1, isFeatured: 1, createdAt: -1 }, name: 'ix_products_active_featured' },
    { key: { isActive: 1, ratingAverage: -1, ratingCount: -1 }, name: 'ix_products_active_rating' },
    { key: { isActive: 1, createdAt: -1 }, name: 'ix_products_active_created' },
    { key: { isActive: 1, discountPercent: -1 }, name: 'ix_products_active_discount' },
    { key: { isActive: 1, priceCents: 1 }, name: 'ix_products_active_price' },
    {
      key: { supplierId: 1 },
      name: 'ix_products_supplier',
      partialFilterExpression: { supplierId: { $type: 'objectId' } },
    },
    {
      key: { name: 'text', description: 'text', tags: 'text' },
      name: 'tx_products_search',
      weights: { name: 10, tags: 5, description: 1 },
      default_language: 'spanish',
    },
  ],
});
