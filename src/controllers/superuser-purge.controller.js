/**
 * Controlador de purga (Fase 4, DELETE /api/superuser/purge/:collection/:id).
 */
import { requestContext } from '../utils/request-context.js';

export class SuperuserPurgeController {
  #purge;

  /** @param {{ purgeService: import('../services/purge.service.js').PurgeService }} deps */
  constructor({ purgeService }) {
    this.#purge = purgeService;
  }

  /** DELETE /superuser/purge/:collection/:id -> 200 { data: { collection, id, purged, auditLogId } } */
  purge = async (req, res) => {
    const result = await this.#purge.purge(req.user, req.params.collection, req.params.id, requestContext(req));
    res.json({ data: result });
  };
}
