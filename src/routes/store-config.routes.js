/**
 * Configuracion publica de la tienda (Fase 4), montada en /api/store/config
 * ANTES del router /store del catalogo. Sin autenticacion.
 *
 * | Metodo | Ruta    | Respuesta                                              |
 * |--------|---------|--------------------------------------------------------|
 * | GET    | /public | { data: { defaultTaxRate, companyBankAccounts } } (activas) |
 */
import { Router } from 'express';

/**
 * @param {{ storeConfigController: import('../controllers/store-config.controller.js').StoreConfigController }} deps
 * @returns {Router}
 */
export function createStoreConfigRoutes({ storeConfigController }) {
  const router = Router();
  router.get('/public', storeConfigController.getPublic);
  return router;
}
