/**
 * Esquemas de validacion de los reportes analiticos (GET /admin/reports/*).
 *
 * Las fechas se reciben como cadenas ISO 8601 (fecha o fecha-hora). Una fecha
 * sin hora en endDate incluye el dia completo (ver report.dto.js). Se exige
 * endDate >= startDate. Las reglas de fecha se reutilizan en la facturacion admin.
 */
import { idParamSchema } from './common.rules.js';

/** Fecha ISO 8601: AAAA-MM-DD con hora opcional. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Comprueba que la cadena sea una fecha real en formato ISO 8601.
 * @param {string} value
 * @returns {string | null}
 */
const isoDate = (value) =>
  ISO_DATE_PATTERN.test(value.trim()) && !Number.isNaN(Date.parse(value.trim())) ? null : 'Fecha invalida (usa ISO 8601, p. ej. 2026-01-31)';

/** Regla de fecha opcional en query string. */
export const dateRule = () => ({ type: 'string', maxLength: 40, custom: isoDate });

/** Campos startDate / endDate compartidos por reportes y facturacion. */
export const dateRangeFields = () => ({ startDate: dateRule(), endDate: dateRule() });

/**
 * Regla entre campos: endDate no puede ser anterior a startDate.
 * Compara fechas sin hora por dia, coherente con la expansion de endDate al fin del dia.
 * @param {{ startDate?: string, endDate?: string }} input
 * @returns {Array<{ field: string, message: string }>}
 */
export function dateRangeRefine(input) {
  if (!input.startDate || !input.endDate) return [];
  return Date.parse(input.endDate.trim()) < Date.parse(input.startDate.trim())
    ? [{ field: 'endDate', message: 'endDate debe ser igual o posterior a startDate' }]
    : [];
}

/** Texto de filtro libre (categoria o nombre). */
const filterText = (maxLength) => ({ type: 'string', minLength: 1, maxLength });

/** GET /admin/reports/general */
export const generalReportQuerySchema = Object.freeze({
  fields: {
    ...dateRangeFields(),
    category: filterText(80),
    productName: filterText(100),
    lowStockThreshold: { type: 'integer', fromString: true, min: 0, max: 100000 },
    topLimit: { type: 'integer', fromString: true, min: 1, max: 50 },
  },
  refine: dateRangeRefine,
});

/** GET /admin/reports/products/:id/supplier-performance (query). */
export const supplierPerformanceQuerySchema = Object.freeze({
  fields: { ...dateRangeFields() },
  refine: dateRangeRefine,
});

export { idParamSchema };
