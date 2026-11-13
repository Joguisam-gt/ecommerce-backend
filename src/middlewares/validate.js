/**
 * Middleware de validacion de entrada.
 *
 * Aplica un esquema declarativo a body, query o params y responde 400 con la
 * lista de errores por campo. Los controladores solo se ejecutan con datos validos.
 */
import { HttpError } from '../utils/http-error.js';
import { validateSchema } from '../validators/schema-validator.js';

const SOURCES = Object.freeze(['body', 'query', 'params']);

/**
 * @param {object} schema Esquema de validators/*.
 * @param {'body' | 'query' | 'params'} [source='body']
 * @returns {import('express').RequestHandler}
 */
export function validate(schema, source = 'body') {
  if (!SOURCES.includes(source)) throw new Error(`Origen de validacion no soportado: ${source}`);

  return function validateMiddleware(req, _res, next) {
    const errors = validateSchema(schema, req[source] ?? {});
    if (errors.length > 0) {
      return next(HttpError.badRequest('Datos de entrada invalidos', 'VALIDATION_ERROR', errors));
    }
    return next();
  };
}
