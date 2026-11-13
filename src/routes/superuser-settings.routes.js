/**
 * Configuracion global (Fase 4), montada en /api/superuser/settings.
 * Permiso fino: settings:manage.
 *
 * | Metodo | Ruta | Descripcion                                         |
 * |--------|------|-----------------------------------------------------|
 * | GET    | /    | configuracion completa (o valores por defecto)      |
 * | PATCH  | /    | defaultTaxRate, companyBankAccounts, maintenanceMode |
 */
import { Router } from 'express';
import { PERMISSIONS } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { updateSettingsSchema } from '../validators/settings.validator.js';

/**
 * @param {{ settingsController: import('../controllers/superuser-settings.controller.js').SuperuserSettingsController }} deps
 * @returns {Router}
 */
export function createSuperuserSettingsRoutes({ settingsController }) {
  const router = Router();

  router.use(authorize(PERMISSIONS.SETTINGS_MANAGE));

  router.get('/', settingsController.get);
  router.patch('/', validate(updateSettingsSchema), settingsController.update);

  return router;
}
