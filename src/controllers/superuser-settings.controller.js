/**
 * Controlador de la configuracion global (Fase 4, /api/superuser/settings).
 */
import { SettingsResponseDTO, UpdateSettingsDTO } from '../dtos/settings.dto.js';
import { requestContext } from '../utils/request-context.js';

export class SuperuserSettingsController {
  #settings;

  /** @param {{ settingsService: import('../services/settings.service.js').SettingsService }} deps */
  constructor({ settingsService }) {
    this.#settings = settingsService;
  }

  /** GET /superuser/settings: documento guardado o valores por defecto. */
  get = async (_req, res) => {
    res.json({ data: SettingsResponseDTO.from(await this.#settings.getSettings()) });
  };

  /** PATCH /superuser/settings: actualizacion parcial auditada. */
  update = async (req, res) => {
    const settings = await this.#settings.updateSettings(req.user, UpdateSettingsDTO.from(req.body), requestContext(req));
    res.json({ data: SettingsResponseDTO.from(settings) });
  };
}
