/**
 * Esquema de validacion de la consulta de audit_logs del superusuario
 * (Fase 4, GET /api/superuser/audit-logs).
 *
 * Filtros: actorId (ObjectId), role (rol del actor), action (formato
 * "entidad.accion"), targetCollection (coleccion conocida), startDate y
 * endDate en ISO 8601 (fecha o fecha y hora) con startDate <= endDate.
 * La paginacion admite como maximo AUDIT_LOG_MAX_LIMIT elementos por pagina.
 * Una fecha sin hora como endDate abarca el dia completo (ver utils/date-range.js).
 */
import { ALL_ROLES } from '../constants/roles.js';
import { AUDIT_LOG_MAX_LIMIT } from '../constants/superuser.js';
import { COLLECTIONS } from '../database/collections.js';
import { isRealCalendarDate, parseRangeBoundary } from '../utils/date-range.js';

/** ISO 8601: fecha (AAAA-MM-DD) o fecha y hora con zona opcional. */
export const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Comprueba que la cadena ISO 8601 represente una fecha real del calendario.
 * @param {string} value
 * @returns {string | null}
 */
const realDate = (value) => (isRealCalendarDate(value) ? null : 'Fecha inexistente');

/** Regla de fecha ISO 8601 en query string. */
const isoDateRule = () => ({
  type: 'string',
  maxLength: 40,
  pattern: ISO_8601_PATTERN,
  patternMessage: 'Fecha invalida (usa ISO 8601, p. ej. 2026-01-31 o 2026-01-31T23:59:59Z)',
  custom: realDate,
});

export const superuserAuditLogsQuerySchema = Object.freeze({
  fields: {
    page: { type: 'integer', fromString: true, min: 1, max: 100000 },
    limit: { type: 'integer', fromString: true, min: 1, max: AUDIT_LOG_MAX_LIMIT },
    actorId: { type: 'objectId' },
    role: { type: 'enum', values: ALL_ROLES },
    action: {
      type: 'string',
      maxLength: 80,
      pattern: /^[a-z_]+\.[a-z_]+$/,
      patternMessage: 'Accion invalida (formato entidad.accion, p. ej. record.purged)',
    },
    targetCollection: { type: 'enum', values: Object.values(COLLECTIONS) },
    startDate: isoDateRule(),
    endDate: isoDateRule(),
  },
  refine: (input) =>
    input.startDate && input.endDate && parseRangeBoundary(input.startDate, 'start') > parseRangeBoundary(input.endDate, 'end')
      ? [{ field: 'startDate', message: 'startDate debe ser anterior o igual a endDate' }]
      : [],
});
