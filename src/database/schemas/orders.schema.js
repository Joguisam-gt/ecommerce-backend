/**
 * Definicion de la coleccion orders: validador $jsonSchema e indices.
 *
 * Cada pedido es un snapshot inmutable de la compra: lineas con precio original,
 * descuento, tasa e impuesto congelados, totales, cupon aplicado y datos del
 * pago. Por cumplimiento PCI-DSS solo se guardan la marca, los ultimos 4
 * digitos y el titular de la tarjeta: nunca el numero completo, el CVV ni el token.
 */
import { COLLECTIONS } from '../collections.js';
import {
  ALL_ORDER_CHANNELS,
  ALL_ORDER_STATUSES,
  ALL_PAYMENT_METHODS,
  ALL_PAYMENT_STATUSES,
  BANKS,
  CARD_BRANDS,
} from '../../constants/commerce.js';
import * as t from './schema-types.js';

export const ORDER_STATUSES = ALL_ORDER_STATUSES;
export const ORDER_CHANNELS = ALL_ORDER_CHANNELS;

/** Linea de pedido con precios e impuestos congelados. */
const orderItem = {
  bsonType: 'object',
  additionalProperties: false,
  required: [
    'productId',
    'sku',
    'name',
    'quantity',
    'unitPriceCents',
    'discountPercent',
    'unitFinalPriceCents',
    'taxRatePercent',
    'subtotalCents',
    'productDiscountCents',
    'couponDiscountCents',
    'discountTotalCents',
    'taxCents',
    'grandTotalCents',
  ],
  properties: {
    productId: t.objectId,
    sku: t.string(3, 40),
    name: t.string(1, 160),
    quantity: { bsonType: ['int', 'long'], minimum: 1 },
    unitPriceCents: t.money,
    discountPercent: t.percent,
    unitFinalPriceCents: t.money,
    taxRatePercent: t.percent,
    subtotalCents: t.money,
    productDiscountCents: t.money,
    couponDiscountCents: t.money,
    discountTotalCents: t.money,
    taxCents: t.money,
    grandTotalCents: t.money,
  },
};

/** Totales del pedido. */
const totals = {
  bsonType: 'object',
  additionalProperties: false,
  required: [
    'subtotalCents',
    'productDiscountCents',
    'couponDiscountCents',
    'discountTotalCents',
    'taxTotalCents',
    'grandTotalCents',
    'totalItemsCount',
  ],
  properties: {
    subtotalCents: t.money,
    productDiscountCents: t.money,
    couponDiscountCents: t.money,
    discountTotalCents: t.money,
    taxTotalCents: t.money,
    grandTotalCents: t.money,
    totalItemsCount: { bsonType: ['int', 'long'], minimum: 1 },
  },
};

/** Datos del pago: solo informacion no sensible. */
const payment = {
  bsonType: 'object',
  additionalProperties: false,
  required: ['method', 'status'],
  properties: {
    method: t.enumOf(ALL_PAYMENT_METHODS),
    status: t.enumOf(ALL_PAYMENT_STATUSES),
    card: {
      bsonType: ['object', 'null'],
      additionalProperties: false,
      required: ['brand', 'last4', 'holderName', 'authorizationCode', 'gatewayTransactionId'],
      properties: {
        brand: t.enumOf(CARD_BRANDS),
        last4: { bsonType: 'string', pattern: '^[0-9]{4}$' },
        holderName: t.string(2, 120),
        authorizationCode: t.string(1, 64),
        gatewayTransactionId: t.string(1, 128),
      },
    },
    bankTransfer: {
      bsonType: ['object', 'null'],
      additionalProperties: false,
      required: ['bankName', 'senderAccountNumber', 'transferAmountCents', 'authorizationNumber', 'receiptUrl'],
      properties: {
        bankName: t.enumOf(BANKS),
        senderAccountNumber: t.string(4, 34),
        transferAmountCents: t.money,
        authorizationNumber: t.string(3, 64),
        receiptUrl: t.string(10, 2048),
        verifiedAt: t.nullableDate,
        verifiedBy: t.nullableObjectId,
      },
    },
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
        'currency',
        'customer',
        'items',
        'totals',
        'payment',
        'invoiceId',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        _id: t.objectId,
        orderNumber: t.string(4, 40),
        userId: t.objectId,
        channel: t.enumOf(ALL_ORDER_CHANNELS),
        status: t.enumOf(ALL_ORDER_STATUSES),
        currency: { bsonType: 'string', pattern: '^[A-Z]{3}$' },
        customer: {
          bsonType: 'object',
          additionalProperties: false,
          required: ['name', 'email'],
          properties: {
            name: t.string(1, 160),
            email: t.email,
            phone: t.nullableString(20),
          },
        },
        shippingAddress: t.nullableAddress,
        items: { bsonType: 'array', minItems: 1, maxItems: 100, items: orderItem },
        coupon: {
          bsonType: ['object', 'null'],
          additionalProperties: false,
          required: ['couponId', 'code', 'discountType', 'discountValue', 'discountCents'],
          properties: {
            couponId: t.objectId,
            code: t.string(3, 30),
            discountType: t.enumOf(['percentage', 'fixed']),
            discountValue: t.money,
            discountCents: t.money,
          },
        },
        totals,
        payment,
        invoiceId: t.objectId,
        idempotencyKey: t.nullableString(100),
        cashierId: t.nullableObjectId,
        notes: t.nullableString(1000),
        ...t.timestamps,
      },
    },
  },
  indexes: [
    { key: { orderNumber: 1 }, name: 'uq_orders_number', unique: true },
    {
      key: { userId: 1, idempotencyKey: 1 },
      name: 'uq_orders_user_idempotency',
      unique: true,
      partialFilterExpression: { idempotencyKey: { $type: 'string' } },
    },
    { key: { userId: 1, createdAt: -1 }, name: 'ix_orders_user_created' },
    { key: { status: 1, createdAt: -1 }, name: 'ix_orders_status_created' },
    { key: { 'payment.method': 1, status: 1, createdAt: -1 }, name: 'ix_orders_payment_status' },
    { key: { 'items.productId': 1 }, name: 'ix_orders_items_product' },
    {
      key: { 'coupon.couponId': 1, userId: 1 },
      name: 'ix_orders_coupon_user',
      partialFilterExpression: { 'coupon.couponId': { $type: 'objectId' } },
    },
  ],
});
