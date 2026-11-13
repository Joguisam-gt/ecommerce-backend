/**
 * Cabeceras de seguridad basicas para una API JSON.
 *
 * Cubre lo esencial sin anadir dependencias: evita el sniffing de tipos, el
 * enmarcado, la fuga del Referer y el cacheo de respuestas con datos personales.
 * HSTS solo se envia en produccion (requiere HTTPS).
 */

/**
 * @param {{ isProduction: boolean }} options
 * @returns {import('express').RequestHandler}
 */
export function securityHeaders({ isProduction }) {
  return function securityHeadersMiddleware(_req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    if (isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}
