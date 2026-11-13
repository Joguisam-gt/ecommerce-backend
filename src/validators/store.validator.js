/**
 * Esquema de validacion del catalogo publico (query string de GET /products).
 * El parametro :id reutiliza idParamSchema de common.rules.js.
 */
import { idParamSchema, paginationFields } from './common.rules.js';

/** Ordenes admitidos por el catalogo. */
export const PRODUCT_SORTS = Object.freeze(['newest', 'top_rated', 'price_asc', 'price_desc', 'discount_desc']);

const boolRule = () => ({ type: 'boolean', fromString: true });
const priceRule = () => ({ type: 'number', fromString: true, min: 0, maxDecimals: 2 });

export const listProductsQuerySchema = Object.freeze({
  fields: {
    ...paginationFields(),
    category: { type: 'string', minLength: 1, maxLength: 80 },
    featured: boolRule(),
    onSale: boolRule(),
    newArrivals: boolRule(),
    topRated: boolRule(),
    search: { type: 'string', minLength: 1, maxLength: 100 },
    minPrice: priceRule(),
    maxPrice: priceRule(),
    sort: { type: 'enum', values: PRODUCT_SORTS },
  },
  refine: (input) => {
    if (input.minPrice !== undefined && input.maxPrice !== undefined && Number(input.minPrice) > Number(input.maxPrice)) {
      return [{ field: 'minPrice', message: 'minPrice no puede ser mayor que maxPrice' }];
    }
    return [];
  },
});

export { idParamSchema };
