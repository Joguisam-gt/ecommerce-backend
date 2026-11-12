/**
 * Definicion de la coleccion products: validador $jsonSchema e indices.
 *
 * Indices pensados para: busqueda por SKU/slug (unicos), catalogo filtrado por
 * categoria y precio, busqueda de texto libre y consulta por proveedor.
 */
import { COLLECTIONS } from '../collections.js';
import * as t from './schema-types.js';

export const productsCollection = Object.freeze({
  name: COLLECTIONS.PRODUCTS,
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'products',
      additionalProperties: false,
      required: ['sku', 'name', 'slug', 'priceCents', 'stock', 'category', 'isActive', 'createdAt', 'updatedAt'],
      properties: {
        _id: t.objectId,
        sku: { bsonType: 'string', pattern: '^[A-Z0-9-]{3,40}$' },
        name: t.string(1, 160),
        slug: { bsonType: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 180 },
        description: t.nullableString(5000),
        priceCents: t.money,
        costCents: { ...t.money, bsonType: ['int', 'long', 'double', 'null'] },
        stock: t.nonNegativeInt,
        category: t.string(1, 80),
        tags: { bsonType: 'array', maxItems: 20, items: t.string(1, 40) },
        images: { bsonType: 'array', maxItems: 10, items: t.string(1, 2048) },
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
    { key: { category: 1, isActive: 1, priceCents: 1 }, name: 'ix_products_category_active_price' },
    {
      key: { supplierId: 1 },
      name: 'ix_products_supplier',
      partialFilterExpression: { supplierId: { $type: 'objectId' } },
    },
    { key: { isActive: 1, stock: 1 }, name: 'ix_products_active_stock' },
    {
      key: { name: 'text', description: 'text', tags: 'text' },
      name: 'tx_products_search',
      weights: { name: 10, tags: 5, description: 1 },
      default_language: 'spanish',
    },
  ],
});
