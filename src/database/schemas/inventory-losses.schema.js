/**
 * Definicion de la coleccion inventory_losses (Fase 3): mermas de inventario.
 *
 * Registro append-only de unidades retiradas por vencimiento o dano, con el
 * costo unitario congelado al momento de la baja para cuantificar la perdida
 * economica en los reportes.
 */
import { COLLECTIONS } from '../collections.js';
import { ALL_LOSS_REASONS } from '../../constants/commerce.js';
import * as t from './schema-types.js';

export const inventoryLossesCollection = Object.freeze({
  name: COLLECTIONS.INVENTORY_LOSSES,
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'inventory_losses',
      additionalProperties: false,
      required: ['productId', 'sku', 'productName', 'category', 'quantity', 'reason', 'unitCostCents', 'totalLossCents', 'occurredAt', 'createdAt'],
      properties: {
        _id: t.objectId,
        productId: t.objectId,
        sku: t.string(3, 40),
        productName: t.string(1, 160),
        category: t.string(1, 80),
        supplierId: t.nullableObjectId,
        quantity: { bsonType: ['int', 'long'], minimum: 1 },
        reason: t.enumOf(ALL_LOSS_REASONS),
        unitCostCents: t.money,
        totalLossCents: t.money,
        notes: t.nullableString(1000),
        recordedBy: t.nullableObjectId,
        occurredAt: t.date,
        createdAt: t.date,
      },
    },
  },
  indexes: [
    { key: { occurredAt: -1 }, name: 'ix_losses_occurred' },
    { key: { productId: 1, occurredAt: -1 }, name: 'ix_losses_product_occurred' },
    { key: { reason: 1, occurredAt: -1 }, name: 'ix_losses_reason_occurred' },
  ],
});
