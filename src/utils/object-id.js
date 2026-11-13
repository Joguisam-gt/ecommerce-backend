/**
 * Utilidades para identificadores de MongoDB.
 *
 * Convierte cadenas en ObjectId de forma estricta (24 caracteres hexadecimales)
 * y traduce los fallos a un HttpError 400 en lugar de un error interno.
 */
import { ObjectId } from 'mongodb';
import { HttpError } from './http-error.js';

const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;

/**
 * Indica si el valor es un ObjectId o una cadena hexadecimal de 24 caracteres.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidObjectId(value) {
  if (value instanceof ObjectId) return true;
  return typeof value === 'string' && OBJECT_ID_REGEX.test(value);
}

/**
 * Convierte a ObjectId o lanza un 400.
 * @param {string | ObjectId} value
 * @returns {ObjectId}
 */
export function toObjectId(value) {
  if (value instanceof ObjectId) return value;
  if (!isValidObjectId(value)) {
    throw HttpError.badRequest('Identificador invalido', 'INVALID_ID');
  }
  return ObjectId.createFromHexString(value);
}
