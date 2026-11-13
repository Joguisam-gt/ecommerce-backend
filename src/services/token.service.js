/**
 * Servicio de tokens JWT (acceso y refresco).
 *
 * Medidas de seguridad:
 * - Algoritmo fijado (HS256) al firmar y al verificar: impide ataques "alg: none"
 *   o de confusion de algoritmo.
 * - Secretos distintos para acceso y refresco, y campo "type" en el payload:
 *   un token de refresco nunca sirve como token de acceso y viceversa.
 * - issuer y audience verificados.
 * - "tv" (tokenVersion) permite revocar todas las sesiones de un usuario
 *   incrementando un contador en base de datos.
 * El rol NO se toma del token para autorizar: authenticate lo lee de la base de datos.
 */
import jwt from 'jsonwebtoken';
import { HttpError } from '../utils/http-error.js';

const ALGORITHM = 'HS256';

export const TOKEN_TYPES = Object.freeze({ ACCESS: 'access', REFRESH: 'refresh' });

export class TokenService {
  #config;

  /**
   * @param {{ accessSecret: string, refreshSecret: string, accessTtlSeconds: number,
   *           refreshTtlSeconds: number, issuer: string, audience: string }} jwtConfig
   */
  constructor(jwtConfig) {
    this.#config = jwtConfig;
  }

  /**
   * Firma un token del tipo indicado.
   * @param {{ _id: { toString(): string }, role: string, tokenVersion: number }} user
   * @param {string} type
   */
  #sign(user, type) {
    const isAccess = type === TOKEN_TYPES.ACCESS;
    return jwt.sign({ role: user.role, tv: user.tokenVersion, type }, isAccess ? this.#config.accessSecret : this.#config.refreshSecret, {
      algorithm: ALGORITHM,
      expiresIn: isAccess ? this.#config.accessTtlSeconds : this.#config.refreshTtlSeconds,
      issuer: this.#config.issuer,
      audience: this.#config.audience,
      subject: user._id.toString(),
    });
  }

  /**
   * Verifica firma, expiracion, emisor, audiencia y tipo.
   * @param {string} token
   * @param {string} type
   * @returns {{ sub: string, role: string, tv: number, type: string }}
   * @throws {HttpError} 401 con codigo TOKEN_EXPIRED o INVALID_TOKEN.
   */
  #verify(token, type) {
    const secret = type === TOKEN_TYPES.ACCESS ? this.#config.accessSecret : this.#config.refreshSecret;
    let payload;
    try {
      payload = jwt.verify(token, secret, {
        algorithms: [ALGORITHM],
        issuer: this.#config.issuer,
        audience: this.#config.audience,
      });
    } catch (error) {
      if (error?.name === 'TokenExpiredError') {
        throw HttpError.unauthorized('La sesion ha expirado', 'TOKEN_EXPIRED');
      }
      throw HttpError.unauthorized('Token invalido', 'INVALID_TOKEN');
    }
    if (payload.type !== type || typeof payload.sub !== 'string' || !Number.isInteger(payload.tv)) {
      throw HttpError.unauthorized('Token invalido', 'INVALID_TOKEN');
    }
    return payload;
  }

  /** @param {object} user */
  signAccessToken(user) {
    return this.#sign(user, TOKEN_TYPES.ACCESS);
  }

  /** @param {object} user */
  signRefreshToken(user) {
    return this.#sign(user, TOKEN_TYPES.REFRESH);
  }

  /**
   * Emite el par de tokens de una sesion.
   * @param {object} user
   * @returns {{ accessToken: string, refreshToken: string, expiresIn: number }}
   */
  issueTokenPair(user) {
    return {
      accessToken: this.signAccessToken(user),
      refreshToken: this.signRefreshToken(user),
      expiresIn: this.#config.accessTtlSeconds,
    };
  }

  /** @param {string} token */
  verifyAccessToken(token) {
    return this.#verify(token, TOKEN_TYPES.ACCESS);
  }

  /** @param {string} token */
  verifyRefreshToken(token) {
    return this.#verify(token, TOKEN_TYPES.REFRESH);
  }
}
