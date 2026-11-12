/**
 * Defensa en profundidad contra inyeccion de operadores NoSQL.
 *
 * Rechaza cualquier cuerpo que contenga claves que empiecen por "$" o que
 * incluyan "." en cualquier nivel (por ejemplo {"email": {"$ne": null}}).
 * Los validadores ya exigen tipos primitivos; esta capa protege tambien a
 * rutas futuras que olviden validar. Limita la profundidad para evitar abusos.
 */
import { HttpError } from '../utils/http-error.js';

const MAX_DEPTH = 10;

/**
 * Recorre el valor y devuelve la primera clave prohibida encontrada.
 * @param {unknown} value
 * @param {number} depth
 * @returns {string | null}
 */
export function findForbiddenKey(value, depth = 0) {
  if (value === null || typeof value !== 'object') return null;
  if (depth > MAX_DEPTH) return '(profundidad maxima superada)';

  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith('$') || key.includes('.')) return key;
    const found = findForbiddenKey(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

/** @type {import('express').RequestHandler} */
export function sanitizeInput(req, _res, next) {
  const forbidden = findForbiddenKey(req.body) ?? findForbiddenKey(req.query);
  if (forbidden) {
    return next(HttpError.badRequest('La solicitud contiene claves no permitidas', 'FORBIDDEN_KEYS', [{ field: forbidden }]));
  }
  return next();
}
