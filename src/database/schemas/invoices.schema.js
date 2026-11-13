/**
 * Definicion de la coleccion invoices (documento fiscal): validador e indices.
 *
 * Se genera automaticamente dentro de la transaccion de checkout. Campos
 * fiscales: nit (NIT del cliente o, si no lo proporciona, su codigo de
 * usuario, indicado por nitType), entityName, paymentMethod, shippingAddress,
 * email, items y totales.
 * Una factura vigente por pedido: indice unico parcial que excluye anuladas.
 *
 * Fase 3: entityType distingue la factura de venta a cliente ("cliente") de
 * la factura de compra a proveedor ("proveedor"). Reglas cruzadas:
 * - cliente: exige orderId, orderNumber, userId y email.
 * - proveedor: exige supplierId y purchaseId (no hay pedido ni usuario).
 */
import { COLLECTIONS } from '../collections.js';
import {
  ALL_INVOICE_ENTITY_TYPES,
  ALL_INVOICE_STATUSES,
  ALL_PAYMENT_METHODS,
  INVOICE_ENTITY_TYPES,
  NIT_TYPES,
} from '../../constants/commerce.js';
import * as t from './schema-types.js';

export const INVOICE_STATUSES = ALL_INVOICE_STATUSES;

/** Linea de factura. */
const invoiceItem = {
  bsonType: 'object',
  additionalProperties: false,
  required: ['productId', 'sku', 'name', 'quantity', 'unitPriceCents', 'discountCents', 'taxRatePercent', 'taxCents', 'totalCents'],
  properties: {
    productId: t.objectId,
    sku: t.string(3, 40),
    name: t.string(1, 160),
    quantity: { bsonType: ['int', 'long'], minimum: 1 },
    unitPriceCents: t.money,
    discountCents: t.money,
    taxRatePercent: t.percent,
    taxCents: t.money,
    totalCents: t.money,
  },
};

export const invoicesCollection = Object.freeze({
  name: COLLECTIONS.INVOICES,
  validator: {
    $and: [
      {
        $jsonSchema: {
          bsonType: 'object',
          title: 'invoices',
          additionalProperties: false,
          required: [
            'invoiceNumber',
            'entityType',
            'nit',
            'nitType',
            'entityName',
            'paymentMethod',
            'shippingAddress',
            'items',
            'currency',
            'subtotalCents',
            'discountTotalCents',
            'taxTotalCents',
            'grandTotalCents',
            'status',
            'issuedAt',
            'createdAt',
            'updatedAt',
          ],
          properties: {
            _id: t.objectId,
            invoiceNumber: t.string(4, 40),
            entityType: t.enumOf(ALL_INVOICE_ENTITY_TYPES),
            orderId: t.objectId,
            orderNumber: t.string(4, 40),
            userId: t.objectId,
            supplierId: t.objectId,
            purchaseId: t.objectId,
            nit: t.string(1, 40),
            nitType: t.enumOf(Object.values(NIT_TYPES)),
            entityName: t.string(1, 160),
            email: { ...t.email, bsonType: ['string', 'null'] },
            paymentMethod: t.enumOf(ALL_PAYMENT_METHODS),
            shippingAddress: t.nullableAddress,
            items: { bsonType: 'array', minItems: 1, maxItems: 200, items: invoiceItem },
            currency: { bsonType: 'string', pattern: '^[A-Z]{3}$' },
            subtotalCents: t.money,
            discountTotalCents: t.money,
            taxTotalCents: t.money,
            grandTotalCents: t.money,
            status: t.enumOf(ALL_INVOICE_STATUSES),
            issuedAt: t.date,
            voidedAt: t.nullableDate,
            voidReason: t.nullableString(500),
            ...t.timestamps,
          },
        },
      },
      {
        $or: [
          {
            entityType: INVOICE_ENTITY_TYPES.CUSTOMER,
            orderId: { $type: 'objectId' },
            orderNumber: { $type: 'string' },
            userId: { $type: 'objectId' },
            email: { $type: 'string' },
          },
          {
            entityType: INVOICE_ENTITY_TYPES.SUPPLIER,
            supplierId: { $type: 'objectId' },
            purchaseId: { $type: 'objectId' },
          },
        ],
      },
    ],
  },
  /**
   * Migracion idempotente previa al collMod: las facturas emitidas antes de la
   * Fase 3 no tienen entityType; todas eran ventas, asi que se marcan "cliente".
   * Sin esto, cualquier update sobre ellas (p. ej. conciliar una transferencia)
   * fallaria con DocumentValidationFailure bajo validationLevel strict.
   * @param {import('mongodb').Db} db
   */
  migrate: (db) =>
    db
      .collection(COLLECTIONS.INVOICES)
      .updateMany({ entityType: { $exists: false } }, { $set: { entityType: INVOICE_ENTITY_TYPES.CUSTOMER } }),
  indexes: [
    { key: { invoiceNumber: 1 }, name: 'uq_invoices_number', unique: true },
    {
      key: { orderId: 1 },
      name: 'uq_invoices_active_order',
      unique: true,
      partialFilterExpression: { orderId: { $type: 'objectId' }, status: { $in: ['paid', 'pending_payment'] } },
    },
    { key: { userId: 1, issuedAt: -1 }, name: 'ix_invoices_user_issued' },
    { key: { nit: 1, issuedAt: -1 }, name: 'ix_invoices_nit_issued' },
    { key: { status: 1, issuedAt: -1 }, name: 'ix_invoices_status_issued' },
    { key: { entityType: 1, issuedAt: -1 }, name: 'ix_invoices_entity_type_issued' },
    {
      key: { purchaseId: 1 },
      name: 'uq_invoices_purchase',
      unique: true,
      partialFilterExpression: { purchaseId: { $type: 'objectId' } },
    },
  ],
});
