/**
 * Esquema de validacion de la consulta de audit_logs.
 *
 * Los filtros de fecha aceptan cadenas ISO 8601; se valida que sean fechas
 * reales y que el rango sea coherente.
 */
import { paginationFields } from './common.rules.js';

/**
 * Comprueba que una cadena sea una fecha valida.
 * @param {string} value
 * @returns {string | null}
 */
const isoDate = (value) => (Number.isNaN(Date.parse(value)) ? 'Fecha invalida (usa ISO 8601)' : null);

export const listAuditLogsQuerySchema = Object.freeze({
  fields: {
    ...paginationFields(),
    action: { type: 'string', maxLength: 80, pattern: /^[a-z_]+(\.[a-z_]+)?$/ },
    entity: { type: 'string', maxLength: 60, pattern: /^[a-z_]+$/ },
    entityId: { type: 'string', maxLength: 64 },
    actorId: { type: 'objectId' },
    outcome: { type: 'enum', values: ['success', 'failure'] },
    from: { type: 'string', maxLength: 40, custom: isoDate },
    to: { type: 'string', maxLength: 40, custom: isoDate },
  },
  refine: (input) =>
    input.from && input.to && Date.parse(input.from) > Date.parse(input.to)
      ? [{ field: 'from', message: '"from" debe ser anterior a "to"' }]
      : [],
});
