/**
 * Rutas publicas del catalogo (/api/store). Sin autenticacion.
 *
 * | Metodo | Ruta            | Descripcion                        |
 * |--------|-----------------|------------------------------------|
 * | GET    | /products       | Listado con filtros y paginacion   |
 * | GET    | /products/:id   | Detalle de un producto activo      |
 */
import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { idParamSchema, listProductsQuerySchema } from '../validators/store.validator.js';

/**
 * @param {{ storeController: import('../controllers/store.controller.js').StoreController }} deps
 * @returns {Router}
 */
export function createStoreRoutes({ storeController }) {
  const router = Router();
  router.get('/products', validate(listProductsQuerySchema, 'query'), storeController.list);
  router.get('/products/:id', validate(idParamSchema, 'params'), storeController.getById);
  return router;
}
