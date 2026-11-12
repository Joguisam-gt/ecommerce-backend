/**
 * Tipos reutilizables para los validadores $jsonSchema.
 *
 * Decision de diseno: los importes monetarios se guardan como enteros en
 * centavos (sufijo "Cents") para evitar errores de redondeo de coma flotante.
 * Se admite 'double' solo porque el driver serializa enteros fuera del rango
 * int32 como double; multipleOf: 1 garantiza que siga siendo un entero.
 */

/** Identificador de MongoDB. */
export const objectId = Object.freeze({ bsonType: 'objectId' });

/** Identificador opcional. */
export const nullableObjectId = Object.freeze({ bsonType: ['objectId', 'null'] });

/** Fecha obligatoria. */
export const date = Object.freeze({ bsonType: 'date' });

/** Fecha opcional. */
export const nullableDate = Object.freeze({ bsonType: ['date', 'null'] });

/** Booleano. */
export const bool = Object.freeze({ bsonType: 'bool' });

/** Entero no negativo (contadores, stock, versiones). */
export const nonNegativeInt = Object.freeze({ bsonType: ['int', 'long'], minimum: 0 });

/** Importe en centavos: entero no negativo. */
export const money = Object.freeze({ bsonType: ['int', 'long', 'double'], minimum: 0, multipleOf: 1 });

/**
 * Cadena con limites de longitud.
 * @param {number} [minLength=1]
 * @param {number} [maxLength=255]
 */
export const string = (minLength = 1, maxLength = 255) => ({ bsonType: 'string', minLength, maxLength });

/**
 * Cadena opcional (admite null).
 * @param {number} [maxLength=255]
 */
export const nullableString = (maxLength = 255) => ({ bsonType: ['string', 'null'], maxLength });

/**
 * Cadena restringida a un conjunto cerrado de valores.
 * @param {readonly string[]} values
 */
export const enumOf = (values) => ({ bsonType: 'string', enum: [...values] });

/** Patron de correo electronico (validacion estructural basica). */
export const email = Object.freeze({
  bsonType: 'string',
  pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$',
  maxLength: 254,
});

/** Marcas de tiempo comunes a todas las entidades mutables. */
export const timestamps = Object.freeze({ createdAt: date, updatedAt: date });
