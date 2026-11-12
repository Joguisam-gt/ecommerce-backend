/**
 * Motor de validacion declarativo y sin dependencias.
 *
 * Un esquema describe los campos permitidos y sus reglas. Por defecto se
 * rechazan campos desconocidos: esto evita la asignacion masiva (por ejemplo,
 * enviar "role" en el registro) y la inyeccion de operadores NoSQL, ya que
 * solo pasan tipos primitivos esperados.
 *
 * Forma de un esquema:
 * {
 *   fields: { nombre: { type, required, nullable, minLength, maxLength, pattern,
 *                       values, min, max, fromString, trim, custom } },
 *   minFields?: number,           // minimo de campos presentes (PATCH)
 *   allowUnknown?: boolean,       // aceptar campos no declarados
 *   refine?: (input) => Array<{ field, message }>  // reglas entre campos
 * }
 */

/**
 * Comprueba una cadena.
 * @returns {string | null} Mensaje de error o null.
 */
function checkString(value, rule) {
  if (typeof value !== 'string') return 'Debe ser texto';
  const text = rule.trim === false ? value : value.trim();
  if (rule.minLength !== undefined && text.length < rule.minLength) {
    return `Debe tener al menos ${rule.minLength} caracteres`;
  }
  if (rule.maxLength !== undefined && text.length > rule.maxLength) {
    return `Debe tener como maximo ${rule.maxLength} caracteres`;
  }
  if (rule.pattern && !rule.pattern.test(text)) {
    return rule.patternMessage ?? 'Formato invalido';
  }
  return null;
}

/**
 * Comprueba un booleano; con fromString acepta "true"/"false" (query strings).
 * @returns {string | null}
 */
function checkBoolean(value, rule) {
  if (typeof value === 'boolean') return null;
  if (rule.fromString && (value === 'true' || value === 'false')) return null;
  return 'Debe ser verdadero o falso';
}

/**
 * Comprueba un entero con limites; con fromString acepta cadenas numericas.
 * @returns {string | null}
 */
function checkInteger(value, rule) {
  const numeric = rule.fromString && typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(numeric)) return 'Debe ser un numero entero';
  if (rule.min !== undefined && numeric < rule.min) return `Debe ser mayor o igual a ${rule.min}`;
  if (rule.max !== undefined && numeric > rule.max) return `Debe ser menor o igual a ${rule.max}`;
  return null;
}

/**
 * Comprueba que el valor pertenezca a una lista cerrada.
 * @returns {string | null}
 */
function checkEnum(value, rule) {
  return rule.values.includes(value) ? null : `Debe ser uno de: ${rule.values.join(', ')}`;
}

/**
 * Comprueba un ObjectId en formato hexadecimal.
 * @returns {string | null}
 */
function checkObjectId(value) {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value) ? null : 'Identificador invalido';
}

/** Tabla de despacho tipo -> comprobador (extensible sin modificar validateField). */
const CHECKERS = Object.freeze({
  string: checkString,
  boolean: checkBoolean,
  integer: checkInteger,
  enum: checkEnum,
  objectId: checkObjectId,
});

/**
 * Valida un campo individual.
 * @param {unknown} value
 * @param {object} rule
 * @returns {string | null}
 */
function validateField(value, rule) {
  if (value === undefined) return rule.required ? 'Campo obligatorio' : null;
  if (value === null) {
    if (rule.nullable) return null;
    return rule.required ? 'Campo obligatorio' : 'No puede ser nulo';
  }
  if (rule.required && typeof value === 'string' && value.trim() === '') return 'Campo obligatorio';

  const checker = CHECKERS[rule.type];
  if (!checker) throw new Error(`Tipo de regla desconocido: ${rule.type}`);

  const error = checker(value, rule);
  if (error) return error;
  return rule.custom ? rule.custom(value) : null;
}

/**
 * Valida un objeto completo contra un esquema.
 * @param {{ fields: Record<string, object>, minFields?: number, allowUnknown?: boolean, refine?: Function }} schema
 * @param {unknown} input
 * @returns {Array<{ field: string, message: string }>} Lista de errores (vacia si es valido).
 */
export function validateSchema(schema, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return [{ field: '_root', message: 'Se esperaba un objeto' }];
  }

  const errors = [];

  if (!schema.allowUnknown) {
    for (const key of Object.keys(input)) {
      if (!Object.hasOwn(schema.fields, key)) errors.push({ field: key, message: 'Campo no permitido' });
    }
  }

  for (const [field, rule] of Object.entries(schema.fields)) {
    const message = validateField(input[field], rule);
    if (message) errors.push({ field, message });
  }

  if (schema.minFields) {
    const present = Object.keys(schema.fields).filter((key) => input[key] !== undefined).length;
    if (present < schema.minFields) {
      errors.push({ field: '_root', message: `Debes enviar al menos ${schema.minFields} campo(s) a modificar` });
    }
  }

  if (errors.length === 0 && schema.refine) {
    errors.push(...schema.refine(input));
  }

  return errors;
}
