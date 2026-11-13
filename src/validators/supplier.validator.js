/**
 * Esquemas de validacion de proveedores (Fase 3).
 *
 * El supplierCode lo asigna el sistema: no se acepta en el alta ni en la
 * actualizacion (campo no permitido). El catalogo es una lista de
 * { productId, cost } sin productos repetidos, validada en refine con las
 * ayudas de purchase.validator.js (el motor no tiene tipo "array").
 */
import { EMAIL_PATTERN, PHONE_PATTERN, idParamSchema, paginationFields } from './common.rules.js';
import { MAX_UNIT_COST, objectArrayErrors, unknownFieldErrors } from './purchase.validator.js';

/** NIT de proveedor: digitos con verificador opcionalmente separado por guion (p. ej. 1234567-8 o 123456-K). */
export const SUPPLIER_NIT_PATTERN = /^\d{2,12}-?[\dK]$/i;

/** Maximo de productos en el catalogo de un proveedor (coherente con suppliers.schema.js). */
export const MAX_CATALOG_ITEMS = 1000;

/** Entrada del catalogo del proveedor. */
const catalogItemSchema = Object.freeze({
  fields: {
    productId: { type: 'objectId', required: true },
    cost: { type: 'number', required: true, min: 0, max: MAX_UNIT_COST, maxDecimals: 2 },
  },
});

/**
 * Campos escalares del proveedor; required decide si son obligatorios (alta) o no (PATCH).
 * @param {boolean} required
 */
const supplierFields = (required) => ({
  name: { type: 'string', required, minLength: 1, maxLength: 160 },
  nit: {
    type: 'string',
    required,
    maxLength: 40,
    pattern: SUPPLIER_NIT_PATTERN,
    patternMessage: 'NIT invalido (p. ej. 1234567-8)',
  },
  address: { type: 'string', required, minLength: 1, maxLength: 300 },
  phone: { type: 'string', required, maxLength: 20, pattern: PHONE_PATTERN, patternMessage: 'Telefono invalido' },
  email: { type: 'string', nullable: true, maxLength: 254, pattern: EMAIL_PATTERN, patternMessage: 'Correo electronico invalido' },
  contactName: { type: 'string', nullable: true, maxLength: 120 },
  distributionDescription: { type: 'string', required, minLength: 1, maxLength: 2000 },
});

/**
 * Valida el catalogo opcional.
 * @param {object} input
 */
const catalogErrors = (input) =>
  objectArrayErrors(input.catalog, 'catalog', catalogItemSchema, { maxItems: MAX_CATALOG_ITEMS, uniqueBy: 'productId' });

const createFields = Object.freeze(supplierFields(true));

export const createSupplierSchema = Object.freeze({
  fields: createFields,
  allowUnknown: true,
  refine: (input) => [...unknownFieldErrors(input, [...Object.keys(createFields), 'catalog']), ...catalogErrors(input)],
});

const updateFields = Object.freeze({ ...supplierFields(false), isActive: { type: 'boolean' } });

export const updateSupplierSchema = Object.freeze({
  fields: updateFields,
  allowUnknown: true,
  refine: (input) => {
    const allowed = [...Object.keys(updateFields), 'catalog'];
    const errors = [...unknownFieldErrors(input, allowed), ...catalogErrors(input)];
    if (!allowed.some((key) => input[key] !== undefined)) {
      errors.push({ field: '_root', message: 'Debes enviar al menos 1 campo(s) a modificar' });
    }
    return errors;
  },
});

export const listSuppliersQuerySchema = Object.freeze({
  fields: {
    ...paginationFields(),
    supplierCode: {
      type: 'string',
      minLength: 1,
      maxLength: 20,
      pattern: /^(P|PR|PRV|PRV-[0-9]*)$/i,
      patternMessage: 'Codigo de proveedor invalido (p. ej. PRV-000001 o un prefijo como PRV-0001)',
    },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    address: { type: 'string', minLength: 1, maxLength: 100 },
    isActive: { type: 'boolean', fromString: true },
  },
});

export { idParamSchema };
