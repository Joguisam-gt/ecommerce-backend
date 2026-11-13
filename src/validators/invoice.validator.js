/**
 * Esquema de validacion del listado de facturas (GET /api/invoices).
 *
 * El filtro userId solo tiene efecto con invoices:manage; para el resto de
 * usuarios el servicio lo sustituye por su propio id.
 */
import { ALL_INVOICE_STATUSES } from '../constants/commerce.js';
import { NIT_PATTERN } from './checkout.validator.js';
import { paginationFields } from './common.rules.js';

export const listInvoicesQuerySchema = Object.freeze({
  fields: {
    ...paginationFields(),
    userId: { type: 'objectId' },
    status: { type: 'enum', values: [...ALL_INVOICE_STATUSES] },
    nit: {
      type: 'string',
      maxLength: 40,
      // NIT, CF o codigo de usuario (ObjectId) cuando la factura no tiene NIT.
      custom: (value) =>
        NIT_PATTERN.test(value.trim().toUpperCase()) || /^[a-f\d]{24}$/i.test(value.trim()) ? null : 'NIT invalido',
    },
  },
});
