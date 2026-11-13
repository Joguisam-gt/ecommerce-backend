/**
 * Esquemas de validacion del checkout del POS (POST /api/pos/checkout).
 *
 * Un esquema por metodo de pago (checkoutSchemas[method]); el middleware
 * validate-checkout elige el adecuado segun req.body.paymentMethod. Como el
 * motor rechaza campos no declarados, cada metodo define EXACTAMENTE que
 * datos de pago acepta:
 * - cash_on_delivery: nombre, correo, telefono y direccion obligatorios; sin "payment".
 * - card (PCI-DSS): solo token de la pasarela, ultimos 4, titular y marca.
 *   El numero completo y el CVV no tienen campo (ademas los bloquea pci-guard).
 * - bank_transfer: datos del comprobante de la transferencia.
 */
import { BANKS, CARD_BRANDS, PAYMENT_METHODS } from '../constants/commerce.js';
import { PHONE_PATTERN, emailRule } from './common.rules.js';

/** Cabecera Idempotency-Key: 8 a 100 caracteres seguros. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

/** NIT guatemalteco (digitos + verificador, con guion opcional) o CF (consumidor final). */
export const NIT_PATTERN = /^(\d{1,12}-?[\dKk]|CF)$/;

/** Token de pasarela: caracteres seguros, 8 a 255. */
export const PAYMENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,255}$/;

/** Una secuencia de 13 a 19 digitos tiene forma de PAN: no es un token valido. */
const PAN_LIKE = /^\d{13,19}$/;

/** Importe maximo admitido en una transferencia (evita valores absurdos). */
const MAX_TRANSFER_AMOUNT = 1_000_000_000;

/**
 * URL https valida.
 * @param {string} value
 * @returns {string | null}
 */
export function httpsUrlRule(value) {
  const text = value.trim();
  if (!URL.canParse(text)) return 'URL invalida';
  return new URL(text).protocol === 'https:' ? null : 'La URL debe usar https';
}

/** Direccion de envio estructurada (coherente con schema-types.address). */
const addressSchema = Object.freeze({
  fields: {
    line1: { type: 'string', required: true, minLength: 1, maxLength: 200 },
    line2: { type: 'string', nullable: true, maxLength: 200 },
    city: { type: 'string', required: true, minLength: 1, maxLength: 100 },
    state: { type: 'string', nullable: true, maxLength: 100 },
    postalCode: { type: 'string', nullable: true, maxLength: 20 },
    country: {
      type: 'string',
      required: true,
      pattern: /^[A-Za-z]{2}$/,
      patternMessage: 'Codigo de pais ISO 3166-1 alfa-2 (p. ej. GT)',
    },
  },
});

/** Datos de tarjeta tokenizada: exactamente estos cuatro campos. */
const cardPaymentSchema = Object.freeze({
  fields: {
    paymentToken: {
      type: 'string',
      required: true,
      trim: false,
      pattern: PAYMENT_TOKEN_PATTERN,
      patternMessage: 'Token de pago invalido',
      custom: (value) => (PAN_LIKE.test(value) ? 'Token de pago invalido' : null),
    },
    last4: { type: 'string', required: true, pattern: /^\d{4}$/, patternMessage: 'Deben ser 4 digitos' },
    cardHolderName: { type: 'string', required: true, minLength: 2, maxLength: 120 },
    cardBrand: { type: 'enum', required: true, values: [...CARD_BRANDS] },
  },
});

/** Datos del comprobante de una transferencia bancaria. */
const bankTransferPaymentSchema = Object.freeze({
  fields: {
    bankName: { type: 'enum', required: true, values: [...BANKS] },
    senderAccountNumber: {
      type: 'string',
      required: true,
      pattern: /^[0-9-]{4,34}$/,
      patternMessage: 'Numero de cuenta invalido',
    },
    transferAmount: {
      type: 'number',
      required: true,
      max: MAX_TRANSFER_AMOUNT,
      maxDecimals: 2,
      custom: (value) => (value > 0 ? null : 'Debe ser mayor que 0'),
    },
    authorizationNumber: {
      type: 'string',
      required: true,
      pattern: /^[A-Za-z0-9-]{3,64}$/,
      patternMessage: 'Numero de autorizacion invalido',
    },
    receiptUrl: { type: 'string', required: true, minLength: 10, maxLength: 2048, custom: httpsUrlRule },
  },
});

/**
 * Campos comunes a todos los metodos.
 * @param {string} method
 * @param {boolean} contactRequired true en contra entrega (nombre, correo, telefono y direccion).
 */
function baseFields(method, contactRequired) {
  return {
    paymentMethod: { type: 'enum', required: true, values: [method] },
    customerName: { type: 'string', required: contactRequired, minLength: 2, maxLength: 160 },
    email: emailRule(contactRequired),
    phone: { type: 'string', required: contactRequired, pattern: PHONE_PATTERN, patternMessage: 'Telefono invalido' },
    shippingAddress: { type: 'object', required: contactRequired, schema: addressSchema },
    nit: { type: 'string', maxLength: 40, pattern: NIT_PATTERN, patternMessage: 'NIT invalido (p. ej. 1234567-8 o CF)' },
    entityName: { type: 'string', minLength: 1, maxLength: 160 },
    notes: { type: 'string', nullable: true, maxLength: 1000 },
  };
}

/** Esquema del cuerpo por metodo de pago. */
export const checkoutSchemas = Object.freeze({
  [PAYMENT_METHODS.CASH_ON_DELIVERY]: Object.freeze({
    // Sin campo "payment": enviarlo produce "Campo no permitido".
    fields: baseFields(PAYMENT_METHODS.CASH_ON_DELIVERY, true),
  }),
  [PAYMENT_METHODS.CARD]: Object.freeze({
    fields: {
      ...baseFields(PAYMENT_METHODS.CARD, false),
      payment: { type: 'object', required: true, schema: cardPaymentSchema },
    },
  }),
  [PAYMENT_METHODS.BANK_TRANSFER]: Object.freeze({
    fields: {
      ...baseFields(PAYMENT_METHODS.BANK_TRANSFER, false),
      payment: { type: 'object', required: true, schema: bankTransferPaymentSchema },
    },
  }),
});

/**
 * Valida la cabecera opcional Idempotency-Key.
 * @param {string | undefined} value
 * @returns {string | null} Mensaje de error o null.
 */
export function validateIdempotencyKey(value) {
  if (value === undefined) return null;
  return IDEMPOTENCY_KEY_PATTERN.test(value) ? null : 'Debe tener 8 a 100 caracteres [A-Za-z0-9_-]';
}
