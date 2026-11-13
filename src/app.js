/**
 * Construccion de la aplicacion Express.
 *
 * Separada de server.js para poder crear la app en pruebas sin abrir puertos
 * ni conectar a MongoDB. Orden de middlewares: seguridad -> CORS -> parseo ->
 * saneamiento -> rutas -> 404 -> manejador de errores.
 * Express 5 propaga automaticamente los errores de handlers async.
 */
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { createErrorHandler, notFound } from './middlewares/error-handler.js';
import { sanitizeInput } from './middlewares/sanitize-input.js';
import { securityHeaders } from './middlewares/security-headers.js';
import { createApiRouter } from './routes/index.js';
import { HttpError } from './utils/http-error.js';

/**
 * CORS con lista blanca y credenciales (necesario para enviar cookies).
 * Las peticiones sin cabecera Origin (curl, servidores, POS nativo) se permiten.
 * @param {string[]} allowedOrigins
 */
function buildCorsOptions(allowedOrigins) {
  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(HttpError.forbidden('Origen no permitido por CORS', 'CORS_REJECTED'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  };
}

/**
 * @param {{ config: object, container: object, logger: object }} deps
 * @returns {import('express').Express}
 */
export function createApp({ config, container, logger }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.server.trustProxy);
  app.set('query parser', 'simple');

  app.use(securityHeaders({ isProduction: config.isProduction }));
  app.use(cors(buildCorsOptions(config.cors.origins)));
  app.use(express.json({ limit: config.server.bodyLimit }));
  app.use(cookieParser());
  app.use(sanitizeInput);

  // /api/v1 es la ruta canonica; /api es un alias para los contratos de la Fase 2 (/api/store, /api/pos...).
  app.use(['/api/v1', '/api'], createApiRouter(container));

  app.use(notFound);
  app.use(createErrorHandler({ logger, isProduction: config.isProduction }));

  return app;
}
