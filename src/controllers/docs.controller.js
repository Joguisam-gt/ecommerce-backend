/**
 * Controlador de la documentacion de la API.
 *
 * Sirve la especificacion OpenAPI 3.0.3 como JSON publico (sin autenticacion)
 * para que Swagger UI u otros clientes la carguen. No depende del contenedor:
 * la especificacion es un objeto estatico e inmutable.
 */
import { openApiSpec } from '../docs/openapi.js';

/**
 * GET /docs/openapi.json
 * @type {import('express').RequestHandler}
 */
export function serveOpenApi(_req, res) {
  res.json(openApiSpec);
}
