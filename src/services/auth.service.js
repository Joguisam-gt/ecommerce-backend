/**
 * Servicio de autenticacion: registro, login, refresco, logout y cambio de contrasena.
 *
 * Depende de abstracciones inyectadas (repositorio, hash, tokens, auditoria y
 * reloj), no de Express ni del driver; por eso se prueba con dobles en memoria.
 *
 * Protecciones implementadas:
 * - Mensaje unico "Credenciales invalidas" y comparacion ficticia cuando el
 *   correo no existe (dificulta la enumeracion de cuentas).
 * - Bloqueo temporal tras N intentos fallidos consecutivos.
 * - Revocacion de sesiones mediante tokenVersion (logout, cambio de contrasena).
 */
import { ROLES } from '../constants/roles.js';
import { HttpError } from '../utils/http-error.js';
import { toObjectId } from '../utils/object-id.js';
import { AUDIT_ACTIONS } from './audit.service.js';
import { buildUserDocument } from './user-document.factory.js';

const ENTITY = 'user';

/** Error generico de credenciales: identico para correo inexistente y contrasena erronea. */
const invalidCredentials = () => HttpError.unauthorized('Credenciales invalidas', 'INVALID_CREDENTIALS');

export class AuthService {
  #users;
  #passwords;
  #tokens;
  #audit;
  #security;
  #now;

  /**
   * @param {{ userRepository: object, passwordService: object, tokenService: object, auditService: object,
   *           securityConfig: { maxLoginAttempts: number, lockTimeMs: number }, clock?: () => Date }} deps
   */
  constructor({ userRepository, passwordService, tokenService, auditService, securityConfig, clock = () => new Date() }) {
    this.#users = userRepository;
    this.#passwords = passwordService;
    this.#tokens = tokenService;
    this.#audit = auditService;
    this.#security = securityConfig;
    this.#now = clock;
  }

  /**
   * Registro publico. El rol se fuerza a "user": nunca se toma del cliente.
   * @param {import('../dtos/auth.dto.js').RegisterUserDTO} dto
   * @param {{ ip?: string, userAgent?: string }} [context]
   */
  async register(dto, context = {}) {
    if (await this.#users.findByEmail(dto.email)) {
      throw HttpError.conflict('El correo ya esta registrado', 'EMAIL_IN_USE');
    }

    const passwordHash = await this.#passwords.hash(dto.password);
    const user = await this.#users.create(
      buildUserDocument({ ...dto, passwordHash, role: ROLES.USER }, this.#now()),
    );

    await this.#audit.record({
      action: AUDIT_ACTIONS.AUTH_REGISTER,
      entity: ENTITY,
      entityId: user._id.toString(),
      actor: { id: user._id.toString(), role: user.role },
      context,
    });

    return { user, ...this.#tokens.issueTokenPair(user) };
  }

  /**
   * Inicio de sesion.
   * @param {import('../dtos/auth.dto.js').LoginDTO} dto
   * @param {{ ip?: string, userAgent?: string }} [context]
   */
  async login({ email, password }, context = {}) {
    const user = await this.#users.findByEmail(email);

    if (!user) {
      await this.#passwords.compareWithDummy(password);
      await this.#recordFailure(null, 'unknown_email', context, { email });
      throw invalidCredentials();
    }

    const now = this.#now();
    if (user.lockUntil && user.lockUntil > now) {
      await this.#recordFailure(user, 'account_locked', context);
      throw HttpError.locked('Cuenta bloqueada temporalmente por intentos fallidos', 'ACCOUNT_LOCKED');
    }

    const isValid = await this.#passwords.compare(password, user.passwordHash);
    if (!isValid) {
      await this.#registerFailedAttempt(user, now, context);
      throw invalidCredentials();
    }

    // Se comprueba despues de la contrasena para no revelar el estado de la cuenta a quien no la conoce.
    if (!user.isActive) {
      await this.#recordFailure(user, 'account_disabled', context);
      throw HttpError.forbidden('La cuenta esta desactivada', 'ACCOUNT_DISABLED');
    }

    const updated = await this.#users.recordSuccessfulLogin(user._id, now);
    await this.#audit.record({
      action: AUDIT_ACTIONS.AUTH_LOGIN,
      entity: ENTITY,
      entityId: user._id.toString(),
      actor: { id: user._id.toString(), role: user.role },
      context,
    });

    return { user: updated, ...this.#tokens.issueTokenPair(updated) };
  }

  /**
   * Emite un par de tokens nuevo a partir de un refresh token valido y no revocado.
   * @param {string | undefined} refreshToken
   */
  async refresh(refreshToken) {
    if (!refreshToken) {
      throw HttpError.unauthorized('No hay una sesion activa', 'MISSING_REFRESH_TOKEN');
    }
    const payload = this.#tokens.verifyRefreshToken(refreshToken);
    const user = await this.#users.findById(toObjectId(payload.sub));

    if (!user || !user.isActive || user.tokenVersion !== payload.tv) {
      throw HttpError.unauthorized('La sesion ha sido revocada', 'SESSION_REVOKED');
    }
    return { user, ...this.#tokens.issueTokenPair(user) };
  }

  /**
   * Cierra todas las sesiones del usuario incrementando tokenVersion.
   * @param {{ id: string, role: string }} actor
   * @param {{ ip?: string, userAgent?: string }} [context]
   */
  async logout(actor, context = {}) {
    await this.#users.incrementTokenVersion(toObjectId(actor.id));
    await this.#audit.record({
      action: AUDIT_ACTIONS.AUTH_LOGOUT,
      entity: ENTITY,
      entityId: actor.id,
      actor,
      context,
    });
  }

  /**
   * Cambia la contrasena verificando la actual. Revoca las demas sesiones y
   * devuelve tokens nuevos para la sesion en curso.
   * @param {{ id: string, role: string }} actor
   * @param {import('../dtos/auth.dto.js').ChangePasswordDTO} dto
   * @param {{ ip?: string, userAgent?: string }} [context]
   */
  async changePassword(actor, { currentPassword, newPassword }, context = {}) {
    const user = await this.#users.findById(toObjectId(actor.id));
    if (!user) throw HttpError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');

    if (!(await this.#passwords.compare(currentPassword, user.passwordHash))) {
      throw HttpError.badRequest('La contrasena actual no es correcta', 'INVALID_CURRENT_PASSWORD');
    }

    const passwordHash = await this.#passwords.hash(newPassword);
    const updated = await this.#users.updatePassword(user._id, passwordHash, this.#now());

    await this.#audit.record({
      action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED,
      entity: ENTITY,
      entityId: actor.id,
      actor,
      context,
    });

    return { user: updated, ...this.#tokens.issueTokenPair(updated) };
  }

  /**
   * Suma un intento fallido y bloquea la cuenta al alcanzar el maximo.
   * @param {object} user
   * @param {Date} now
   * @param {object} context
   */
  async #registerFailedAttempt(user, now, context) {
    const updated = await this.#users.incrementFailedLogins(user._id);
    const attempts = updated?.failedLoginAttempts ?? user.failedLoginAttempts + 1;

    if (attempts >= this.#security.maxLoginAttempts) {
      const lockUntil = new Date(now.getTime() + this.#security.lockTimeMs);
      await this.#users.lockAccount(user._id, lockUntil);
      await this.#audit.record({
        action: AUDIT_ACTIONS.AUTH_ACCOUNT_LOCKED,
        entity: ENTITY,
        entityId: user._id.toString(),
        outcome: 'failure',
        metadata: { lockUntil, attempts },
        context,
      });
    }
    await this.#recordFailure(user, 'invalid_password', context, { attempts });
  }

  /**
   * Registra un login fallido en auditoria.
   * @param {object | null} user
   * @param {string} reason
   * @param {object} context
   * @param {object} [extra]
   */
  #recordFailure(user, reason, context, extra = {}) {
    return this.#audit.record({
      action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
      entity: ENTITY,
      entityId: user ? user._id.toString() : null,
      outcome: 'failure',
      metadata: { reason, ...extra },
      context,
    });
  }
}
