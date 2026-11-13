/**
 * DTO de entrada del checkout del POS.
 *
 * Toma solo los campos permitidos del cuerpo ya validado (pciGuard +
 * validateCheckout), los normaliza (correo en minusculas, NIT y pais en
 * mayusculas, importe de la transferencia a centavos) y congela el resultado.
 * Los campos opcionales ausentes quedan en null para que el servicio aplique
 * sus valores por defecto con "??".
 */
import { PAYMENT_METHODS } from '../constants/commerce.js';
import { toCents } from '../utils/money.js';
import { normalizeEmail, normalizePhone, normalizeText } from './normalizers.js';

/**
 * Congela un objeto de forma recursiva.
 * @template T
 * @param {T} target
 * @returns {Readonly<T>}
 */
function deepFreeze(target) {
  for (const value of Object.values(target)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value);
  }
  return Object.freeze(target);
}

/**
 * Texto opcional normalizado o null.
 * @param {string | null | undefined} value
 */
const optionalText = (value) => (typeof value === 'string' && value.trim() !== '' ? normalizeText(value) : null);

/**
 * Direccion con las seis claves del $jsonSchema (las opcionales en null).
 * @param {object | undefined} address
 */
function normalizeAddress(address) {
  if (!address) return null;
  return {
    line1: normalizeText(address.line1),
    line2: optionalText(address.line2),
    city: normalizeText(address.city),
    state: optionalText(address.state),
    postalCode: optionalText(address.postalCode),
    country: address.country.trim().toUpperCase(),
  };
}

/**
 * Datos de pago segun el metodo (null en contra entrega).
 * @param {string} method
 * @param {object | undefined} payment
 */
function normalizePayment(method, payment) {
  if (method === PAYMENT_METHODS.CARD) {
    return {
      paymentToken: payment.paymentToken,
      last4: payment.last4.trim(),
      cardHolderName: normalizeText(payment.cardHolderName),
      cardBrand: payment.cardBrand,
    };
  }
  if (method === PAYMENT_METHODS.BANK_TRANSFER) {
    return {
      bankName: payment.bankName,
      senderAccountNumber: payment.senderAccountNumber.trim(),
      transferAmountCents: toCents(payment.transferAmount),
      authorizationNumber: payment.authorizationNumber.trim(),
      receiptUrl: payment.receiptUrl.trim(),
    };
  }
  return null;
}

export class CheckoutDTO {
  /**
   * @param {object} body Cuerpo validado.
   * @param {string | undefined} idempotencyKey Cabecera Idempotency-Key validada.
   */
  constructor(body, idempotencyKey) {
    this.paymentMethod = body.paymentMethod;
    this.customerName = optionalText(body.customerName);
    this.email = typeof body.email === 'string' ? normalizeEmail(body.email) : null;
    this.phone = normalizePhone(body.phone) ?? null;
    this.shippingAddress = normalizeAddress(body.shippingAddress);
    this.nit = typeof body.nit === 'string' ? body.nit.trim().toUpperCase() : null;
    this.entityName = optionalText(body.entityName);
    this.notes = typeof body.notes === 'string' && body.notes.trim() !== '' ? body.notes.trim() : null;
    this.payment = normalizePayment(body.paymentMethod, body.payment);
    this.idempotencyKey = idempotencyKey || null;
    deepFreeze(this);
  }

  /**
   * @param {object} body
   * @param {string} [idempotencyKey]
   */
  static from(body, idempotencyKey) {
    return new CheckoutDTO(body, idempotencyKey);
  }
}
