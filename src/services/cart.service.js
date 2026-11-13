/**
 * Servicio de carrito: altas, cambios de cantidad y cupones.
 *
 * Valida stock y limites al escribir, y devuelve siempre la caja recalculada
 * por CartPricingService (misma logica que usara el checkout). El carrito solo
 * guarda referencias; los precios se leen en vivo del catalogo.
 */
import { CART_LIMITS } from '../constants/commerce.js';
import { HttpError } from '../utils/http-error.js';
import { toObjectId } from '../utils/object-id.js';

export class CartService {
  #carts;
  #products;
  #pricing;
  #now;

  /**
   * @param {{ cartRepository: import('../repositories/cart.repository.js').CartRepository,
   *           productRepository: { findPublicById(id: import('mongodb').ObjectId): Promise<object | null> },
   *           cartPricingService: import('./cart-pricing.service.js').CartPricingService,
   *           clock?: () => Date }} deps
   */
  constructor({ cartRepository, productRepository, cartPricingService, clock = () => new Date() }) {
    this.#carts = cartRepository;
    this.#products = productRepository;
    this.#pricing = cartPricingService;
    this.#now = clock;
  }

  /**
   * Devuelve el carrito con su caja calculada.
   * @param {{ id: string }} actor
   */
  async getCart(actor) {
    const userId = toObjectId(actor.id);
    const cart = await this.#carts.findByUserId(userId);
    return this.#price(cart, userId);
  }

  /**
   * Agrega un producto (suma si ya estaba) validando stock y limites.
   * @param {{ id: string }} actor
   * @param {{ productId: string, quantity: number }} input
   */
  async addItem(actor, { productId, quantity }) {
    const userId = toObjectId(actor.id);
    const id = toObjectId(productId);
    const product = await this.#requireProduct(id);
    const cart = await this.#carts.findByUserId(userId);
    const items = [...(cart?.items ?? [])];

    const index = items.findIndex((item) => item.productId.equals(id));
    if (index === -1 && items.length >= CART_LIMITS.MAX_LINES) {
      throw HttpError.unprocessable(`El carrito admite como maximo ${CART_LIMITS.MAX_LINES} productos distintos`, 'CART_LINES_LIMIT');
    }

    const total = (index === -1 ? 0 : items[index].quantity) + quantity;
    this.#assertQuantity(product, id, total);

    if (index === -1) items.push({ productId: id, quantity: total, addedAt: this.#now() });
    else items[index] = { ...items[index], quantity: total };

    const saved = await this.#carts.saveItems(userId, items, this.#now());
    return this.#price(saved, userId);
  }

  /**
   * Fija la cantidad de una linea existente.
   * @param {{ id: string }} actor
   * @param {string} productId
   * @param {number} quantity
   */
  async updateItemQuantity(actor, productId, quantity) {
    const userId = toObjectId(actor.id);
    const id = toObjectId(productId);
    const cart = await this.#carts.findByUserId(userId);
    const items = [...(cart?.items ?? [])];
    const index = items.findIndex((item) => item.productId.equals(id));
    if (index === -1) throw HttpError.notFound('El producto no esta en el carrito', 'CART_ITEM_NOT_FOUND');

    const product = await this.#requireProduct(id);
    this.#assertQuantity(product, id, quantity);

    items[index] = { ...items[index], quantity };
    const saved = await this.#carts.saveItems(userId, items, this.#now());
    return this.#price(saved, userId);
  }

  /**
   * Quita una linea del carrito.
   * @param {{ id: string }} actor
   * @param {string} productId
   */
  async removeItem(actor, productId) {
    const userId = toObjectId(actor.id);
    const id = toObjectId(productId);
    const cart = await this.#carts.findByUserId(userId);
    const items = cart?.items ?? [];
    if (!items.some((item) => item.productId.equals(id))) {
      throw HttpError.notFound('El producto no esta en el carrito', 'CART_ITEM_NOT_FOUND');
    }
    const saved = await this.#carts.saveItems(userId, items.filter((item) => !item.productId.equals(id)), this.#now());
    return this.#price(saved, userId);
  }

  /**
   * Aplica un cupon. Si no es valido lanza 422 y NO modifica el carrito.
   * @param {{ id: string }} actor
   * @param {string} code
   */
  async applyCoupon(actor, code) {
    const userId = toObjectId(actor.id);
    const normalized = String(code).trim().toUpperCase();
    const cart = await this.#carts.findByUserId(userId);
    if (!cart || cart.items.length === 0) {
      throw HttpError.unprocessable('El carrito esta vacio', 'CART_EMPTY');
    }

    const base = await this.#pricing.priceCart({ items: cart.items, couponCode: null }, { userId });
    const evaluation = await this.#pricing.evaluateCouponCode(normalized, base.pricing.lines, { userId });
    if (!evaluation.valid) {
      const { valid, reason, message, ...extra } = evaluation;
      throw HttpError.unprocessable(message, reason, { reason, ...extra });
    }

    const saved = await this.#carts.setCouponCode(userId, normalized, this.#now());
    return this.#price(saved, userId);
  }

  /**
   * Quita el cupon del carrito.
   * @param {{ id: string }} actor
   */
  async removeCoupon(actor) {
    const userId = toObjectId(actor.id);
    const saved = await this.#carts.setCouponCode(userId, null, this.#now());
    return this.#price(saved, userId);
  }

  /**
   * Calcula la caja y adjunta el carrito.
   * @param {object | null} cart
   * @param {import('mongodb').ObjectId} userId
   */
  async #price(cart, userId) {
    const result = await this.#pricing.priceCart(cart, { userId });
    return { ...result, cart };
  }

  /**
   * Obtiene un producto activo o lanza 404.
   * @param {import('mongodb').ObjectId} id
   */
  async #requireProduct(id) {
    const product = await this.#products.findPublicById(id);
    if (!product || product.isActive === false) {
      throw HttpError.notFound('Producto no encontrado', 'PRODUCT_NOT_FOUND');
    }
    return product;
  }

  /**
   * Valida limite por linea y stock para una cantidad resultante.
   * @param {{ stock: number }} product
   * @param {import('mongodb').ObjectId} id
   * @param {number} quantity
   */
  #assertQuantity(product, id, quantity) {
    if (quantity > CART_LIMITS.MAX_QUANTITY_PER_LINE) {
      throw HttpError.unprocessable(
        `La cantidad por producto no puede superar ${CART_LIMITS.MAX_QUANTITY_PER_LINE}`,
        'QUANTITY_LIMIT',
      );
    }
    if (quantity > product.stock) throw HttpError.insufficientStock(product.stock, id.toString());
  }
}
