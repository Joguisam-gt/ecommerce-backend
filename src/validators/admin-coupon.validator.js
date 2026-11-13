/**
 * Esquemas de validacion de cupones del panel (/api/v1/admin/coupons).
 *
 * El motor declarativo no tiene tipo 'array', por eso los esquemas de alta y
 * edicion declaran allowUnknown y su refine hace dos cosas: rechazar campos no
 * declarados (misma proteccion contra asignacion masiva que el resto de
 * esquemas) y validar applicableProductIds (array de ObjectId, maximo 500).
 * La regla de negocio expiresAt XOR isPermanent (422) y que expiresAt sea
 * futura dependen del reloj: las aplica AdminCouponService; aqui solo se
 * valida el formato de las fechas.
 */
import { AVAILABILITY } from '../constants/commerce.js';
import { idParamSchema, paginationFields } from './common.rules.js';

/** Patron del codigo de cupon (coherente con coupons.schema.js), tras pasar a mayusculas. */
export const COUPON_CODE_PATTERN = /^[A-Z0-9_-]{3,30}$/;

/** Fecha ISO 8601 (fecha o fecha y hora con zona opcional). */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** Maximo de productos aplicables (maxItems del $jsonSchema). */
export const MAX_APPLICABLE_PRODUCTS = 500;

/**
 * Comprueba una fecha ISO valida.
 * @param {string} value
 * @returns {string | null}
 */
const isoDate = (value) =>
  ISO_DATE_PATTERN.test(value.trim()) && !Number.isNaN(Date.parse(value.trim())) ? null : 'Debe ser una fecha ISO 8601 valida';

/** Regla de fecha ISO. */
const dateRule = () => ({ type: 'string', maxLength: 40, custom: isoDate });

/** Regla de precio en unidades desde query string. */
const priceRule = () => ({ type: 'number', fromString: true, min: 0, maxDecimals: 2 });

/** Regla de descuento porcentual entero (discountValue es entero en el esquema). */
const discountPercentRule = (required) => ({ type: 'integer', required, min: 1, max: 100 });

/** Regla de limite de usos opcional. */
const maxUsesRule = () => ({ type: 'integer', nullable: true, min: 1, max: 1_000_000 });

/**
 * Codigo opcional: vacio o ausente significa "generar"; si viene, en mayusculas debe cumplir el patron.
 * @param {string} value
 * @returns {string | null}
 */
const couponCode = (value) => {
  const code = value.trim().toUpperCase();
  if (code === '') return null;
  return COUPON_CODE_PATTERN.test(code) ? null : 'Solo letras, numeros, guion y guion bajo (3 a 30 caracteres)';
};

/**
 * Valida applicableProductIds si viene: array de ObjectId en hexadecimal.
 * @param {unknown} value
 * @returns {Array<{ field: string, message: string }>}
 */
function applicableProductIdsErrors(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [{ field: 'applicableProductIds', message: 'Debe ser una lista de identificadores' }];
  if (value.length > MAX_APPLICABLE_PRODUCTS) {
    return [{ field: 'applicableProductIds', message: `Admite como maximo ${MAX_APPLICABLE_PRODUCTS} productos` }];
  }
  return value
    .map((id, index) => (typeof id === 'string' && /^[a-f\d]{24}$/i.test(id) ? null : { field: `applicableProductIds[${index}]`, message: 'Identificador invalido' }))
    .filter(Boolean);
}

/**
 * Construye el refine comun: campos desconocidos, lista de productos y reglas extra.
 * @param {readonly string[]} known Campos admitidos.
 * @param {(input: object) => Array<{ field: string, message: string }>} [extra]
 */
const refineWith = (known, extra = () => []) => (input) => {
  const errors = Object.keys(input)
    .filter((key) => !known.includes(key))
    .map((key) => ({ field: key, message: 'Campo no permitido' }));
  errors.push(...applicableProductIdsErrors(input.applicableProductIds));
  errors.push(...extra(input));
  return errors;
};

/** Campos del alta. */
const createFields = {
  code: { type: 'string', nullable: true, maxLength: 30, custom: couponCode },
  description: { type: 'string', nullable: true, maxLength: 500 },
  discountPercent: discountPercentRule(true),
  expiresAt: dateRule(),
  isPermanent: { type: 'boolean' },
  validFrom: dateRule(),
  maxUses: maxUsesRule(),
  maxUsesPerUser: maxUsesRule(),
};

/** POST /coupons */
export const createCouponSchema = Object.freeze({
  fields: createFields,
  allowUnknown: true,
  refine: refineWith([...Object.keys(createFields), 'applicableProductIds'], (input) =>
    Number.isInteger(input.maxUses) && Number.isInteger(input.maxUsesPerUser) && input.maxUsesPerUser > input.maxUses
      ? [{ field: 'maxUsesPerUser', message: 'No puede superar maxUses' }]
      : [],
  ),
});

/** Campos de la edicion. */
const updateFields = {
  description: { type: 'string', nullable: true, maxLength: 500 },
  discountPercent: discountPercentRule(false),
  expiresAt: dateRule(),
  isPermanent: { type: 'boolean' },
  isActive: { type: 'boolean' },
};

/** Campos admitidos en PATCH /coupons/:id. */
const UPDATE_KEYS = Object.freeze([...Object.keys(updateFields), 'applicableProductIds']);

/** PATCH /coupons/:id (al menos un campo). */
export const updateCouponSchema = Object.freeze({
  fields: updateFields,
  allowUnknown: true,
  refine: refineWith(UPDATE_KEYS, (input) =>
    UPDATE_KEYS.some((key) => input[key] !== undefined)
      ? []
      : [{ field: '_root', message: 'Debes enviar al menos 1 campo(s) a modificar' }],
  ),
});

/** GET /coupons */
export const listCouponsQuerySchema = Object.freeze({
  fields: {
    ...paginationFields(),
    isActive: { type: 'boolean', fromString: true },
    code: { type: 'string', minLength: 1, maxLength: 30, pattern: /^[A-Za-z0-9_-]+$/, patternMessage: 'Codigo invalido' },
  },
});

/** GET /coupons/applicable-products */
export const applicableProductsQuerySchema = Object.freeze({
  fields: {
    ...paginationFields(),
    name: { type: 'string', minLength: 1, maxLength: 100 },
    minPrice: priceRule(),
    maxPrice: priceRule(),
    category: { type: 'string', minLength: 1, maxLength: 80 },
    availability: { type: 'enum', values: Object.values(AVAILABILITY) },
  },
  refine: (input) =>
    input.minPrice !== undefined && input.maxPrice !== undefined && Number(input.minPrice) > Number(input.maxPrice)
      ? [{ field: 'minPrice', message: 'minPrice no puede ser mayor que maxPrice' }]
      : [],
});

export { idParamSchema };
