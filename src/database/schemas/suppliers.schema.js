/**
 * Definicion de la coleccion suppliers: validador $jsonSchema e indices.
 *
 * El identificador fiscal (taxId) es unico. El indice por nombre usa una
 * collation de fuerza 2 para ordenar y buscar sin distinguir mayusculas.
 */
import { COLLECTIONS } from '../collections.js';
import * as t from './schema-types.js';

export const suppliersCollection = Object.freeze({
  name: COLLECTIONS.SUPPLIERS,
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'suppliers',
      additionalProperties: false,
      required: ['name', 'taxId', 'isActive', 'createdAt', 'updatedAt'],
      properties: {
        _id: t.objectId,
        name: t.string(1, 160),
        taxId: t.string(3, 40),
        contactName: t.nullableString(120),
        email: { ...t.email, bsonType: ['string', 'null'] },
        phone: t.nullableString(20),
        address: t.nullableString(300),
        notes: t.nullableString(2000),
        isActive: t.bool,
        ...t.timestamps,
      },
    },
  },
  indexes: [
    { key: { taxId: 1 }, name: 'uq_suppliers_tax_id', unique: true },
    { key: { name: 1 }, name: 'ix_suppliers_name', collation: { locale: 'es', strength: 2 } },
    { key: { isActive: 1, name: 1 }, name: 'ix_suppliers_active_name' },
  ],
});
