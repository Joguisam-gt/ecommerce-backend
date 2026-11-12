/**
 * Gestion de las cookies de sesion.
 *
 * - access_token: httpOnly, enviada a toda la API, vida corta.
 * - refresh_token: httpOnly, limitada a la ruta /api/v1/auth para reducir su exposicion.
 * Ambas usan SameSite (strict por defecto) como defensa principal contra CSRF.
 */

export const COOKIE_NAMES = Object.freeze({
  ACCESS: 'access_token',
  REFRESH: 'refresh_token',
});

/** Ruta a la que se restringe la cookie de refresco. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export class AuthCookieManager {
  #cookieConfig;
  #jwtConfig;

  /**
   * @param {{ cookieConfig: { secure: boolean, sameSite: string, domain?: string }, jwtConfig: { accessTtlSeconds: number, refreshTtlSeconds: number } }} deps
   */
  constructor({ cookieConfig, jwtConfig }) {
    this.#cookieConfig = cookieConfig;
    this.#jwtConfig = jwtConfig;
  }

  /**
   * Opciones base compartidas por ambas cookies.
   * @param {string} path
   */
  #baseOptions(path) {
    return {
      httpOnly: true,
      secure: this.#cookieConfig.secure,
      sameSite: this.#cookieConfig.sameSite,
      domain: this.#cookieConfig.domain,
      path,
    };
  }

  /**
   * Escribe las cookies de acceso y refresco en la respuesta.
   * @param {import('express').Response} res
   * @param {{ accessToken: string, refreshToken: string }} tokens
   */
  setAuthCookies(res, { accessToken, refreshToken }) {
    res.cookie(COOKIE_NAMES.ACCESS, accessToken, {
      ...this.#baseOptions('/'),
      maxAge: this.#jwtConfig.accessTtlSeconds * 1000,
    });
    res.cookie(COOKIE_NAMES.REFRESH, refreshToken, {
      ...this.#baseOptions(REFRESH_COOKIE_PATH),
      maxAge: this.#jwtConfig.refreshTtlSeconds * 1000,
    });
  }

  /**
   * Elimina ambas cookies (logout). Las opciones deben coincidir con las de creacion.
   * @param {import('express').Response} res
   */
  clearAuthCookies(res) {
    res.clearCookie(COOKIE_NAMES.ACCESS, this.#baseOptions('/'));
    res.clearCookie(COOKIE_NAMES.REFRESH, this.#baseOptions(REFRESH_COOKIE_PATH));
  }
}
