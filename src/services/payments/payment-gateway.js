/**
 * Pasarelas de pago con tarjeta (patron Strategy).
 *
 * Contrato comun (PaymentGateway):
 *   charge({ amountCents, currency, paymentToken, cardBrand, last4, idempotencyKey, description })
 *     -> { approved, transactionId, authorizationCode, declineCode?, declineMessage? }
 *   voidCharge({ transactionId, reason }) -> { voided }
 *
 * PCI-DSS: el backend nunca recibe el numero de tarjeta ni el CVV; solo un
 * token emitido por la pasarela en el cliente. Ese token se envia a la
 * pasarela y no se guarda ni se escribe en logs.
 *
 * Implementaciones:
 * - SimulatedPaymentGateway: determinista, en proceso (desarrollo y pruebas).
 * - HttpPaymentGateway: cliente HTTP con fetch nativo hacia una pasarela real.
 * createPaymentGateway elige una u otra segun la configuracion.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { HttpError } from '../../utils/http-error.js';

/**
 * @typedef {object} ChargeRequest
 * @property {number} amountCents     Importe en centavos.
 * @property {string} currency        Codigo ISO 4217 (GTQ).
 * @property {string} paymentToken    Token de la pasarela (nunca el PAN).
 * @property {string} cardBrand
 * @property {string} last4
 * @property {string} idempotencyKey  Evita cobros duplicados ante reintentos.
 * @property {string} [description]
 */

/**
 * @typedef {object} ChargeResult
 * @property {boolean} approved
 * @property {string | null} transactionId
 * @property {string | null} authorizationCode
 * @property {string} [declineCode]
 * @property {string} [declineMessage]
 */

/** Error estandar de pasarela no disponible (502). */
const gatewayError = () => HttpError.badGateway('La pasarela de pago no respondio', 'PAYMENT_GATEWAY_ERROR');

/** Contrato abstracto: las implementaciones deben sobrescribir ambos metodos. */
export class PaymentGateway {
  /**
   * Cobra un importe con un token de tarjeta.
   * @param {ChargeRequest} _request
   * @returns {Promise<ChargeResult>}
   */
  async charge(_request) {
    throw new Error('PaymentGateway.charge no implementado');
  }

  /**
   * Anula (void) un cargo aprobado que no llego a confirmarse en un pedido.
   * @param {{ transactionId: string, reason: string }} _request
   * @returns {Promise<{ voided: boolean }>}
   */
  async voidCharge(_request) {
    throw new Error('PaymentGateway.voidCharge no implementado');
  }
}

/** Respuestas deterministas segun el prefijo del token. */
const SIMULATED_DECLINES = Object.freeze([
  { prefix: 'tok_decline', declineCode: 'card_declined', declineMessage: 'La tarjeta fue rechazada' },
  { prefix: 'tok_insufficient', declineCode: 'insufficient_funds', declineMessage: 'Fondos insuficientes' },
]);

export class SimulatedPaymentGateway extends PaymentGateway {
  /** @type {string[]} transactionId de cada cargo anulado (para afirmarlo en pruebas). */
  voided = [];

  /** @type {Array<{ transactionId: string, amountCents: number, currency: string, idempotencyKey: string }>} Cargos aprobados nuevos (sin token). */
  charges = [];

  /** @type {Map<string, ChargeResult>} Resultado por clave de idempotencia (como haria una pasarela real). */
  #byIdempotencyKey = new Map();

  /**
   * Comportamiento por token:
   * - 'tok_decline...'     -> rechazado (card_declined)
   * - 'tok_insufficient...' -> rechazado (insufficient_funds)
   * - 'tok_error...'       -> lanza un error de red simulado
   * - cualquier otro       -> aprobado
   * Una clave de idempotencia repetida devuelve el mismo resultado sin cobrar de nuevo.
   * @param {ChargeRequest} request
   * @returns {Promise<ChargeResult>}
   */
  async charge({ amountCents, currency, paymentToken, idempotencyKey }) {
    if (paymentToken.startsWith('tok_error')) {
      throw new Error('Error de red simulado de la pasarela de pago');
    }
    if (idempotencyKey && this.#byIdempotencyKey.has(idempotencyKey)) {
      return { ...this.#byIdempotencyKey.get(idempotencyKey) };
    }

    const decline = SIMULATED_DECLINES.find(({ prefix }) => paymentToken.startsWith(prefix));
    const result = decline
      ? {
          approved: false,
          transactionId: null,
          authorizationCode: null,
          declineCode: decline.declineCode,
          declineMessage: decline.declineMessage,
        }
      : {
          approved: true,
          transactionId: `sim_${randomUUID()}`,
          authorizationCode: randomBytes(3).toString('hex').toUpperCase(),
        };

    if (result.approved) this.charges.push({ transactionId: result.transactionId, amountCents, currency, idempotencyKey });
    if (idempotencyKey) this.#byIdempotencyKey.set(idempotencyKey, result);
    return { ...result };
  }

  /**
   * Anula un cargo previo aprobado por esta pasarela.
   * @param {{ transactionId: string, reason: string }} request
   */
  async voidCharge({ transactionId }) {
    const known = this.charges.some((charge) => charge.transactionId === transactionId);
    if (!known) return { voided: false };
    if (!this.voided.includes(transactionId)) this.voided.push(transactionId);
    return { voided: true };
  }
}

export class HttpPaymentGateway extends PaymentGateway {
  #url;
  #apiKey;
  #timeoutMs;
  #fetch;

  /**
   * @param {{ url: string, apiKey: string, timeoutMs?: number, fetchImpl?: typeof fetch }} options
   */
  constructor({ url, apiKey, timeoutMs = 8000, fetchImpl = globalThis.fetch }) {
    super();
    if (!url) throw new Error('HttpPaymentGateway requiere la URL de la pasarela');
    this.#url = url.replace(/\/+$/, '');
    this.#apiKey = apiKey;
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;
  }

  /**
   * POST /charges. Respuesta esperada: { approved, transactionId, authorizationCode, declineCode?, declineMessage? }.
   * @param {ChargeRequest} request
   * @returns {Promise<ChargeResult>}
   */
  async charge({ amountCents, currency, paymentToken, cardBrand, last4, idempotencyKey, description }) {
    const body = await this.#post(
      '/charges',
      { amountCents, currency, paymentToken, cardBrand, last4, description },
      idempotencyKey,
    );
    if (typeof body?.approved !== 'boolean') throw gatewayError();
    if (body.approved && (typeof body.transactionId !== 'string' || typeof body.authorizationCode !== 'string')) {
      throw gatewayError();
    }
    return {
      approved: body.approved,
      transactionId: body.transactionId ?? null,
      authorizationCode: body.authorizationCode ?? null,
      ...(body.approved ? {} : { declineCode: String(body.declineCode ?? 'card_declined'), declineMessage: body.declineMessage }),
    };
  }

  /**
   * POST /charges/{id}/void. Respuesta esperada: { voided: boolean }.
   * @param {{ transactionId: string, reason: string }} request
   */
  async voidCharge({ transactionId, reason }) {
    const body = await this.#post(`/charges/${encodeURIComponent(transactionId)}/void`, { reason }, `void-${transactionId}`);
    return { voided: body?.voided === true };
  }

  /**
   * Envia un POST JSON autenticado con limite de tiempo. Cualquier fallo de red,
   * timeout, respuesta no 2xx o JSON invalido se traduce en un 502 generico:
   * nunca se propaga el cuerpo ni se registra el payload (contiene el token).
   * @param {string} path
   * @param {object} payload
   * @param {string} idempotencyKey
   */
  async #post(path, payload, idempotencyKey) {
    let response;
    try {
      response = await this.#fetch(`${this.#url}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${this.#apiKey}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw gatewayError();
    }
    if (!response.ok) throw gatewayError();
    try {
      return await response.json();
    } catch {
      throw gatewayError();
    }
  }
}

/**
 * Fabrica: pasarela HTTP si hay URL configurada; si no, la simulada.
 * @param {{ gatewayUrl?: string, gatewayApiKey?: string, gatewayTimeoutMs?: number }} paymentsConfig Bloque payments de env.js.
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {PaymentGateway}
 */
export function createPaymentGateway(paymentsConfig, { fetchImpl } = {}) {
  if (!paymentsConfig?.gatewayUrl) return new SimulatedPaymentGateway();
  if (!paymentsConfig.gatewayApiKey) {
    throw new Error('PAYMENT_GATEWAY_API_KEY es obligatorio cuando se define PAYMENT_GATEWAY_URL');
  }
  return new HttpPaymentGateway({
    url: paymentsConfig.gatewayUrl,
    apiKey: paymentsConfig.gatewayApiKey,
    timeoutMs: paymentsConfig.gatewayTimeoutMs,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
