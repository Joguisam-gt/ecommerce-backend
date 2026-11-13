/**
 * Validacion del checkout del POS.
 *
 * Elige el esquema segun req.body.paymentMethod (un metodo desconocido o
 * ausente es un 400 VALIDATION_ERROR) y valida tambien la cabecera opcional
 * Idempotency-Key. Debe montarse despues de pciGuard.
 */
import { ALL_PAYMENT_METHODS } from '../constants/commerce.js';
import { HttpError } from '../utils/http-error.js';
import { checkoutSchemas, validateIdempotencyKey } from '../validators/checkout.validator.js';
import { validateSchema } from '../validators/schema-validator.js';

/**
 * Devuelve el error 400 estandar de validacion.
 * @param {Array<{ field: string, message: string }>} errors
 */
const validationError = (errors) => HttpError.badRequest('Datos de entrada invalidos', 'VALIDATION_ERROR', errors);

/** @type {import('express').RequestHandler} */
export function validateCheckout(req, _res, next) {
  const body = req.body ?? {};
  const method = typeof body === 'object' ? body.paymentMethod : undefined;

  if (typeof method !== 'string' || !Object.hasOwn(checkoutSchemas, method)) {
    return next(
      validationError([{ field: 'paymentMethod', message: `Debe ser uno de: ${ALL_PAYMENT_METHODS.join(', ')}` }]),
    );
  }

  const errors = validateSchema(checkoutSchemas[method], body);
  const keyError = validateIdempotencyKey(req.get?.('Idempotency-Key'));
  if (keyError) errors.push({ field: 'Idempotency-Key', message: keyError });

  return errors.length > 0 ? next(validationError(errors)) : next();
}
