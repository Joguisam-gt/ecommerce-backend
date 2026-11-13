/**
 * Extrae del request la informacion de contexto que se registra en auditoria.
 *
 * Mantiene a los servicios independientes de Express: reciben un objeto plano.
 * La IP depende del ajuste "trust proxy" configurado en app.js.
 */

/**
 * @param {import('express').Request} req
 * @returns {{ ip: string | null, userAgent: string | null }}
 */
export function requestContext(req) {
  const userAgent = req.get?.('user-agent') ?? null;
  return {
    ip: req.ip ?? null,
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
  };
}
