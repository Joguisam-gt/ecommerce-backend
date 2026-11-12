/**
 * Controlador de autenticacion.
 *
 * Responsabilidad unica: traducir HTTP <-> servicio. Construye DTOs desde el
 * request ya validado, llama al servicio, gestiona cookies y da forma a la
 * respuesta. No contiene reglas de negocio.
 * Los metodos son funciones flecha para poder pasarlos directamente a Express.
 */
import { ChangePasswordDTO, LoginDTO, RegisterUserDTO } from '../dtos/auth.dto.js';
import { UserResponseDTO } from '../dtos/user.dto.js';
import { COOKIE_NAMES } from '../utils/auth-cookies.js';
import { requestContext } from '../utils/request-context.js';

export class AuthController {
  #auth;
  #cookies;

  /**
   * @param {{ authService: import('../services/auth.service.js').AuthService,
   *           authCookies: import('../utils/auth-cookies.js').AuthCookieManager }} deps
   */
  constructor({ authService, authCookies }) {
    this.#auth = authService;
    this.#cookies = authCookies;
  }

  /**
   * Respuesta comun de sesion: cookies + usuario + access token (para clientes sin cookies).
   * @param {import('express').Response} res
   * @param {number} status
   * @param {{ user: object, accessToken: string, refreshToken: string, expiresIn: number }} session
   */
  #sendSession(res, status, { user, accessToken, refreshToken, expiresIn }) {
    this.#cookies.setAuthCookies(res, { accessToken, refreshToken });
    res.status(status).json({
      data: { user: UserResponseDTO.withPermissions(user), accessToken, expiresIn },
    });
  }

  /** POST /auth/register */
  register = async (req, res) => {
    const session = await this.#auth.register(RegisterUserDTO.from(req.body), requestContext(req));
    this.#sendSession(res, 201, session);
  };

  /** POST /auth/login */
  login = async (req, res) => {
    const session = await this.#auth.login(LoginDTO.from(req.body), requestContext(req));
    this.#sendSession(res, 200, session);
  };

  /** POST /auth/refresh: lee el refresh token solo de la cookie httpOnly. */
  refresh = async (req, res) => {
    const session = await this.#auth.refresh(req.cookies?.[COOKIE_NAMES.REFRESH]);
    this.#sendSession(res, 200, session);
  };

  /** POST /auth/logout: revoca todas las sesiones del usuario y borra cookies. */
  logout = async (req, res) => {
    await this.#auth.logout(req.user, requestContext(req));
    this.#cookies.clearAuthCookies(res);
    res.status(204).end();
  };

  /** PATCH /auth/password */
  changePassword = async (req, res) => {
    const session = await this.#auth.changePassword(req.user, ChangePasswordDTO.from(req.body), requestContext(req));
    this.#sendSession(res, 200, session);
  };
}
