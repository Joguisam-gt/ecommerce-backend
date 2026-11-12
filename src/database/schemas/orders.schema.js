/**
 * Definicion de la coleccion orders: validador $jsonSchema e indices.
 *
 * Cada linea guarda una copia (snapshot) del SKU, nombre y precio del producto
 * en el momento de la compra, para que cambios posteriores del catalogo no
 * alteren pedidos historicos. El canal distingue venta online de POS.
 */
import { COLLECTIONS } from '../collections.js';
import * as t from './schema-types.js';

export const ORDER_STATUSES = Object.freeze([
  'pending',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
]);

export const ORDER_CHANNELS = Object.freeze(['online', 'pos']);

/** Esquema de una linea de pedido. */
const orderItem = {
  bsonType: 'object',
  additionalProperties: false,
  required: ['productId', 'sku', 'name', 'unitPriceCents', 'quantity', 'lineTotalCents'],
  properties: {
    productId: t.objectId,
    sku: t.string(3, 40),
    name: t.string(1, 160),
    unitPriceCents: t.money,
    quantity: { bsonType: ['int', 'long'], minimum: 1 },
    lineTotalCents: t.money,
  },
};

/** Esquema de la direccion de envio (opcional en ventas POS). */
const shippingAddress = {
  bsonType: ['object', 'null'],
  additionalProperties: false,
  required: ['line1', 'city', 'country'],
  properties: {
    line1: t.string(1, 200),
    line2: t.nullableString(200),
    city: t.string(1, 100),
    state: t.nullableString(100),
    postalCode: t.nullableString(20),
    country: t.string(2, 2),
  },
};

export const ordersCollection = Object.freeze({
  name: COLLECTIONS.ORDERS,
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'orders',
      additionalProperties: false,
      required: [
        'orderNumber',
        'userId',
        'channel',
        'status',
        'items',
        'subtotalCents',
        'discountCents',
        'taxCents',
        'totalCents',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        _id: t.objectId,
        orderNumber: t.string(4, 40),
        userId: t.objectId,
        channel: t.enumOf(ORDER_CHANNELS),
        status: t.enumOf(ORDER_STATUSES),
        items: { bsonType: 'array', minItems: 1, maxItems: 200, items: orderItem },
        coupon: {
          bsonType: ['object', 'null'],
          additionalProperties: false,
          required: ['couponId', 'code', 'discountCents'],
          properties: {
            couponId: t.objectId,
            code: t.string(3, 30),
            discountCents: t.money,
          },
        },
        subtotalCents: t.money,
        discountCents: t.money,
        taxCents: t.money,
        totalCents: t.money,
        shippingAddress,
        cashierId: t.nullableObjectId,
        notes: t.nullableString(1000),
        ...t.timestamps,
      },
    },
  },
  indexes: [
    { key: { orderNumber: 1 }, name: 'uq_orders_number', unique: true },
    { key: { userId: 1, createdAt: -1 }, name: 'ix_orders_user_created' },
    { key: { status: 1, createdAt: -1 }, name: 'ix_orders_status_created' },
    { key: { channel: 1, createdAt: -1 }, name: 'ix_orders_channel_created' },
    { key: { 'items.productId': 1 }, name: 'ix_orders_items_product' },
    {
      key: { 'coupon.code': 1 },
      name: 'ix_orders_coupon_code',
      partialFilterExpression: { 'coupon.code': { $type: 'string' } },
    },
  ],
});
