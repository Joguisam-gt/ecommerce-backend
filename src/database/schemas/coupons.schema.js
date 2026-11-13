/**
 * Definicion de la coleccion coupons: validador $jsonSchema, reglas cruzadas e indices.
 *
 * Fase 2:
 * - isPermanent: el cupon no expira (validUntil puede ser null).
 * - applicableProductIds: productos a los que aplica; lista vacia = todo el catalogo.
 * Reglas entre campos: un cupon no permanente debe terminar despues de empezar,
 * y un descuento porcentual no puede superar el 100.
 */
import { COLLECTIONS } from '../collections.js';
import { ALL_COUPON_TYPES } from '../../constants/commerce.js';
import * as t from './schema-types.js';

export const COUPON_TYPES = ALL_COUPON_TYPES;

export const couponsCollection = Object.freeze({
  name: COLLECTIONS.COUPONS,
  validator: {
    $and: [
      {
        $jsonSchema: {
          bsonType: 'object',
          title: 'coupons',
          additionalProperties: false,
          required: [
            'code',
            'discountType',
            'discountValue',
            'usedCount',
            'isActive',
            'isPermanent',
            'applicableProductIds',
            'validFrom',
            'createdAt',
            'updatedAt',
          ],
          properties: {
            _id: t.objectId,
            code: { bsonType: 'string', pattern: '^[A-Z0-9_-]{3,30}$' },
            description: t.nullableString(500),
            discountType: t.enumOf(ALL_COUPON_TYPES),
            discountValue: { ...t.money, minimum: 1 },
            minOrderCents: t.money,
            maxUses: { bsonType: ['int', 'long', 'null'], minimum: 1 },
            maxUsesPerUser: { bsonType: ['int', 'long', 'null'], minimum: 1 },
            usedCount: t.nonNegativeInt,
            isActive: t.bool,
            isPermanent: t.bool,
            applicableProductIds: { bsonType: 'array', maxItems: 500, items: t.objectId },
            validFrom: t.date,
            validUntil: t.nullableDate,
            createdBy: t.nullableObjectId,
            ...t.timestamps,
          },
        },
      },
      { $or: [{ isPermanent: true }, { $expr: { $gt: ['$validUntil', '$validFrom'] } }] },
      { $or: [{ discountType: 'fixed' }, { discountValue: { $lte: 100 } }] },
    ],
  },
  indexes: [
    { key: { code: 1 }, name: 'uq_coupons_code', unique: true },
    { key: { isActive: 1, validFrom: 1, validUntil: 1 }, name: 'ix_coupons_active_validity' },
  ],
});
