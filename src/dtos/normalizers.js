/**
 * Funciones de normalizacion compartidas por los DTOs.
 *
 * Se aplican despues de validar, para que los datos lleguen al servicio en
 * forma canonica (correo en minusculas, espacios colapsados, etc.).
 */

/**
 * Correo sin espacios y en minusculas (clave del indice unico).
 * @param {string} value
 */
export const normalizeEmail = (value) => value.trim().toLowerCase();

/**
 * Texto sin espacios extremos y con espacios internos colapsados.
 * @param {string} value
 */
export const normalizeText = (value) => value.trim().replace(/\s+/g, ' ');

/**
 * Telefono opcional: null o cadena vacia se guardan como null.
 * @param {string | null | undefined} value
 */
export const normalizePhone = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  return value.replace(/\s+/g, ' ').trim();
};

/**
 * Elimina las claves con valor undefined (para actualizaciones parciales).
 * @template {object} T
 * @param {T} source
 * @returns {Partial<T>}
 */
export const compact = (source) =>
  Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined));
