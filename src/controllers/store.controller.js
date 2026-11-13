/**
 * Controlador del catalogo publico: adapta HTTP al servicio y expone
 * siempre productos mediante ProductDTO.
 */
import { ListProductsQueryDTO, ProductDTO } from '../dtos/product.dto.js';

export class StoreController {
  #store;
  #config;

  /** @param {{ storeService: import('../services/store.service.js').StoreService, storeConfig: { currency: string } }} deps */
  constructor({ storeService, storeConfig }) {
    this.#store = storeService;
    this.#config = storeConfig;
  }

  /** GET /products */
  list = async (req, res) => {
    const { items, total, page, limit } = await this.#store.listProducts(ListProductsQueryDTO.from(req.query));
    res.json({
      data: ProductDTO.fromMany(items),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit), currency: this.#config.currency },
    });
  };

  /** GET /products/:id */
  getById = async (req, res) => {
    const product = await this.#store.getProduct(req.params.id);
    res.json({ data: ProductDTO.from(product) });
  };
}
