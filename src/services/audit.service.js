/**
 * Servicio de auditoria.
 *
 * Registra acciones sensibles (autenticacion y gestion de usuarios) en
 * audit_logs. Un fallo al auditar se registra en el logger pero no interrumpe
 * la operacion de negocio: la disponibilidad del servicio prima, y el error
 * queda visible en los logs de la aplicacion.
 *
 * Fase 4:
 * - Todas las entradas se construyen en un unico punto (#buildEntry) y llevan
 *   siempre timestamp (= createdAt) y targetCollection (explicito o derivado
 *   de entity; null si no se conoce).
 * - recordInTransaction inserta dentro de la sesion de una transaccion y SI
 *   propaga los errores: si la auditoria falla, la operacion se revierte.
 * - search sirve la consulta paginada del superusuario.
 */
import { COLLECTIONS } from '../database/collections.js';
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

  // Fase 4: modulo exclusivo de superusuario
  STAFF_CREATED: 'staff.created',
  STAFF_ROLE_CHANGED: 'staff.role_changed',
  STAFF_STATUS_CHANGED: 'staff.status_changed',
  SETTINGS_UPDATED: 'settings.updated',
  RECORD_PURGED: 'record.purged',
});

/**
 * Coleccion afectada segun la entidad auditada (Fase 4), para las entradas que
 * no indican targetCollection. Los nombres de coleccion se aceptan tal cual.
 */
export const ENTITY_TARGET_COLLECTIONS = Object.freeze({
  user: COLLECTIONS.USERS,
  customer: COLLECTIONS.USERS,
  staff: COLLECTIONS.USERS,
  order: COLLECTIONS.ORDERS,
  payment: COLLECTIONS.ORDERS,
  invoice: COLLECTIONS.INVOICES,
  product: COLLECTIONS.PRODUCTS,
  coupon: COLLECTIONS.COUPONS,
  supplier: COLLECTIONS.SUPPLIERS,
  purchase: COLLECTIONS.PURCHASES,
  cart: COLLECTIONS.CARTS,
  settings: COLLECTIONS.SYSTEM_SETTINGS,
});

/** Nombres de coleccion validos (para aceptar entity = nombre de coleccion). */
const KNOWN_COLLECTIONS = Object.freeze(new Set(Object.values(COLLECTIONS)));

/**
 * Deriva la coleccion afectada de la entidad (null si no se conoce).
 * @param {string | undefined} entity
 * @returns {string | null}
 */
export function targetCollectionOf(entity) {
  if (typeof entity !== 'string') return null;
  if (Object.hasOwn(ENTITY_TARGET_COLLECTIONS, entity)) return ENTITY_TARGET_COLLECTIONS[entity];
  return KNOWN_COLLECTIONS.has(entity) ? entity : null;
}

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
   * Constructor unico de entradas (Fase 4): lo comparten record,
   * recordInTransaction y recordChange para que todas las entradas tengan la
   * misma forma. timestamp y createdAt son siempre el mismo instante.
   * @param {{ action: string, entity: string, entityId?: unknown, outcome?: 'success' | 'failure',
   *           actor?: { id: string, role: string } | null, metadata?: object,
   *           context?: { ip?: string | null, userAgent?: string | null },
   *           targetCollection?: string | null, snapshot?: object | null }} event
   * @returns {object} Documento listo para audit_logs.
   */
  #buildEntry({
    action,
    entity,
    entityId = null,
    outcome = 'success',
    actor = null,
    metadata = {},
    context = {},
    targetCollection,
    snapshot,
  }) {
    const timestamp = this.#now();
    const entry = {
      action,
      entity,
      entityId: entityId === null || entityId === undefined ? null : String(entityId),
      outcome,
      actorId: actor?.id ? toObjectId(actor.id) : null,
      actorRole: actor?.role ?? null,
      targetCollection: targetCollection ?? targetCollectionOf(entity),
      metadata,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      timestamp,
      createdAt: timestamp,
    };
    if (snapshot !== undefined) entry.snapshot = snapshot;
    return entry;
  }

  /**
   * Registra un evento. Nunca lanza excepciones.
   * @param {{ action: string, entity: string, entityId?: string | null, outcome?: 'success' | 'failure',
   *           actor?: { id: string, role: string } | null, metadata?: object,
   *           context?: { ip?: string | null, userAgent?: string | null },
   *           targetCollection?: string | null, snapshot?: object | null }} event
   */
  async record(event) {
    try {
      await this.#repository.create(this.#buildEntry(event));
    } catch (error) {
      this.#logger.error('No se pudo registrar el evento de auditoria', { action: event?.action, error: error.message });
    }
  }

  /**
   * Registra un evento dentro de la transaccion indicada (Fase 4).
   * A diferencia de record, PROPAGA cualquier error: el callback de la
   * transaccion falla y MongoDB revierte la operacion auditada, de modo que no
   * existe una mutacion sin su entrada de auditoria. Un reintento de
   * withTransaction descarta la insercion anterior, por lo que no duplica.
   * @param {Parameters<AuditService['record']>[0]} event
   * @param {import('mongodb').ClientSession} session Sesion de la transaccion en curso (obligatoria).
   * @returns {Promise<object>} Entrada insertada (con _id).
   */
  async recordInTransaction(event, session) {
    if (!session) throw new Error('recordInTransaction requiere la sesion de la transaccion');
    return this.#repository.create(this.#buildEntry(event), { session });
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
      const entry = this.#buildEntry({ action, entity: targetCollection, entityId: targetId, outcome, actor, metadata, context, targetCollection });
      await this.#repository.create({
        ...entry,
        role: actor?.role ?? null,
        targetId: entry.entityId,
        previousState: toAuditState(previousState),
        newState: toAuditState(newState),
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

  /**
   * Consulta paginada del superusuario (Fase 4): filtros por actor, rol,
   * accion, coleccion y rango de fechas sobre timestamp. Solo lectura.
   * @param {{ page: number, limit: number, actorId?: string, actorRole?: string, action?: string,
   *           targetCollection?: string, startDate?: Date, endDate?: Date }} query SuperuserAuditLogQueryDTO
   * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
   */
  async search(query) {
    const criteria = { ...query, actorId: query.actorId ? toObjectId(query.actorId) : undefined };
    const { items, total } = await this.#repository.search(criteria);
    return { items, total, page: query.page, limit: query.limit };
  }
}
