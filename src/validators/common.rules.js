/**
 * Reglas de validacion reutilizables entre validadores.
 *
 * Cada funcion devuelve una regla nueva para poder ajustar "required" segun
 * el caso (alta frente a actualizacion parcial).
 */

/** Expresion regular de correo coherente con el $jsonSchema de users. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Telefono internacional: digitos, espacios, guiones y prefijo +. */
export const PHONE_PATTERN = /^\+?[0-9\s-]{7,20}$/;

/** Nombres propios: letras (incluidas tildes), espacios, apostrofes y guiones. */
export const NAME_PATTERN = /^[\p{L}][\p{L}\s'.-]*$/u;

/** bcrypt solo procesa los primeros 72 bytes; mas alla se ignoraria en silencio. */
export const PASSWORD_MAX_BYTES = 72;

/**
 * Politica de contrasenas: 8 a 72 bytes, al menos una minuscula, una mayuscula y un digito.
 * @param {string} value
 * @returns {string | null}
 */
export function passwordPolicy(value) {
  if (value.length < 8) return 'Debe tener al menos 8 caracteres';
  if (Buffer.byteLength(value, 'utf8') > PASSWORD_MAX_BYTES) return `No puede superar ${PASSWORD_MAX_BYTES} bytes`;
  if (!/[a-z]/.test(value)) return 'Debe incluir al menos una letra minuscula';
  if (!/[A-Z]/.test(value)) return 'Debe incluir al menos una letra mayuscula';
  if (!/\d/.test(value)) return 'Debe incluir al menos un numero';
  return null;
}

/** @param {boolean} [required=true] */
export const emailRule = (required = true) => ({
  type: 'string',
  required,
  maxLength: 254,
  pattern: EMAIL_PATTERN,
  patternMessage: 'Correo electronico invalido',
});

/** @param {boolean} [required=true] */
export const passwordRule = (required = true) => ({
  type: 'string',
  required,
  trim: false,
  custom: passwordPolicy,
});

/** @param {boolean} [required=true] */
export const nameRule = (required = true) => ({
  type: 'string',
  required,
  minLength: 1,
  maxLength: 80,
  pattern: NAME_PATTERN,
  patternMessage: 'Solo se permiten letras, espacios, apostrofes y guiones',
});

/** Telefono opcional; null lo elimina. */
export const phoneRule = () => ({
  type: 'string',
  nullable: true,
  pattern: PHONE_PATTERN,
  patternMessage: 'Telefono invalido',
});

/** Parametros de paginacion en query string. */
export const paginationFields = () => ({
  page: { type: 'integer', fromString: true, min: 1, max: 100000 },
  limit: { type: 'integer', fromString: true, min: 1, max: 100 },
});

/** Esquema del parametro de ruta :id. */
export const idParamSchema = Object.freeze({
  fields: { id: { type: 'objectId', required: true } },
});
