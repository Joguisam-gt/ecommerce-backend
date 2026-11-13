/**
 * Servicio de gestion de usuarios.
 *
 * Aplica las reglas de negocio que no caben en un simple permiso de ruta:
 * jerarquia de roles (user-access.policy), proteccion contra auto-modificacion,
 * garantia de que siempre exista al menos un superusuario activo y auditoria
 * de cada cambio. Las rutas comprueban el permiso; este servicio lo vuelve a
 * comprobar en las operaciones destructivas (defensa en profundidad).
 *
 * Cambios de rol/estado y borrado fisico NO escriben directamente: delegan en
 * StaffService (transaccion con centinela 'superuser_governance_lock' contra
 * el write skew de "ultimo superusuario") y en PurgeService (borrado logico
 * previo, bloqueo fiscal, cascada y auditoria en una transaccion).
 */
import { PERMISSIONS, hasPermission } from '../constants/permissions.js';
import { PURGEABLE_COLLECTIONS } from '../constants/superuser.js';
import { HttpError } from '../utils/http-error.js';
import { toObjectId } from '../utils/object-id.js';
import { AUDIT_ACTIONS } from './audit.service.js';
import { canAssignRole, canManageUser, isSelf } from './user-access.policy.js';
import { buildUserDocument } from './user-document.factory.js';

const ENTITY = 'user';

export class UserService {
  #users;
  #passwords;
  #audit;
  #staff;
  #purge;
  #now;

  /**
   * @param {{ userRepository: object, passwordService: object, auditService: object,
   *           staffService: import('./staff.service.js').StaffService,
   *           purgeService: import('./purge.service.js').PurgeService, clock?: () => Date }} deps
   */
  constructor({ userRepository, passwordService, auditService, staffService, purgeService, clock = () => new Date() }) {
    this.#users = userRepository;
    this.#passwords = passwordService;
    this.#audit = auditService;
    this.#staff = staffService;
    this.#purge = purgeService;
    this.#now = clock;
  }

  /**
   * Perfil del usuario autenticado.
   * @param {{ id: string }} actor
   */
  getProfile(actor) {
    return this.#findOrFail(actor.id);
  }

  /**
   * Actualiza nombre y telefono del propio usuario.
   * @param {{ id: string, role: string }} actor
   * @param {object} changes UpdateProfileDTO
   * @param {object} [context]
   */
  async updateProfile(actor, changes, context = {}) {
    const updated = await this.#users.updateById(toObjectId(actor.id), changes, this.#now());
    if (!updated) throw HttpError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');

    await this.#audit.record({
      action: AUDIT_ACTIONS.USER_PROFILE_UPDATED,
      entity: ENTITY,
      entityId: actor.id,
      actor,
      metadata: { fields: Object.keys(changes) },
      context,
    });
    return updated;
  }

  /**
   * Listado paginado para administracion.
   * @param {{ page: number, limit: number, role?: string, isActive?: boolean, search?: string }} query
   */
  async listUsers(query) {
    const { items, total } = await this.#users.list(query);
    return { items, total, page: query.page, limit: query.limit };
  }

  /** @param {string} id */
  getUserById(id) {
    return this.#findOrFail(id);
  }

  /**
   * Alta administrativa. El admin solo puede crear clientes; el superusuario, cualquier rol.
   * @param {{ id: string, role: string }} actor
   * @param {import('../dtos/user.dto.js').CreateUserDTO} dto
   * @param {object} [context]
   */
  async createUser(actor, dto, context = {}) {
    if (!canAssignRole(actor.role, dto.role)) {
      throw HttpError.forbidden('No puedes crear usuarios con ese rol', 'ROLE_NOT_ASSIGNABLE');
    }
    if (await this.#users.findByEmail(dto.email)) {
      throw HttpError.conflict('El correo ya esta registrado', 'EMAIL_IN_USE');
    }

    const passwordHash = await this.#passwords.hash(dto.password);
    const { password: _omit, ...data } = dto;
    const user = await this.#users.create(buildUserDocument({ ...data, passwordHash }, this.#now()));

    await this.#audit.record({
      action: AUDIT_ACTIONS.USER_CREATED,
      entity: ENTITY,
      entityId: user._id.toString(),
      actor,
      metadata: { role: user.role, email: user.email },
      context,
    });
    return user;
  }

  /**
   * Actualizacion administrativa de datos basicos (sin rol ni estado).
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {object} changes UpdateUserDTO
   * @param {object} [context]
   */
  async updateUser(actor, id, changes, context = {}) {
    const target = await this.#findOrFail(id);
    this.#assertCanManage(actor, target);

    if (changes.email && changes.email !== target.email && (await this.#users.findByEmail(changes.email))) {
      throw HttpError.conflict('El correo ya esta registrado', 'EMAIL_IN_USE');
    }

    const updated = await this.#users.updateById(target._id, changes, this.#now());
    await this.#audit.record({
      action: AUDIT_ACTIONS.USER_UPDATED,
      entity: ENTITY,
      entityId: id,
      actor,
      metadata: { fields: Object.keys(changes) },
      context,
    });
    return updated;
  }

  /**
   * Cambio de rol (solo superusuario por permiso admins:manage). Revoca las sesiones del afectado.
   *
   * Las reglas de la Fase 1 (auto-modificacion, rol asignable, jerarquia) se
   * evaluan dentro de la transaccion de StaffService sobre la lectura fresca
   * del objetivo; la escritura, la regla anti-bloqueo (centinela + recuento)
   * y la auditoria comparten esa misma transaccion.
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {string} role
   * @param {object} [context]
   */
  changeRole(actor, id, role, context = {}) {
    return this.#staff.changeRole(actor, id, role, context, {
      auditAction: AUDIT_ACTIONS.USER_ROLE_CHANGED,
      authorize: (target) => {
        if (isSelf(actor, target)) {
          throw HttpError.forbidden('No puedes cambiar tu propio rol', 'SELF_MODIFICATION_FORBIDDEN');
        }
        if (!canAssignRole(actor.role, role)) {
          throw HttpError.forbidden('No puedes asignar ese rol', 'ROLE_NOT_ASSIGNABLE');
        }
        this.#assertCanManage(actor, target);
      },
    });
  }

  /**
   * Activa o desactiva una cuenta (borrado logico). Desactivar revoca sus sesiones.
   * Misma ruta transaccional que changeRole: un admin sigue pudiendo
   * desactivar clientes (jerarquia de user-access.policy).
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {boolean} isActive
   * @param {object} [context]
   */
  changeStatus(actor, id, isActive, context = {}) {
    return this.#staff.changeStatus(actor, id, isActive, context, {
      auditAction: AUDIT_ACTIONS.USER_STATUS_CHANGED,
      authorize: (target) => {
        if (isSelf(actor, target)) {
          throw HttpError.forbidden('No puedes cambiar el estado de tu propia cuenta', 'SELF_MODIFICATION_FORBIDDEN');
        }
        this.#assertCanManage(actor, target);
      },
    });
  }

  /**
   * Borrado fisico (solo superusuario). Delega en PurgeService, que en una
   * transaccion exige borrado logico previo (400 NOT_SOFT_DELETED), aplica el
   * bloqueo fiscal (409 FISCAL_INTEGRITY_LOCK), elimina el carrito en cascada
   * y audita record.purged con la instantanea redactada del usuario.
   * Como solo se purgan cuentas ya desactivadas, no puede reducir el numero de
   * superusuarios activos (la desactivacion ya paso por la regla anti-bloqueo).
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {object} [context]
   * @returns {Promise<{ collection: string, id: string, purged: true, auditLogId: string }>}
   */
  async deleteUser(actor, id, context = {}) {
    if (!hasPermission(actor.role, PERMISSIONS.USERS_DELETE)) {
      throw HttpError.forbidden('El borrado fisico esta reservado al superusuario', 'HARD_DELETE_FORBIDDEN');
    }
    if (actor.id === id) {
      throw HttpError.forbidden('No puedes eliminar tu propia cuenta', 'SELF_MODIFICATION_FORBIDDEN');
    }
    try {
      return await this.#purge.purge(actor, PURGEABLE_COLLECTIONS.USERS, id, context);
    } catch (error) {
      // Conserva el codigo de la Fase 1 para cuentas inexistentes.
      if (error instanceof HttpError && error.code === 'RECORD_NOT_FOUND') {
        throw HttpError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');
      }
      throw error;
    }
  }

  /**
   * Busca un usuario por id o lanza 404.
   * @param {string} id
   */
  async #findOrFail(id) {
    const user = await this.#users.findById(toObjectId(id));
    if (!user) throw HttpError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');
    return user;
  }

  /**
   * Lanza 403 si el actor no tiene rango para gestionar al objetivo.
   * @param {{ role: string }} actor
   * @param {{ role: string }} target
   */
  #assertCanManage(actor, target) {
    if (!canManageUser(actor, target)) {
      throw HttpError.forbidden('No puedes gestionar usuarios de este rol', 'INSUFFICIENT_RANK');
    }
  }
}
