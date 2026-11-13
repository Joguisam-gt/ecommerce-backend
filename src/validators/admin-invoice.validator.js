/**
 * Esquema de validacion del listado administrativo de facturas (GET /admin/invoices).
 *
 * Todos los filtros de texto se usan como busqueda parcial escapada en el
 * repositorio; el rango startDate/endDate se aplica sobre issuedAt.
 */
import {
  ALL_INVOICE_ENTITY_TYPES,
  ALL_INVOICE_STATUSES,
  ALL_PAYMENT_METHODS,
} from '../constants/commerce.js';
import { idParamSchema, paginationFields } from './common.rules.js';
import { dateRangeFields, dateRangeRefine } from './report.validator.js';

/** Texto de busqueda libre con longitud acotada. */
const searchText = (maxLength) => ({ type: 'string', minLength: 1, maxLength });

export const listAdminInvoicesQuerySchema = Object.freeze({
  fields: {
    ...paginationFields(),
    nit: { type: 'string', minLength: 1, maxLength: 40, pattern: /^[A-Za-z0-9-]+$/, patternMessage: 'NIT invalido' },
    entityName: searchText(160),
    paymentMethod: { type: 'enum', values: [...ALL_PAYMENT_METHODS] },
    shippingAddress: searchText(200),
    email: searchText(254),
    entityType: { type: 'enum', values: [...ALL_INVOICE_ENTITY_TYPES] },
    status: { type: 'enum', values: [...ALL_INVOICE_STATUSES] },
    ...dateRangeFields(),
  },
  refine: dateRangeRefine,
});

export { idParamSchema };
