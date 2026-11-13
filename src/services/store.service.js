/**
 * Servicio del catalogo publico.
 *
 * Traduce los filtros de la API (precios decimales, banderas, ventana de
 * novedades) a criterios del repositorio y resuelve el orden por defecto.
 */
import { HttpError } from '../utils/http-error.js';
import { toCents } from '../utils/money.js';
import { toObjectId } from '../utils/object-id.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export class StoreService {
  #products;
  #config;
  #now;

  /**
   * @param {{ productRepository: object, storeConfig: { newArrivalsDays: number }, clock?: () => Date }} deps
   */
  constructor({ productRepository, storeConfig, clock = () => new Date() }) {
    this.#products = productRepository;
    this.#config = storeConfig;
    this.#now = clock;
  }

  /**
   * Listado paginado del catalogo.
   * @param {object} query ListProductsQueryDTO
   * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
   */
  async listProducts(query) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const criteria = { page, limit, sort: this.#resolveSort(query) };

    if (query.category) criteria.category = query.category;
    if (query.featured) criteria.featured = true;
    if (query.onSale) criteria.onSale = true;
    if (query.topRated) criteria.topRated = true;
    if (query.search) criteria.search = query.search;
    if (query.newArrivals) {
      criteria.newerThan = new Date(this.#now().getTime() - this.#config.newArrivalsDays * DAY_MS);
    }
    if (query.minPrice !== undefined) criteria.minPriceCents = toCents(query.minPrice);
    if (query.maxPrice !== undefined) criteria.maxPriceCents = toCents(query.maxPrice);

    const { items, total } = await this.#products.listPublic(criteria);
    return { items, total, page, limit };
  }

  /**
   * Detalle de un producto activo.
   * @param {string} id
   */
  async getProduct(id) {
    const product = await this.#products.findPublicById(toObjectId(id));
    if (!product) throw HttpError.notFound('Producto no encontrado', 'PRODUCT_NOT_FOUND');
    return product;
  }

  /**
   * Orden efectivo: explicito, o derivado de los filtros, o undefined (newest / relevancia).
   * @param {object} query
   * @returns {string | undefined}
   */
  #resolveSort(query) {
    if (query.sort) return query.sort;
    if (query.topRated) return 'top_rated';
    if (query.onSale) return 'discount_desc';
    return query.search ? undefined : 'newest';
  }
}
