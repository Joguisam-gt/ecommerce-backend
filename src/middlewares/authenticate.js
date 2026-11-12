/**
 * Middleware de autenticacion.
 *
 * Obtiene el access token de la cookie httpOnly (navegador) o de la cabecera
 * Authorization: Bearer (POS, apps moviles, integraciones). Tras verificar la
 * firma consulta al usuario en base de datos para:
 * - rechazar cuentas desactivadas o borradas al instante,
 * - rechazar tokens revocados (tokenVersion distinto),
 * - usar el rol ACTUAL de la base de datos, no el del token.
 * El coste es una lectura por _id (indice primario) por peticion.
 */
import { COOKIE_NAMES } from '../utils/auth-cookies.js';
import { HttpError } from '../utils/http-error.js';
import { toObjectId } from '../utils/object-id.js';

/**
 * Extrae el token de la cookie o de la cabecera Authorization.
 * @param {import('express').Request} req
 * @returns {string | null}
 */
export function extractAccessToken(req) {
  const fromCookie = req.cookies?.[COOKIE_NAMES.ACCESS];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;

  const header = req.get?.('authorization') ?? req.headers?.authorization;
  if (typeof header === 'string') {
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token) return token;
  }
  return null;
}

/**
 * Crea el middleware con sus dependencias inyectadas.
 * @param {{ tokenService: import('../services/token.service.js').TokenService, userRepository: object }} deps
 * @returns {import('express').RequestHandler}
 */
export function createAuthenticate({ tokenService, userRepository }) {
  return async function authenticate(req, _res, next) {
    const token = extractAccessToken(req);
    if (!token) throw HttpError.unauthorized('Autenticacion requerida', 'AUTH_REQUIRED');

    const payload = tokenService.verifyAccessToken(token);
    const user = await userRepository.findById(toObjectId(payload.sub));

    if (!user || !user.isActive || user.tokenVersion !== payload.tv) {
      throw HttpError.unauthorized('La sesion ha sido revocada', 'SESSION_REVOKED');
    }

    req.user = Object.freeze({ id: user._id.toString(), role: user.role, email: user.email });
    next();
  };
}
