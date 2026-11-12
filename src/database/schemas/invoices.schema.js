/**
 * Definicion de la coleccion invoices: validador $jsonSchema e indices.
 *
 * Una factura vigente por pedido: el indice unico sobre orderId es parcial y
 * solo aplica a facturas no anuladas, de modo que se puede anular y reemitir.
 * (partialFilterExpression con $in requiere MongoDB 6.0 o superior.)
 */
import { COLLECTIONS } from '../collections.js';
import * as t from './schema-types.js';

export const INVOICE_STATUSES = Object.freeze(['issued', 'paid', 'voided']);

export const invoicesCollection = Object.freeze({
  name: COLLECTIONS.INVOICES,
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'invoices',
      additionalProperties: false,
      required: [
        'invoiceNumber',
        'orderId',
        'userId',
        'status',
        'billingInfo',
        'subtotalCents',
        'taxCents',
        'totalCents',
        'issuedAt',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        _id: t.objectId,
        invoiceNumber: t.string(4, 40),
        orderId: t.objectId,
        userId: t.objectId,
        status: t.enumOf(INVOICE_STATUSES),
        billingInfo: {
          bsonType: 'object',
          additionalProperties: false,
          required: ['name', 'email'],
          properties: {
            name: t.string(1, 160),
            taxId: t.nullableString(40),
            email: t.email,
            address: t.nullableString(300),
          },
        },
        subtotalCents: t.money,
        discountCents: t.money,
        taxCents: t.money,
        totalCents: t.money,
        issuedAt: t.date,
        voidedAt: t.nullableDate,
        voidReason: t.nullableString(500),
        ...t.timestamps,
      },
    },
  },
  indexes: [
    { key: { invoiceNumber: 1 }, name: 'uq_invoices_number', unique: true },
    {
      key: { orderId: 1 },
      name: 'uq_invoices_active_order',
      unique: true,
      partialFilterExpression: { status: { $in: ['issued', 'paid'] } },
    },
    { key: { userId: 1, issuedAt: -1 }, name: 'ix_invoices_user_issued' },
    { key: { status: 1, issuedAt: -1 }, name: 'ix_invoices_status_issued' },
  ],
});
