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
  ORDER_CREATED: 'order.created',
  CHECKOUT_FAILED: 'order.checkout_failed',
  PAYMENT_DECLINED: 'payment.declined',

  // Fase 3: panel de administracion
  ORDER_PAYMENT_APPROVED: 'order.payment_approved',
  ORDER_PAYMENT_REJECTED: 'order.payment_rejected',
  COUPON_CREATED: 'coupon.created',
  COUPON_UPDATED: 'coupon.updated',
  COUPON_DEACTIVATED: 'coupon.deactivated',
  PRODUCT_UPDATED: 'product.updated',
  INVENTORY_LOSS_RECORDED: 'inventory.loss_recorded',
  PURCHASE_CREATED: 'purchase.created',
  SUPPLIER_CREATED: 'supplier.created',
  SUPPLIER_UPDATED: 'supplier.updated',
  SUPPLIER_DEACTIVATED: 'supplier.deactivated',
  SUPPLIER_DELETED: 'supplier.deleted',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_DEACTIVATED: 'customer.deactivated',
  CUSTOMER_DELETED: 'customer.deleted',
});

/** Campos que nunca se copian a previousState / newState. */
const SENSITIVE_STATE_FIELDS = Object.freeze(['passwordHash', 'tokenVersion', 'failedLoginAttempts', 'lockUntil']);

/**
 * Copia superficial de un documento sin campos sensibles (null si no hay estado).
 * @param {object | null | undefined} state
 * @returns {object | null}
 */
export function toAuditState(state) {
  if (!state || typeof state !== 'object') return null;
  const copy = { ...state };
  for (const field of SENSITIVE_STATE_FIELDS) delete copy[field];
  return copy;
}

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
   * Registra una mutacion administrativa con el contrato de cambio completo.
   * Nunca lanza excepciones. Debe llamarse DESPUES del commit de la transaccion
   * (un reintento de withTransaction duplicaria el registro).
   * @param {{ actor: { id: string, role: string }, action: string, targetCollection: string,
   *           targetId: unknown, previousState?: object | null, newState?: object | null,
   *           outcome?: 'success' | 'failure', metadata?: object,
   *           context?: { ip?: string | null, userAgent?: string | null } }} change
   */
  async recordChange({
    actor,
    action,
    targetCollection,
    targetId,
    previousState = null,
    newState = null,
    outcome = 'success',
    metadata = {},
    context = {},
  }) {
    try {
      const timestamp = this.#now();
      const id = targetId === null || targetId === undefined ? null : String(targetId);
      await this.#repository.create({
        action,
        entity: targetCollection,
        entityId: id,
        outcome,
        actorId: actor?.id ? toObjectId(actor.id) : null,
        actorRole: actor?.role ?? null,
        role: actor?.role ?? null,
        targetCollection,
        targetId: id,
        previousState: toAuditState(previousState),
        newState: toAuditState(newState),
        metadata,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
        timestamp,
        createdAt: timestamp,
      });
    } catch (error) {
      this.#logger.error('No se pudo registrar el cambio en auditoria', { action, error: error.message });
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
