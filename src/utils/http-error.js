/**
 * Error de dominio con semantica HTTP.
 *
 * Los servicios lanzan HttpError con un codigo de estado, un codigo de error
 * estable (para el frontend) y detalles opcionales. El middleware de errores
 * lo traduce a una respuesta JSON uniforme.
 */
export class HttpError extends Error {
  /**
   * @param {number} status Codigo de estado HTTP.
   * @param {string} message Mensaje legible.
   * @param {string} [code] Codigo estable para el cliente.
   * @param {unknown} [details] Informacion adicional (por ejemplo, errores de validacion).
   */
  constructor(status, message, code = 'ERROR', details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    /** @type {object | undefined} Cuerpo de respuesta fijado por contrato (sustituye al formato estandar). */
    this.body = undefined;
  }

  /**
   * 409 por stock insuficiente. Su cuerpo es un contrato publico de la Fase 2:
   * { error: "INSUFFICIENT_STOCK", availableStock, productId, message }.
   * @param {number} availableStock Unidades disponibles en este momento.
   * @param {string} [productId]
   */
  static insufficientStock(availableStock, productId = undefined) {
    const error = new HttpError(409, 'No hay stock suficiente para la cantidad solicitada', 'INSUFFICIENT_STOCK', {
      availableStock,
      productId,
    });
    error.body = {
      error: 'INSUFFICIENT_STOCK',
      availableStock,
      ...(productId ? { productId } : {}),
      message: error.message,
    };
    return error;
  }

  /** 402: el pago fue rechazado por la pasarela. */
  static paymentRequired(message = 'El pago fue rechazado', code = 'PAYMENT_DECLINED') {
    return new HttpError(402, message, code);
  }

  /** 422: datos validos en forma pero que incumplen una regla de negocio. */
  static unprocessable(message = 'No se puede procesar la solicitud', code = 'UNPROCESSABLE', details = undefined) {
    return new HttpError(422, message, code, details);
  }

  /** 502: fallo de un servicio externo (pasarela de pago). */
  static badGateway(message = 'Fallo de un servicio externo', code = 'BAD_GATEWAY') {
    return new HttpError(502, message, code);
  }

  /** 400: datos de entrada invalidos. */
  static badRequest(message = 'Solicitud invalida', code = 'BAD_REQUEST', details = undefined) {
    return new HttpError(400, message, code, details);
  }

  /** 401: falta autenticacion o es invalida. */
  static unauthorized(message = 'Autenticacion requerida', code = 'UNAUTHORIZED') {
    return new HttpError(401, message, code);
  }

  /** 403: autenticado pero sin permiso. */
  static forbidden(message = 'No tienes permisos para esta operacion', code = 'FORBIDDEN') {
    return new HttpError(403, message, code);
  }

  /** 404: recurso inexistente. */
  static notFound(message = 'Recurso no encontrado', code = 'NOT_FOUND') {
    return new HttpError(404, message, code);
  }

  /** 409: conflicto con el estado actual (duplicados, reglas de negocio). */
  static conflict(message = 'Conflicto con el estado actual', code = 'CONFLICT') {
    return new HttpError(409, message, code);
  }

  /** 423: recurso bloqueado (cuenta bloqueada por intentos fallidos). */
  static locked(message = 'Recurso bloqueado', code = 'LOCKED') {
    return new HttpError(423, message, code);
  }
}
