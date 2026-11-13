/**
 * Middleware de modo mantenimiento (Fase 4).
 *
 * Consulta la configuracion global (system_settings.maintenanceMode) y, si esta
 * activo, corta la peticion con 503 MAINTENANCE_MODE antes de llegar al
 * controlador. Se monta en las rutas de compra (POST /api/pos/checkout).
 * Un fallo al leer la configuracion se propaga al manejador de errores
 * (Express 5 captura el rechazo de la promesa): sin base de datos la compra
 * fallaria igualmente.
 */
import { HttpError } from '../utils/http-error.js';

/**
 * @param {{ settingsService: { isMaintenanceMode: () => Promise<boolean> } }} deps
 * @returns {import('express').RequestHandler}
 */
export function createMaintenanceGuard({ settingsService }) {
  return async function maintenanceGuard(_req, _res, next) {
    if (await settingsService.isMaintenanceMode()) {
      throw new HttpError(503, 'La tienda esta en mantenimiento; intenta de nuevo mas tarde', 'MAINTENANCE_MODE');
    }
    next();
  };
}
