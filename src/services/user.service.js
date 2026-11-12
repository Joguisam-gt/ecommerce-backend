/**
 * Servicio de gestion de usuarios.
 *
 * Aplica las reglas de negocio que no caben en un simple permiso de ruta:
 * jerarquia de roles (user-access.policy), proteccion contra auto-modificacion,
 * garantia de que siempre exista al menos un superusuario activo y auditoria
 * de cada cambio. Las rutas comprueban el permiso; este servicio lo vuelve a
 * comprobar en las operaciones destructivas (defensa en profundidad).
 */
import { PERMISSIONS, hasPermission } from '../constants/permissions.js';
import { ROLES } from '../constants/roles.js';
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
  #now;

  /**
   * @param {{ userRepository: object, passwordService: object, auditService: object, clock?: () => Date }} deps
   */
  constructor({ userRepository, passwordService, auditService, clock = () => new Date() }) {
    this.#users = userRepository;
    this.#passwords = passwordService;
    this.#audit = auditService;
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
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {string} role
   * @param {object} [context]
   */
  async changeRole(actor, id, role, context = {}) {
    const target = await this.#findOrFail(id);
    if (isSelf(actor, target)) {
      throw HttpError.forbidden('No puedes cambiar tu propio rol', 'SELF_MODIFICATION_FORBIDDEN');
    }
    if (!canAssignRole(actor.role, role)) {
      throw HttpError.forbidden('No puedes asignar ese rol', 'ROLE_NOT_ASSIGNABLE');
    }
    this.#assertCanManage(actor, target);
    if (target.role === role) return target;

    if (target.role === ROLES.SUPERUSER) await this.#assertNotLastSuperuser(target);

    const updated = await this.#users.updateRole(target._id, role, this.#now());
    await this.#audit.record({
      action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
      entity: ENTITY,
      entityId: id,
      actor,
      metadata: { from: target.role, to: role },
      context,
    });
    return updated;
  }

  /**
   * Activa o desactiva una cuenta (borrado logico). Desactivar revoca sus sesiones.
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {boolean} isActive
   * @param {object} [context]
   */
  async changeStatus(actor, id, isActive, context = {}) {
    const target = await this.#findOrFail(id);
    if (isSelf(actor, target)) {
      throw HttpError.forbidden('No puedes cambiar el estado de tu propia cuenta', 'SELF_MODIFICATION_FORBIDDEN');
    }
    this.#assertCanManage(actor, target);
    if (target.isActive === isActive) return target;

    if (!isActive && target.role === ROLES.SUPERUSER) await this.#assertNotLastSuperuser(target);

    const updated = await this.#users.updateStatus(target._id, isActive, this.#now());
    await this.#audit.record({
      action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
      entity: ENTITY,
      entityId: id,
      actor,
      metadata: { isActive },
      context,
    });
    return updated;
  }

  /**
   * Borrado fisico (solo superusuario). Guarda en auditoria una instantanea minima del usuario.
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {object} [context]
   */
  async deleteUser(actor, id, context = {}) {
    if (!hasPermission(actor.role, PERMISSIONS.USERS_DELETE)) {
      throw HttpError.forbidden('El borrado fisico esta reservado al superusuario', 'HARD_DELETE_FORBIDDEN');
    }
    const target = await this.#findOrFail(id);
    if (isSelf(actor, target)) {
      throw HttpError.forbidden('No puedes eliminar tu propia cuenta', 'SELF_MODIFICATION_FORBIDDEN');
    }
    if (target.role === ROLES.SUPERUSER) await this.#assertNotLastSuperuser(target);

    await this.#users.deleteById(target._id);
    await this.#audit.record({
      action: AUDIT_ACTIONS.USER_DELETED,
      entity: ENTITY,
      entityId: id,
      actor,
      metadata: { email: target.email, role: target.role },
      context,
    });
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

  /**
   * Impide dejar el sistema sin superusuarios activos.
   * @param {{ isActive: boolean }} target
   */
  async #assertNotLastSuperuser(target) {
    if (!target.isActive) return;
    const activeSuperusers = await this.#users.countActiveByRole(ROLES.SUPERUSER);
    if (activeSuperusers <= 1) {
      throw HttpError.conflict('Debe existir al menos un superusuario activo', 'LAST_SUPERUSER');
    }
  }
}
