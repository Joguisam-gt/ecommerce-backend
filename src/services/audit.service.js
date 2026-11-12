/**
 * Servicio de auditoria.
 *
 * Registra acciones sensibles (autenticacion y gestion de usuarios) en
 * audit_logs. Un fallo al auditar se registra en el logger pero no interrumpe
 * la operacion de negocio: la disponibilidad del servicio prima, y el error
 * queda visible en los logs de la aplicacion.
 */
import { toObjectId } from '../utils/object-id.js';

/** Catalogo de acciones auditadas (formato "entidad.accion"). */
export const AUDIT_ACTIONS = Object.freeze({
  AUTH_REGISTER: 'auth.register',
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  AUTH_ACCOUNT_LOCKED: 'auth.account_locked',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_PASSWORD_CHANGED: 'auth.password_changed',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_PROFILE_UPDATED: 'user.profile_updated',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_STATUS_CHANGED: 'user.status_changed',
  USER_DELETED: 'user.deleted',
});

export class AuditService {
  #repository;
  #logger;
  #now;

  /**
   * @param {{ auditLogRepository: object, logger: object, clock?: () => Date }} deps
   */
  constructor({ auditLogRepository, logger, clock = () => new Date() }) {
    this.#repository = auditLogRepository;
    this.#logger = logger;
    this.#now = clock;
  }

  /**
   * Registra un evento. Nunca lanza excepciones.
   * @param {{ action: string, entity: string, entityId?: string | null, outcome?: 'success' | 'failure',
   *           actor?: { id: string, role: string } | null, metadata?: object,
   *           context?: { ip?: string | null, userAgent?: string | null } }} event
   */
  async record({ action, entity, entityId = null, outcome = 'success', actor = null, metadata = {}, context = {} }) {
    try {
      await this.#repository.create({
        action,
        entity,
        entityId: entityId === null ? null : String(entityId),
        outcome,
        actorId: actor?.id ? toObjectId(actor.id) : null,
        actorRole: actor?.role ?? null,
        metadata,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
        createdAt: this.#now(),
      });
    } catch (error) {
      this.#logger.error('No se pudo registrar el evento de auditoria', { action, error: error.message });
    }
  }

  /**
   * Consulta paginada de la bitacora.
   * @param {{ page: number, limit: number, actorId?: string }} query
   */
  async list(query) {
    const criteria = { ...query, actorId: query.actorId ? toObjectId(query.actorId) : undefined };
    const { items, total } = await this.#repository.list(criteria);
    return { items, total, page: query.page, limit: query.limit };
  }
}
