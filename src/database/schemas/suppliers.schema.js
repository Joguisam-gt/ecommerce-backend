/**
 * Definicion de la coleccion suppliers: validador $jsonSchema e indices.
 *
 * Fase 3: cada proveedor tiene un codigo unico asignado por el sistema
 * (supplierCode, p. ej. PRV-000001, generado con la secuencia "supplier"),
 * NIT unico, datos de contacto, descripcion de su distribucion y el catalogo
 * de productos que surte con su costo unitario en centavos.
 * El indice por nombre usa una collation de fuerza 2 para ordenar y buscar
 * sin distinguir mayusculas.
 */
import { COLLECTIONS } from '../collections.js';
import * as t from './schema-types.js';

/** Patron del codigo de proveedor. */
export const SUPPLIER_CODE_PATTERN = '^PRV-[0-9]{6,}$';

/** Entrada del catalogo que surte el proveedor. */
const catalogItem = {
  bsonType: 'object',
  additionalProperties: false,
  required: ['productId', 'costCents'],
  properties: {
    productId: t.objectId,
    costCents: t.money,
  },
};

export const suppliersCollection = Object.freeze({
  name: COLLECTIONS.SUPPLIERS,
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'suppliers',
      additionalProperties: false,
      required: ['supplierCode', 'name', 'nit', 'catalog', 'isActive', 'createdAt', 'updatedAt'],
      properties: {
        _id: t.objectId,
        supplierCode: { bsonType: 'string', pattern: SUPPLIER_CODE_PATTERN },
        name: t.string(1, 160),
        nit: t.string(3, 40),
        address: t.nullableString(300),
        phone: t.nullableString(20),
        email: { ...t.email, bsonType: ['string', 'null'] },
        contactName: t.nullableString(120),
        distributionDescription: t.nullableString(2000),
        catalog: { bsonType: 'array', maxItems: 1000, items: catalogItem },
        isActive: t.bool,
        createdBy: t.nullableObjectId,
        ...t.timestamps,
      },
    },
  },
  indexes: [
    { key: { supplierCode: 1 }, name: 'uq_suppliers_code', unique: true },
    { key: { nit: 1 }, name: 'uq_suppliers_nit', unique: true },
    { key: { name: 1 }, name: 'ix_suppliers_name', collation: { locale: 'es', strength: 2 } },
    { key: { isActive: 1, name: 1 }, name: 'ix_suppliers_active_name' },
    { key: { 'catalog.productId': 1 }, name: 'ix_suppliers_catalog_product' },
  ],
});
