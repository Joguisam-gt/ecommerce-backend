/**
 * Esquemas de validacion de compras a proveedores (Fase 3).
 *
 * El motor declarativo (schema-validator.js) no tiene tipo "array", por lo que
 * los esquemas con listas de objetos declaran allowUnknown y validan en refine:
 * (1) que no haya campos desconocidos (unknownFieldErrors) y (2) cada elemento
 * de la lista con su propio esquema (objectArrayErrors). Ambas ayudas se
 * reutilizan en supplier.validator.js.
 */
import { ALL_PAYMENT_METHODS } from '../constants/commerce.js';
import { idParamSchema, paginationFields } from './common.rules.js';
import { dateRangeErrors, isoDateRule, MAX_MOVEMENT_QUANTITY } from './inventory.validator.js';
import { validateSchema } from './schema-validator.js';

/** Costo unitario maximo admitido (en unidades monetarias). */
export const MAX_UNIT_COST = 10000000;

/** Maximo de lineas por compra (coherente con purchases.schema.js). */
export const MAX_PURCHASE_ITEMS = 200;

/**
 * Errores por campos no declarados (sustituye a la comprobacion del motor cuando allowUnknown es true).
 * @param {object} input
 * @param {readonly string[]} allowed
 * @returns {Array<{ field: string, message: string }>}
 */
export function unknownFieldErrors(input, allowed) {
  return Object.keys(input)
    .filter((key) => !allowed.includes(key))
    .map((field) => ({ field, message: 'Campo no permitido' }));
}

/**
 * Valida una lista de objetos: tipo, tamano, cada elemento contra su esquema y
 * (opcional) que un campo no se repita entre elementos.
 * @param {unknown} value
 * @param {string} field Nombre del campo (prefijo de los errores, p. ej. "items[0].quantity").
 * @param {object} itemSchema Esquema de cada elemento.
 * @param {{ required?: boolean, minItems?: number, maxItems?: number, uniqueBy?: string }} [options]
 * @returns {Array<{ field: string, message: string }>}
 */
export function objectArrayErrors(value, field, itemSchema, { required = false, minItems = 0, maxItems = 1000, uniqueBy } = {}) {
  if (value === undefined) return required ? [{ field, message: 'Campo obligatorio' }] : [];
  if (!Array.isArray(value)) return [{ field, message: 'Debe ser una lista' }];
  if (value.length < minItems) return [{ field, message: `Debe tener al menos ${minItems} elemento(s)` }];
  if (value.length > maxItems) return [{ field, message: `Debe tener como maximo ${maxItems} elementos` }];

  const errors = [];
  value.forEach((item, index) => {
    for (const nested of validateSchema(itemSchema, item)) {
      errors.push({ field: nested.field === '_root' ? `${field}[${index}]` : `${field}[${index}].${nested.field}`, message: nested.message });
    }
  });
  if (errors.length === 0 && uniqueBy) {
    const seen = new Set();
    value.forEach((item, index) => {
      const key = String(item[uniqueBy]).toLowerCase();
      if (seen.has(key)) errors.push({ field: `${field}[${index}].${uniqueBy}`, message: `${uniqueBy} repetido en la lista` });
      seen.add(key);
    });
  }
  return errors;
}

/** Linea de compra. */
const purchaseItemSchema = Object.freeze({
  fields: {
    productId: { type: 'objectId', required: true },
    quantity: { type: 'integer', required: true, min: 1, max: MAX_MOVEMENT_QUANTITY },
    unitCost: { type: 'number', required: true, min: 0, max: MAX_UNIT_COST, maxDecimals: 2 },
  },
});

/** Campos escalares del alta de compra. */
const createPurchaseFields = Object.freeze({
  supplierId: { type: 'objectId', required: true },
  paymentMethod: { type: 'enum', values: ALL_PAYMENT_METHODS },
  supplierInvoiceNumber: { type: 'string', nullable: true, minLength: 1, maxLength: 60 },
  notes: { type: 'string', nullable: true, maxLength: 1000 },
  purchasedAt: isoDateRule(),
});

export const createPurchaseSchema = Object.freeze({
  fields: createPurchaseFields,
  allowUnknown: true,
  refine: (input) => [
    ...unknownFieldErrors(input, [...Object.keys(createPurchaseFields), 'items']),
    ...objectArrayErrors(input.items, 'items', purchaseItemSchema, {
      required: true,
      minItems: 1,
      maxItems: MAX_PURCHASE_ITEMS,
      uniqueBy: 'productId',
    }),
  ],
});

export const listPurchasesQuerySchema = Object.freeze({
  fields: {
    ...paginationFields(),
    supplierId: { type: 'objectId' },
    from: isoDateRule(),
    to: isoDateRule(),
  },
  refine: (input) => dateRangeErrors(input, 'from', 'to'),
});

export { idParamSchema };
