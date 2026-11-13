/**
 * Esquemas de validacion del carrito.
 */
import { CART_LIMITS } from '../constants/commerce.js';

const quantityRule = () => ({ type: 'integer', required: true, min: 1, max: CART_LIMITS.MAX_QUANTITY_PER_LINE });

export const addCartItemSchema = Object.freeze({
  fields: { productId: { type: 'objectId', required: true }, quantity: quantityRule() },
});

export const updateCartItemSchema = Object.freeze({
  fields: { quantity: quantityRule() },
});

export const productIdParamSchema = Object.freeze({
  fields: { productId: { type: 'objectId', required: true } },
});

export const applyCouponSchema = Object.freeze({
  fields: {
    code: {
      type: 'string',
      required: true,
      pattern: /^[A-Za-z0-9_-]{3,30}$/,
      patternMessage: 'Codigo de cupon invalido',
    },
  },
});
