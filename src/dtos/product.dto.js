/**
 * DTOs del catalogo publico: salida de producto y entrada de consulta.
 *
 * ProductDTO construye la respuesta campo a campo (lista blanca): costCents,
 * supplierId y createdBy nunca salen por la API publica.
 */
import { fromCents, percentOf } from '../utils/money.js';

export class ProductDTO {
  /**
   * @param {object | null} product Documento de MongoDB.
   * @returns {object | null}
   */
  static from(product) {
    if (!product) return null;
    const discountPercent = product.discountPercent ?? 0;
    const finalCents = product.priceCents - percentOf(product.priceCents, discountPercent);
    return {
      id: product._id.toString(),
      sku: product.sku,
      name: product.name,
      description: product.description ?? null,
      category: product.category,
      imageUrl: product.images?.[0] ?? null,
      stock: product.stock,
      pickupAvailable: Boolean(product.pickupAvailable),
      acceptedPaymentMethods: [...(product.acceptedPaymentMethods ?? [])],
      originalPrice: fromCents(product.priceCents),
      discountPercent,
      finalPrice: fromCents(finalCents),
      hasDiscount: discountPercent > 0,
      taxRatePercent: product.taxRatePercent,
      isFeatured: Boolean(product.isFeatured),
      rating: { average: product.ratingAverage ?? 0, count: product.ratingCount ?? 0 },
    };
  }

  /** @param {object[]} products */
  static fromMany(products) {
    return products.map((product) => ProductDTO.from(product));
  }
}

/** Convierte un booleano de query string ("true"/"false") en boolean. */
const toBool = (value) => (value === undefined ? undefined : value === true || value === 'true');

/** Convierte un numero de query string, dejando undefined si no viene. */
const toNum = (value) => (value === undefined ? undefined : Number(value));

/** Parametros de listado con valores por defecto y conversion de tipos. */
export class ListProductsQueryDTO {
  /** @param {Record<string, string>} query */
  static from(query) {
    return Object.freeze({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      category: query.category?.trim() || undefined,
      featured: toBool(query.featured),
      onSale: toBool(query.onSale),
      newArrivals: toBool(query.newArrivals),
      topRated: toBool(query.topRated),
      search: query.search?.trim() || undefined,
      minPrice: toNum(query.minPrice),
      maxPrice: toNum(query.maxPrice),
      sort: query.sort || undefined,
    });
  }
}
