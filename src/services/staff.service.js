/**
 * Servicio de gestion de personal (Fase 4, exclusivo de superusuario).
 *
 * Responsabilidad unica: altas de cuentas administrativas, listado del
 * personal y cambios de rol y estado con la regla anti-bloqueo.
 *
 * Regla anti-bloqueo: si el objetivo es un superusuario ACTIVO y la operacion
 * lo degrada (rol distinto de superuser) o lo desactiva:
 * - el actor no puede ser el propio objetivo: 409 SELF_LOCKOUT;
 * - debe quedar al menos otro superusuario activo: 409 LAST_SUPERUSER.
 *
 * Concurrencia (write skew): dos superusuarios que se degradan mutuamente a la
 * vez leerian cada uno "hay 2 superusuarios" y ambos confirmarian, dejando el
 * sistema sin ninguno. Para evitarlo, cada cambio de rol o estado se ejecuta
 * en una transaccion que ESCRIBE PRIMERO en un documento centinela comun
 * (counters/_id 'superuser_governance_lock', $inc con upsert): dos
 * transacciones concurrentes chocan en ese documento, MongoDB aborta una con
 * WriteConflict (TransientTransactionError) y withTransaction la reintenta
 * con una lectura y un recuento frescos. La lectura del objetivo, el recuento,
 * la actualizacion y la auditoria comparten la misma transaccion.
 *
 * Los cambios de rol y la desactivacion incrementan tokenVersion (repositorio
 * de usuarios), revocando las sesiones abiertas del afectado.
 *
 * Reutilizacion desde la Fase 1: UserService (PATCH /api/v1/users/:id/role y
 * /status) delega aqui la escritura para heredar el centinela, el recuento
 * transaccional y la auditoria en la transaccion. Para ello changeRole y
 * changeStatus aceptan un parametro opcional "options":
 * - authorize(target): reglas de acceso del llamador (jerarquia, auto-modificacion),
 *   evaluadas DENTRO de la transaccion sobre la lectura fresca del objetivo,
 *   antes de la comprobacion de "sin cambios" y de la regla anti-bloqueo;
 * - auditAction: accion de auditoria a registrar (por defecto, la de personal).
 */
import { ROLES, isValidRole } from '../constants/roles.js';
import { STAFF_ROLES, SUPERUSER_GOVERNANCE_LOCK } from '../constants/superuser.js';
import { COLLECTIONS } from '../database/collections.js';
import { HttpError } from '../utils/http-error.js';
import { toObjectId } from '../utils/object-id.js';
import { AUDIT_ACTIONS } from './audit.service.js';
import { buildUserDocument } from './user-document.factory.js';

/** Codigo de MongoDB para violacion de indice unico. */
const MONGO_DUPLICATE_KEY = 11000;

/** Entidad registrada en auditoria. */
const ENTITY = 'user';

/** 404 de cuenta inexistente. */
const notFound = () => HttpError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');

/** 409 de correo ya registrado (mismo codigo que UserService). */
const emailInUse = () => HttpError.conflict('El correo ya esta registrado', 'EMAIL_IN_USE');

/**
 * Estado auditable de una cuenta: solo identidad, rol y estado (sin secretos).
 * @param {object | null} user
 * @returns {{ email: string, role: string, isActive: boolean } | null}
 */
export function staffAuditState(user) {
  return user ? { email: user.email, role: user.role, isActive: user.isActive } : null;
}

/**
 * Opciones de reutilizacion de changeRole/changeStatus (ver cabecera).
 * @typedef {{ authorize?: (target: object) => void, auditAction?: string }} GovernanceOptions
 */

export class StaffService {
  #users;
  #passwords;
  #sequences;
  #transactions;
  #audit;
  #now;

  /**
   * @param {{ userRepository: import('../repositories/user.repository.js').UserRepository,
   *           passwordService: import('./password.service.js').PasswordService,
   *           sequenceRepository: import('../repositories/sequence.repository.js').SequenceRepository,
   *           transactionRunner: { run: (work: (session: object) => Promise<any>) => Promise<any> },
   *           auditService: import('./audit.service.js').AuditService, clock?: () => Date }} deps
   */
  constructor({ userRepository, passwordService, sequenceRepository, transactionRunner, auditService, clock = () => new Date() }) {
    this.#users = userRepository;
    this.#passwords = passwordService;
    this.#sequences = sequenceRepository;
    this.#transactions = transactionRunner;
    this.#audit = auditService;
    this.#now = clock;
  }

  /**
   * Listado paginado del personal (roles admin y superuser). El repositorio
   * nunca proyecta passwordHash en los listados.
   * @param {{ page: number, limit: number, role?: string, isActive?: boolean, search?: string }} query ListUsersQueryDTO
   * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
   */
  async listStaff(query) {
    const { items, total } = await this.#users.list({ ...query, roles: STAFF_ROLES });
    return { items, total, page: query.page, limit: query.limit };
  }

  /**
   * Alta de una cuenta de personal (solo roles admin o superuser).
   * El hash se calcula fuera de la transaccion (trabajo de CPU, no transaccional);
   * la insercion y su auditoria comparten transaccion.
   * @param {{ id: string, role: string }} actor
   * @param {import('../dtos/user.dto.js').CreateUserDTO} dto
   * @param {object} [context] requestContext(req)
   * @returns {Promise<object>} Usuario creado.
   */
  async createStaff(actor, dto, context = {}) {
    if (!STAFF_ROLES.includes(dto.role)) {
      throw HttpError.badRequest('Solo se puede crear personal con rol admin o superuser', 'ROLE_NOT_STAFF');
    }
    if (await this.#users.findByEmail(dto.email)) throw emailInUse();

    const passwordHash = await this.#passwords.hash(dto.password);
    const { password: _omit, ...data } = dto;
    const document = buildUserDocument({ ...data, passwordHash }, this.#now());

    try {
      return await this.#transactions.run(async (session) => {
        // Copia por intento: el driver anade _id al objeto insertado.
        const user = await this.#users.create({ ...document }, { session });
        await this.#audit.recordInTransaction(
          {
            action: AUDIT_ACTIONS.STAFF_CREATED,
            entity: ENTITY,
            entityId: user._id,
            targetCollection: COLLECTIONS.USERS,
            actor,
            metadata: { before: null, after: staffAuditState(user) },
            context,
          },
          session,
        );
        return user;
      });
    } catch (error) {
      // Carrera con otra alta del mismo correo: el indice unico uq_users_email decide.
      if (error?.code === MONGO_DUPLICATE_KEY) throw emailInUse();
      throw error;
    }
  }

  /**
   * Cambia el rol de cualquier cuenta. Revoca sus sesiones (tokenVersion + 1).
   * Sin cambios (mismo rol) no escribe ni audita.
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {string} role Rol de ALL_ROLES.
   * @param {object} [context]
   * @param {GovernanceOptions} [options]
   * @returns {Promise<object>} Usuario resultante.
   */
  async changeRole(actor, id, role, context = {}, { authorize, auditAction = AUDIT_ACTIONS.STAFF_ROLE_CHANGED } = {}) {
    if (!isValidRole(role)) throw HttpError.badRequest('Rol invalido', 'INVALID_ROLE');
    const targetId = toObjectId(id);

    return this.#transactions.run(async (session) => {
      await this.#acquireGovernanceLock(session);
      const target = await this.#findOrFail(targetId, session);
      authorize?.(target);
      if (target.role === role) return target;

      if (this.#isActiveSuperuser(target) && role !== ROLES.SUPERUSER) {
        await this.#assertCanRemoveSuperuser(actor, target, session);
      }

      const updated = await this.#users.updateRole(target._id, role, this.#now(), { session });
      if (!updated) throw notFound();
      await this.#recordChange(auditAction, actor, target, updated, context, session, {
        sessionsRevoked: true,
      });
      return updated;
    });
  }

  /**
   * Activa o desactiva cualquier cuenta. Desactivar revoca sus sesiones.
   * Sin cambios (mismo estado) no escribe ni audita.
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {boolean} isActive
   * @param {object} [context]
   * @param {GovernanceOptions} [options]
   * @returns {Promise<object>} Usuario resultante.
   */
  async changeStatus(actor, id, isActive, context = {}, { authorize, auditAction = AUDIT_ACTIONS.STAFF_STATUS_CHANGED } = {}) {
    if (typeof isActive !== 'boolean') throw HttpError.badRequest('isActive debe ser booleano', 'INVALID_STATUS');
    const targetId = toObjectId(id);

    return this.#transactions.run(async (session) => {
      await this.#acquireGovernanceLock(session);
      const target = await this.#findOrFail(targetId, session);
      authorize?.(target);
      if (target.isActive === isActive) return target;

      if (this.#isActiveSuperuser(target) && !isActive) {
        await this.#assertCanRemoveSuperuser(actor, target, session);
      }

      const updated = await this.#users.updateStatus(target._id, isActive, this.#now(), { session });
      if (!updated) throw notFound();
      await this.#recordChange(auditAction, actor, target, updated, context, session, {
        sessionsRevoked: !isActive,
      });
      return updated;
    });
  }

  /**
   * Escritura en el documento centinela: primera operacion de la transaccion.
   * Fuerza el conflicto de escritura entre cambios de gobierno concurrentes.
   * @param {object} session
   */
  async #acquireGovernanceLock(session) {
    await this.#sequences.next(SUPERUSER_GOVERNANCE_LOCK, { session });
  }

  /**
   * Cuenta dentro de la transaccion o 404.
   * @param {import('mongodb').ObjectId} id
   * @param {object} session
   */
  async #findOrFail(id, session) {
    const user = await this.#users.findById(id, { session });
    if (!user) throw notFound();
    return user;
  }

  /**
   * @param {{ role: string, isActive: boolean }} user
   * @returns {boolean}
   */
  #isActiveSuperuser(user) {
    return user.role === ROLES.SUPERUSER && user.isActive === true;
  }

  /**
   * Regla anti-bloqueo (ver cabecera). El recuento se hace dentro de la
   * transaccion, despues de escribir el centinela.
   * @param {{ id: string }} actor
   * @param {{ _id: import('mongodb').ObjectId }} target Superusuario activo.
   * @param {object} session
   */
  async #assertCanRemoveSuperuser(actor, target, session) {
    if (actor?.id === target._id.toString()) {
      throw HttpError.conflict('No puedes degradarte ni desactivarte a ti mismo', 'SELF_LOCKOUT');
    }
    const activeSuperusers = await this.#users.countActiveByRole(ROLES.SUPERUSER, { session });
    // El objetivo cuenta como activo: deben quedar otros ademas de el.
    if (activeSuperusers - 1 < 1) {
      throw HttpError.conflict('Debe quedar al menos otro superusuario activo', 'LAST_SUPERUSER');
    }
  }

  /**
   * Auditoria del cambio dentro de la misma transaccion (before/after en metadata).
   * @param {string} action
   * @param {{ id: string, role: string }} actor
   * @param {object} before
   * @param {object} after
   * @param {object} context
   * @param {object} session
   * @param {object} [extra] Metadatos adicionales.
   */
  #recordChange(action, actor, before, after, context, session, extra = {}) {
    return this.#audit.recordInTransaction(
      {
        action,
        entity: ENTITY,
        entityId: before._id,
        targetCollection: COLLECTIONS.USERS,
        actor,
        metadata: { before: staffAuditState(before), after: staffAuditState(after), ...extra },
        context,
      },
      session,
    );
  }
}
