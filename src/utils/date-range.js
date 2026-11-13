/**
 * Utilidades de rangos de fechas ISO 8601 (Fase 4).
 *
 * Misma convencion que los reportes de la Fase 3: una fecha sin hora usada
 * como fin de rango abarca el dia completo (23:59:59.999 UTC), de modo que
 * "hasta el 31" incluye todo el dia 31. La comparten el validador y el DTO
 * para que la regla startDate <= endDate use exactamente los mismos limites.
 */

/** Fecha sin hora (AAAA-MM-DD). */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Indica si la parte de fecha existe en el calendario (rechaza 2026-02-30,
 * que Date.parse desplazaria en silencio al 2 de marzo).
 * @param {string} raw
 * @returns {boolean}
 */
export function isRealCalendarDate(raw) {
  const match = DATE_ONLY.exec(raw);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && !Number.isNaN(Date.parse(raw));
}

/**
 * Convierte un limite de rango en Date.
 * @param {string} raw Fecha ISO 8601 ya validada.
 * @param {'start' | 'end'} edge Inicio o fin del rango.
 * @returns {Date}
 */
export function parseRangeBoundary(raw, edge) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  if (dateOnly) return new Date(`${raw}T${edge === 'end' ? '23:59:59.999' : '00:00:00.000'}Z`);
  return new Date(raw);
}
