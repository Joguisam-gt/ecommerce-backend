/**
 * Definicion de la coleccion purchases (Fase 3): compras de mercaderia a proveedores.
 *
 * Cada documento es un snapshot inmutable del ingreso: proveedor, lineas con
 * costo unitario congelado (y el costo anterior del producto, para trazabilidad),
 * total y la factura contable de proveedor generada en la misma transaccion.
 */
import { COLLECTIONS } from '../collections.js';
import { ALL_PAYMENT_METHODS } from '../../constants/commerce.js';
import * as t from './schema-types.js';

/** Linea de compra. */
const purchaseItem = {
  bsonType: 'object',
  additionalProperties: false,
  required: ['productId', 'sku', 'name', 'quantity', 'unitCostCents', 'previousCostCents', 'totalCents'],
  properties: {
    productId: t.objectId,
    sku: t.string(3, 40),
    name: t.string(1, 160),
    quantity: { bsonType: ['int', 'long'], minimum: 1 },
    unitCostCents: t.money,
    previousCostCents: { ...t.money, bsonType: ['int', 'long', 'double', 'null'] },
    totalCents: t.money,
  },
};

export const purchasesCollection = Object.freeze({
  name: COLLECTIONS.PURCHASES,
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'purchases',
      additionalProperties: false,
      required: [
        'purchaseNumber',
        'supplierId',
        'supplier',
        'items',
        'totalCostCents',
        'paymentMethod',
        'invoiceId',
        'purchasedAt',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        _id: t.objectId,
        purchaseNumber: t.string(4, 40),
        supplierId: t.objectId,
        supplier: {
          bsonType: 'object',
          additionalProperties: false,
          required: ['supplierCode', 'name', 'nit'],
          properties: {
            supplierCode: t.string(4, 40),
            name: t.string(1, 160),
            nit: t.string(3, 40),
          },
        },
        items: { bsonType: 'array', minItems: 1, maxItems: 200, items: purchaseItem },
        totalCostCents: t.money,
        paymentMethod: t.enumOf(ALL_PAYMENT_METHODS),
        invoiceId: t.objectId,
        supplierInvoiceNumber: t.nullableString(60),
        notes: t.nullableString(1000),
        createdBy: t.nullableObjectId,
        purchasedAt: t.date,
        ...t.timestamps,
      },
    },
  },
  indexes: [
    { key: { purchaseNumber: 1 }, name: 'uq_purchases_number', unique: true },
    { key: { supplierId: 1, purchasedAt: -1 }, name: 'ix_purchases_supplier_date' },
    { key: { 'items.productId': 1, purchasedAt: -1 }, name: 'ix_purchases_items_product' },
    { key: { purchasedAt: -1 }, name: 'ix_purchases_date' },
  ],
});
