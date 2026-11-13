/**
 * Controlador de inventario del panel (Fase 3): listado y detalle de
 * productos, registro y listado de mermas. Solo adapta HTTP al servicio.
 */
import {
  InventoryLossDTO,
  InventoryProductDTO,
  InventoryProductDetailDTO,
  ListInventoryQueryDTO,
  ListLossesQueryDTO,
  RecordLossDTO,
} from '../dtos/inventory.dto.js';
import { requestContext } from '../utils/request-context.js';

/**
 * Metadatos de paginacion.
 * @param {{ total: number, page: number, limit: number }} result
 */
const pageMeta = ({ total, page, limit }) => ({ total, page, limit, totalPages: Math.ceil(total / limit) });

export class InventoryController {
  #inventory;

  /** @param {{ inventoryService: import('../services/inventory.service.js').InventoryService }} deps */
  constructor({ inventoryService }) {
    this.#inventory = inventoryService;
  }

  /** GET /admin/inventory */
  list = async (req, res) => {
    const result = await this.#inventory.listProducts(ListInventoryQueryDTO.from(req.query));
    res.json({ data: InventoryProductDTO.fromMany(result.items), meta: pageMeta(result) });
  };

  /** GET /admin/inventory/:id */
  getById = async (req, res) => {
    const product = await this.#inventory.getProduct(req.params.id);
    res.json({ data: InventoryProductDetailDTO.from(product), meta: {} });
  };

  /** POST /admin/inventory/losses */
  recordLoss = async (req, res) => {
    const { loss, previousStock, newStock } = await this.#inventory.recordLoss(
      req.user,
      RecordLossDTO.from(req.body),
      requestContext(req),
    );
    res.status(201).json({ data: InventoryLossDTO.from(loss), meta: { previousStock, newStock } });
  };

  /** GET /admin/inventory/losses */
  listLosses = async (req, res) => {
    const result = await this.#inventory.listLosses(ListLossesQueryDTO.from(req.query));
    res.json({ data: InventoryLossDTO.fromMany(result.items), meta: pageMeta(result) });
  };
}
