/**
 * Esquemas de validacion de la conciliacion de transferencias (/api/v1/admin/orders).
 * El parametro :id reutiliza idParamSchema de common.rules.js.
 */
import { RECONCILE_ACTIONS } from '../constants/commerce.js';
import { idParamSchema, paginationFields } from './common.rules.js';

/** Query de GET /pending-verification. */
export const listPendingVerificationQuerySchema = Object.freeze({
  fields: { ...paginationFields() },
});

/** Cuerpo de PATCH /:id/reconcile: el motivo es obligatorio al rechazar. */
export const reconcileOrderSchema = Object.freeze({
  fields: {
    action: { type: 'enum', required: true, values: Object.values(RECONCILE_ACTIONS) },
    reason: { type: 'string', minLength: 3, maxLength: 500 },
  },
  refine: (input) =>
    input.action === RECONCILE_ACTIONS.REJECT && (input.reason === undefined || input.reason === null)
      ? [{ field: 'reason', message: 'El motivo es obligatorio al rechazar una transferencia' }]
      : [],
});

export { idParamSchema };
