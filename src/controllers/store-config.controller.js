/**
 * Controlador de la configuracion publica de la tienda (Fase 4,
 * GET /api/store/config/public, sin autenticacion).
 *
 * Expone solo la tasa de IVA por defecto y las cuentas bancarias activas (sin
 * el campo isActive) para mostrar los datos de transferencia al cliente.
 * Sustituye la cabecera global Cache-Control: no-store por una cache publica
 * corta, porque la respuesta no contiene datos personales.
 */
import { PUBLIC_CONFIG_MAX_AGE_SECONDS } from '../constants/settings.js';
import { PublicStoreConfigDTO } from '../dtos/settings.dto.js';

export class StoreConfigController {
  #settings;

  /** @param {{ settingsService: import('../services/settings.service.js').SettingsService }} deps */
  constructor({ settingsService }) {
    this.#settings = settingsService;
  }

  /** GET /store/config/public */
  getPublic = async (_req, res) => {
    const config = await this.#settings.getPublicConfig();
    res.set('Cache-Control', `public, max-age=${PUBLIC_CONFIG_MAX_AGE_SECONDS}`);
    res.json({ data: PublicStoreConfigDTO.from(config) });
  };
}
