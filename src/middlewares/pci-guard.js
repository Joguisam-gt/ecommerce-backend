/**
 * Guardia PCI-DSS para rutas de pago.
 *
 * Se ejecuta ANTES de validar y rechaza con 400 PCI_DATA_FORBIDDEN cualquier
 * cuerpo (o query) que contenga, en cualquier nivel:
 * - claves de datos sensibles de tarjeta (numero, CVV, expiracion, pista, PIN),
 *   comparadas sin distinguir mayusculas y sin "_" ni "-" (card_number = cardNumber);
 * - cadenas o numeros con un posible PAN: 13 a 19 digitos contiguos (admite
 *   espacios o guiones intermedios) que superan el algoritmo de Luhn.
 * Se excluyen del analisis de PAN los campos senderAccountNumber y
 * authorizationNumber (numeros bancarios largos legitimos).
 *
 * La respuesta solo indica la ruta del campo: NUNCA repite el valor recibido,
 * para que un PAN no acabe en logs del cliente, proxies o del servidor.
 */
import { HttpError } from '../utils/http-error.js';

/** Claves prohibidas (ya normalizadas: minusculas, sin "_" ni "-"). */
const FORBIDDEN_KEYS = new Set([
  'cardnumber',
  'number',
  'pan',
  'cvv',
  'cvc',
  'cvv2',
  'cvc2',
  'securitycode',
  'expiry',
  'expirationdate',
  'expmonth',
  'expyear',
  'track',
  'pin',
]);

/** Campos cuyo valor no se analiza como PAN. */
const PAN_EXEMPT_FIELDS = new Set(['senderAccountNumber', 'authorizationNumber']);

/** Profundidad maxima analizada; mas alla se rechaza por precaucion. */
const MAX_DEPTH = 10;

/** Secuencias maximas de digitos separados como mucho por un espacio o guion. */
const DIGIT_RUNS = /\d(?:[ -]?\d)*/g;

/**
 * Algoritmo de Luhn (mod 10) sobre una cadena de digitos.
 * @param {string} digits
 * @returns {boolean}
 */
export function passesLuhn(digits) {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Indica si un texto contiene un posible numero de tarjeta (PAN).
 * @param {string} text
 * @returns {boolean}
 */
export function containsPossiblePan(text) {
  for (const [run] of text.matchAll(DIGIT_RUNS)) {
    const digits = run.replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) return true;
  }
  return false;
}

/**
 * Normaliza una clave para compararla con la lista prohibida.
 * @param {string} key
 */
const normalizeKey = (key) => key.toLowerCase().replace(/[_-]/g, '');

/**
 * Recorre el valor y devuelve la primera violacion encontrada (sin el valor).
 * @param {unknown} value
 * @param {string} path Ruta del campo actual (p. ej. "payment.cvv").
 * @param {string | null} key Nombre del campo actual.
 * @param {number} depth
 * @returns {{ field: string, reason: 'forbidden_key' | 'possible_pan' | 'max_depth' } | null}
 */
export function findPciViolation(value, path = '', key = null, depth = 0) {
  if (typeof value === 'string' || typeof value === 'number') {
    if (key !== null && PAN_EXEMPT_FIELDS.has(key)) return null;
    return containsPossiblePan(String(value)) ? { field: path || '_root', reason: 'possible_pan' } : null;
  }
  if (value === null || typeof value !== 'object') return null;
  if (depth > MAX_DEPTH) return { field: path || '_root', reason: 'max_depth' };

  for (const [childKey, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${childKey}` : childKey;
    if (!Array.isArray(value) && FORBIDDEN_KEYS.has(normalizeKey(childKey))) {
      return { field: childPath, reason: 'forbidden_key' };
    }
    // En arrays se conserva la clave del campo padre para respetar las exclusiones.
    const found = findPciViolation(child, childPath, Array.isArray(value) ? key : childKey, depth + 1);
    if (found) return found;
  }
  return null;
}

/** @type {import('express').RequestHandler} */
export function pciGuard(req, _res, next) {
  const violation = findPciViolation(req.body) ?? findPciViolation(req.query);
  if (violation) {
    return next(
      HttpError.badRequest(
        'La solicitud contiene datos de tarjeta que no se pueden recibir. Envia solo el token de la pasarela de pago.',
        'PCI_DATA_FORBIDDEN',
        [violation],
      ),
    );
  }
  return next();
}
