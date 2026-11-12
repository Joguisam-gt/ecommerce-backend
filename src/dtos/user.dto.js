/**
 * DTOs de usuarios: entrada (alta, actualizacion, consulta) y salida (respuesta).
 *
 * UserResponseDTO es la unica forma en que un usuario sale de la API: construye
 * la respuesta campo a campo (lista blanca), de modo que passwordHash,
 * tokenVersion o datos de bloqueo nunca se filtran aunque se anadan campos nuevos.
 */
import { compact, normalizeEmail, normalizePhone, normalizeText } from './normalizers.js';
import { permissionsOf } from '../constants/permissions.js';

export class UserResponseDTO {
  /**
   * @param {object | null} user Documento de MongoDB.
   * @returns {object | null}
   */
  static from(user) {
    if (!user) return null;
    return {
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone ?? null,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * Variante para el propio usuario autenticado: incluye sus permisos efectivos
   * para que el frontend adapte la interfaz (la autorizacion real sigue en el servidor).
   * @param {object | null} user
   */
  static withPermissions(user) {
    const dto = UserResponseDTO.from(user);
    return dto ? { ...dto, permissions: permissionsOf(user.role) } : null;
  }

  /** @param {object[]} users */
  static fromMany(users) {
    return users.map((user) => UserResponseDTO.from(user));
  }
}

export class CreateUserDTO {
  /** @param {{ email: string, password: string, firstName: string, lastName: string, phone?: string | null, role: string }} body */
  constructor(body) {
    this.email = normalizeEmail(body.email);
    this.password = body.password;
    this.firstName = normalizeText(body.firstName);
    this.lastName = normalizeText(body.lastName);
    this.phone = normalizePhone(body.phone) ?? null;
    this.role = body.role;
    Object.freeze(this);
  }

  /** @param {object} body */
  static from(body) {
    return new CreateUserDTO(body);
  }
}

/** Actualizacion del propio perfil: sin correo, rol ni estado. */
export class UpdateProfileDTO {
  /** @param {object} body */
  static from(body) {
    return Object.freeze(
      compact({
        firstName: body.firstName === undefined ? undefined : normalizeText(body.firstName),
        lastName: body.lastName === undefined ? undefined : normalizeText(body.lastName),
        phone: normalizePhone(body.phone),
      }),
    );
  }
}

/** Actualizacion administrativa de datos basicos: sin rol ni estado. */
export class UpdateUserDTO {
  /** @param {object} body */
  static from(body) {
    return Object.freeze(
      compact({
        email: body.email === undefined ? undefined : normalizeEmail(body.email),
        firstName: body.firstName === undefined ? undefined : normalizeText(body.firstName),
        lastName: body.lastName === undefined ? undefined : normalizeText(body.lastName),
        phone: normalizePhone(body.phone),
      }),
    );
  }
}

/** Parametros de listado con valores por defecto y conversion de tipos de query string. */
export class ListUsersQueryDTO {
  /** @param {Record<string, string>} query */
  static from(query) {
    return Object.freeze({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      role: query.role,
      isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
      search: query.search?.trim() || undefined,
    });
  }
}
