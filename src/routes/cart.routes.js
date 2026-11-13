/**
 * Rutas del carrito (/api/cart). Todas exigen sesion y el permiso cart:manage.
 *
 * | Metodo | Ruta              | Accion                     |
 * |--------|-------------------|----------------------------|
 * | GET    | /                 | ver carrito y caja         |
 * | POST   | /items            | agregar producto           |
 * | PATCH  | /items/:productId | cambiar cantidad           |
 * | DELETE | /items/:productId | quitar producto            |
 * | POST   | /coupon           | aplicar cupon              |
 * | DELETE | /coupon           | quitar cupon               |
 */
import { Router } from 'express';
import { PERMISSIONS } from '../constants/permissions.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import {
  addCartItemSchema,
  applyCouponSchema,
  productIdParamSchema,
  updateCartItemSchema,
} from '../validators/cart.validator.js';

/**
 * @param {{ cartController: import('../controllers/cart.controller.js').CartController,
 *           authenticate: import('express').RequestHandler }} deps
 * @returns {Router}
 */
export function createCartRoutes({ cartController, authenticate }) {
  const router = Router();
  const manage = authorize(PERMISSIONS.CART_MANAGE);
  const validProduct = validate(productIdParamSchema, 'params');

  router.use(authenticate);
  router.use(manage);

  router.get('/', cartController.get);
  router.post('/items', validate(addCartItemSchema), cartController.addItem);
  router.patch('/items/:productId', validProduct, validate(updateCartItemSchema), cartController.updateItem);
  router.delete('/items/:productId', validProduct, cartController.removeItem);
  router.post('/coupon', validate(applyCouponSchema), cartController.applyCoupon);
  router.delete('/coupon', cartController.removeCoupon);

  return router;
}
