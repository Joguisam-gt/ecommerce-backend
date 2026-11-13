/**
 * Controlador de compras a proveedores (Fase 3): alta con factura
 * automatica, listado y detalle. Solo adapta HTTP al servicio.
 */
import { CreatePurchaseDTO, ListPurchasesQueryDTO, PurchaseDTO } from '../dtos/purchase.dto.js';
import { requestContext } from '../utils/request-context.js';

export class PurchaseController {
  #purchases;

  /** @param {{ purchaseService: import('../services/purchase.service.js').PurchaseService }} deps */
  constructor({ purchaseService }) {
    this.#purchases = purchaseService;
  }

  /** POST /admin/purchases */
  create = async (req, res) => {
    const { purchase, invoice } = await this.#purchases.createPurchase(
      req.user,
      CreatePurchaseDTO.from(req.body),
      requestContext(req),
    );
    res
      .status(201)
      .location(`${req.baseUrl}/${purchase._id}`)
      .json({ data: PurchaseDTO.from(purchase, invoice), meta: {} });
  };

  /** GET /admin/purchases */
  list = async (req, res) => {
    const { items, total, page, limit } = await this.#purchases.listPurchases(ListPurchasesQueryDTO.from(req.query));
    res.json({ data: PurchaseDTO.fromMany(items), meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  };

  /** GET /admin/purchases/:id */
  getById = async (req, res) => {
    const { purchase, invoice } = await this.#purchases.getPurchase(req.params.id);
    res.json({ data: PurchaseDTO.from(purchase, invoice), meta: {} });
  };
}
