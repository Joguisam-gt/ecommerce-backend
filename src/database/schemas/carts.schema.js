/**
 * Definicion de la coleccion carts: un carrito activo por usuario.
 *
 * El carrito solo guarda referencias (productId + cantidad) y el codigo de
 * cupon aplicado. Los precios, descuentos e impuestos se calculan siempre en
 * vivo desde products; se congelan unicamente al confirmar el pedido.
 */
import { COLLECTIONS } from '../collections.js';
import { CART_LIMITS } from '../../constants/commerce.js';
import * as t from './schema-types.js';

export const cartsCollection = Object.freeze({
  name: COLLECTIONS.CARTS,
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'carts',
      additionalProperties: false,
      required: ['userId', 'items', 'couponCode', 'createdAt', 'updatedAt'],
      properties: {
        _id: t.objectId,
        userId: t.objectId,
        items: {
          bsonType: 'array',
          maxItems: CART_LIMITS.MAX_LINES,
          items: {
            bsonType: 'object',
            additionalProperties: false,
            required: ['productId', 'quantity', 'addedAt'],
            properties: {
              productId: t.objectId,
              quantity: { bsonType: ['int', 'long'], minimum: 1, maximum: CART_LIMITS.MAX_QUANTITY_PER_LINE },
              addedAt: t.date,
            },
          },
        },
        couponCode: { bsonType: ['string', 'null'], pattern: '^[A-Z0-9_-]{3,30}$' },
        ...t.timestamps,
      },
    },
  },
  indexes: [
    { key: { userId: 1 }, name: 'uq_carts_user', unique: true },
    { key: { updatedAt: 1 }, name: 'ix_carts_updated' },
  ],
});
