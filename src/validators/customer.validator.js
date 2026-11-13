/**
 * Esquemas de validacion del directorio de clientes (/admin/customers).
 *
 * - Listado: filtros de contacto (texto escapado en el pipeline), estado y
 *   metricas calculadas (gasto total en unidades decimales, articulos comprados).
 * - Actualizacion: solo firstName, lastName, phone y userCode (sin correo, rol
 *   ni estado); al menos un campo.
 */
import { ALL_PAYMENT_METHODS } from '../constants/commerce.js';
import { idParamSchema, nameRule, paginationFields, phoneRule } from './common.rules.js';

/** Codigo de cliente: letras, digitos, guion y guion bajo (3 a 40). */
export const USER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/;

/**
 * Impide codigos con forma de ObjectId: se confundirian con el codigo por
 * defecto (el _id en texto) de otro cliente.
 * @param {string} value
 * @returns {string | null}
 */
const notObjectIdLike = (value) => (/^[a-f\d]{24}$/i.test(value.trim()) ? 'El codigo no puede tener formato de identificador interno' : null);

/** Importe decimal no negativo con 2 decimales como maximo. */
const amountRule = () => ({ type: 'number', fromString: true, min: 0, maxDecimals: 2 });

export const listCustomersQuerySchema = Object.freeze({
  fields: {
    ...paginationFields(),
    userCode: { type: 'string', minLength: 1, maxLength: 40 },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    email: { type: 'string', minLength: 1, maxLength: 254 },
    phone: { type: 'string', minLength: 1, maxLength: 20, pattern: /^\+?[0-9\s-]+$/, patternMessage: 'Telefono invalido' },
    isActive: { type: 'boolean', fromString: true },
    includeInactive: { type: 'boolean', fromString: true },
    preferredPaymentMethod: { type: 'enum', values: [...ALL_PAYMENT_METHODS] },
    minTotalSpent: amountRule(),
    maxTotalSpent: amountRule(),
    minPurchasedItems: { type: 'integer', fromString: true, min: 0, max: 10000000 },
  },
  refine: (input) =>
    input.minTotalSpent !== undefined && input.maxTotalSpent !== undefined && Number(input.minTotalSpent) > Number(input.maxTotalSpent)
      ? [{ field: 'minTotalSpent', message: 'minTotalSpent no puede ser mayor que maxTotalSpent' }]
      : [],
});

export const updateCustomerSchema = Object.freeze({
  fields: {
    firstName: nameRule(false),
    lastName: nameRule(false),
    phone: phoneRule(),
    userCode: {
      type: 'string',
      nullable: true,
      pattern: USER_CODE_PATTERN,
      patternMessage: 'Codigo invalido (3 a 40 letras, digitos, guion o guion bajo)',
      custom: notObjectIdLike,
    },
  },
  minFields: 1,
});

export { idParamSchema };
