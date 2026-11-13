/**
 * Manejo centralizado de errores y de rutas inexistentes.
 *
 * Traduce cualquier error a una respuesta JSON uniforme:
 *   { "error": { "code": "...", "message": "...", "details": ... } }
 * Los errores inesperados se registran completos en el logger, pero al cliente
 * solo se le devuelve un mensaje generico en produccion.
 */
import { HttpError } from '../utils/http-error.js';

/** Codigo de MongoDB para violacion de indice unico. */
const MONGO_DUPLICATE_KEY = 11000;

/** Codigo de MongoDB para documento rechazado por el validador $jsonSchema. */
const MONGO_DOCUMENT_VALIDATION = 121;

/**
 * Envia la respuesta de error con formato uniforme.
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {unknown} [details]
 */
function send(res, status, code, message, details) {
  const body = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return res.status(status).json(body);
}

/** @type {import('express').RequestHandler} */
export function notFound(req, _res, next) {
  next(HttpError.notFound(`Ruta no encontrada: ${req.method} ${req.path}`, 'ROUTE_NOT_FOUND'));
}

/**
 * @param {{ logger: object, isProduction: boolean }} deps
 * @returns {import('express').ErrorRequestHandler}
 */
export function createErrorHandler({ logger, isProduction }) {
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    if (err instanceof HttpError) {
      if (err.status >= 500) logger.error(err.message, { code: err.code, path: req.path });
      // Algunos errores tienen un cuerpo fijado por contrato (p. ej. INSUFFICIENT_STOCK).
      if (err.body) return res.status(err.status).json(err.body);
      return send(res, err.status, err.code, err.message, err.details);
    }

    if (err?.type === 'entity.parse.failed') {
      return send(res, 400, 'INVALID_JSON', 'El cuerpo de la solicitud no es JSON valido');
    }
    if (err?.type === 'entity.too.large') {
      return send(res, 413, 'PAYLOAD_TOO_LARGE', 'El cuerpo de la solicitud es demasiado grande');
    }

    if (err?.code === MONGO_DUPLICATE_KEY) {
      return send(res, 409, 'DUPLICATE_KEY', 'Ya existe un registro con esos datos', {
        fields: Object.keys(err.keyValue ?? err.keyPattern ?? {}),
      });
    }
    if (err?.code === MONGO_DOCUMENT_VALIDATION) {
      logger.error('Documento rechazado por $jsonSchema', { path: req.path, errInfo: err.errInfo });
      return send(res, 422, 'DOCUMENT_VALIDATION_FAILED', 'Los datos no cumplen el esquema de la base de datos');
    }

    logger.error('Error no controlado', { path: req.path, method: req.method, error: err?.message, stack: err?.stack });
    return send(res, 500, 'INTERNAL_ERROR', isProduction ? 'Error interno del servidor' : (err?.message ?? 'Error interno'));
  };
}
