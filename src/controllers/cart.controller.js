/**
 * Controlador del carrito: adapta HTTP al servicio y responde con CartDTO.
 */
import { AddCartItemDTO, ApplyCouponDTO, CartDTO, UpdateCartItemDTO } from '../dtos/cart.dto.js';

export class CartController {
  #cart;
  #currency;

  /** @param {{ cartService: import('../services/cart.service.js').CartService, storeConfig: { currency: string } }} deps */
  constructor({ cartService, storeConfig }) {
    this.#cart = cartService;
    this.#currency = storeConfig.currency;
  }

  /** @param {object} result Resultado de CartService. */
  #respond(result) {
    return { data: CartDTO.from(result, { currency: this.#currency }) };
  }

  /** GET /cart */
  get = async (req, res) => {
    res.json(this.#respond(await this.#cart.getCart(req.user)));
  };

  /** POST /cart/items */
  addItem = async (req, res) => {
    res.status(201).json(this.#respond(await this.#cart.addItem(req.user, AddCartItemDTO.from(req.body))));
  };

  /** PATCH /cart/items/:productId */
  updateItem = async (req, res) => {
    const { quantity } = UpdateCartItemDTO.from(req.body);
    res.json(this.#respond(await this.#cart.updateItemQuantity(req.user, req.params.productId, quantity)));
  };

  /** DELETE /cart/items/:productId */
  removeItem = async (req, res) => {
    res.json(this.#respond(await this.#cart.removeItem(req.user, req.params.productId)));
  };

  /** POST /cart/coupon */
  applyCoupon = async (req, res) => {
    const { code } = ApplyCouponDTO.from(req.body);
    res.json(this.#respond(await this.#cart.applyCoupon(req.user, code)));
  };

  /** DELETE /cart/coupon */
  removeCoupon = async (req, res) => {
    res.json(this.#respond(await this.#cart.removeCoupon(req.user)));
  };
}
