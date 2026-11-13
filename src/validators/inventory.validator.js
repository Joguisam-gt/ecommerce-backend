/**
 * Esquemas de validacion del inventario del panel (Fase 3): listado de
 * productos con filtros dinamicos, registro de mermas y su listado.
 *
 * Exporta tambien reglas de fecha reutilizadas por compras y proveedores.
 * El parametro :id reutiliza idParamSchema de common.rules.js.
 */
import { ALL_LOSS_REASONS } from '../constants/commerce.js';
import { idParamSchema, paginationFields } from './common.rules.js';

/** Maximo de unidades por movimiento de inventario (merma o linea de compra). */
export const MAX_MOVEMENT_QUANTITY = 100000;

/** Ordenes admitidos por el listado de inventario (ver InventoryRepository). */
export const INVENTORY_SORT_KEYS = Object.freeze([
  'newest',
  'oldest',
  'name_asc',
  'name_desc',
  'price_asc',
  'price_desc',
  'stock_asc',
  'stock_desc',
]);

/**
 * Comprueba una fecha ISO 8601.
 * @param {string} value
 * @returns {string | null}
 */
const isoDate = (value) => (Number.isNaN(Date.parse(value)) ? 'Fecha invalida (usa ISO 8601)' : null);

/** Fecha en formato ISO 8601 (query string o cuerpo). */
export const isoDateRule = (required = false) => ({ type: 'string', required, maxLength: 40, custom: isoDate });

/** Precio decimal no negativo con 2 decimales (query string). */
const priceRule = () => ({ type: 'number', fromString: true, min: 0, maxDecimals: 2 });

/**
 * Error si el inicio de un rango de fechas es posterior a su fin.
 * @param {object} input
 * @param {string} fromField
 * @param {string} toField
 * @returns {Array<{ field: string, message: string }>}
 */
export function dateRangeErrors(input, fromField, toField) {
  const from = input[fromField];
  const to = input[toField];
  if (from && to && Date.parse(from) > Date.parse(to)) {
    return [{ field: fromField, message: `${fromField} no puede ser posterior a ${toField}` }];
  }
  return [];
}

export const listInventoryQuerySchema = Object.freeze({
  fields: {
    ...paginationFields(),
    productName: { type: 'string', minLength: 1, maxLength: 100 },
    supplierId: { type: 'objectId' },
    category: { type: 'string', minLength: 1, maxLength: 80 },
    minPrice: priceRule(),
    maxPrice: priceRule(),
    createdFrom: isoDateRule(),
    createdTo: isoDateRule(),
    isActive: { type: 'boolean', fromString: true },
    sort: { type: 'enum', values: INVENTORY_SORT_KEYS },
  },
  refine: (input) => {
    const errors = dateRangeErrors(input, 'createdFrom', 'createdTo');
    if (input.minPrice !== undefined && input.maxPrice !== undefined && Number(input.minPrice) > Number(input.maxPrice)) {
      errors.push({ field: 'minPrice', message: 'minPrice no puede ser mayor que maxPrice' });
    }
    return errors;
  },
});

export const recordLossSchema = Object.freeze({
  fields: {
    productId: { type: 'objectId', required: true },
    quantity: { type: 'integer', required: true, min: 1, max: MAX_MOVEMENT_QUANTITY },
    reason: { type: 'enum', required: true, values: ALL_LOSS_REASONS },
    notes: { type: 'string', nullable: true, maxLength: 1000 },
    occurredAt: isoDateRule(),
  },
});

export const listLossesQuerySchema = Object.freeze({
  fields: {
    ...paginationFields(),
    productId: { type: 'objectId' },
    reason: { type: 'enum', values: ALL_LOSS_REASONS },
    from: isoDateRule(),
    to: isoDateRule(),
  },
  refine: (input) => dateRangeErrors(input, 'from', 'to'),
});

export { idParamSchema };
