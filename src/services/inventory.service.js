/**
 * Servicio de inventario del panel de administracion (Fase 3).
 *
 * - Listado y detalle de productos con costo, precios y proveedor.
 * - Registro de mermas (vencimiento o dano) en una transaccion ACID: baja
 *   condicional de stock (nunca negativo) e insercion del registro de perdida
 *   con el costo unitario congelado. Si no hay stock suficiente se lanza 409
 *   INSUFFICIENT_STOCK y la transaccion se revierte.
 * - Listado de mermas para reportes.
 * La auditoria se registra DESPUES del commit.
 */
import { HttpError } from '../utils/http-error.js';
import { toCents } from '../utils/money.js';
import { toObjectId } from '../utils/object-id.js';
import { AUDIT_ACTIONS } from './audit.service.js';

/** Coleccion objetivo de la auditoria de mermas (cambia el stock del producto). */
const TARGET_COLLECTION = 'products';

export class InventoryService {
  #inventory;
  #stock;
  #losses;
  #transactions;
  #audit;
  #now;

  /**
   * @param {{ inventoryRepository: import('../repositories/inventory.repository.js').InventoryRepository,
   *           inventoryStockRepository: import('../repositories/inventory-stock.repository.js').InventoryStockRepository,
   *           inventoryLossRepository: import('../repositories/inventory-loss.repository.js').InventoryLossRepository,
   *           transactionRunner: { run: (work: (session: object) => Promise<any>) => Promise<any> },
   *           auditService: import('./audit.service.js').AuditService, clock?: () => Date }} deps
   */
  constructor({ inventoryRepository, inventoryStockRepository, inventoryLossRepository, transactionRunner, auditService, clock = () => new Date() }) {
    this.#inventory = inventoryRepository;
    this.#stock = inventoryStockRepository;
    this.#losses = inventoryLossRepository;
    this.#transactions = transactionRunner;
    this.#audit = auditService;
    this.#now = clock;
  }

  /**
   * Listado paginado con filtros dinamicos.
   * @param {object} query ListInventoryQueryDTO
   * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
   */
  async listProducts(query) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const criteria = {
      page,
      limit,
      sort: query.sort,
      productName: query.productName,
      category: query.category,
      isActive: query.isActive,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
    };
    if (query.supplierId) criteria.supplierId = toObjectId(query.supplierId);
    if (query.minPrice !== undefined) criteria.minPriceCents = toCents(query.minPrice);
    if (query.maxPrice !== undefined) criteria.maxPriceCents = toCents(query.maxPrice);

    const { items, total } = await this.#inventory.list(criteria);
    return { items, total, page, limit };
  }

  /**
   * Detalle de un producto con datos del proveedor.
   * @param {string} id
   */
  async getProduct(id) {
    const product = await this.#inventory.findDetailById(toObjectId(id));
    if (!product) throw HttpError.notFound('Producto no encontrado', 'PRODUCT_NOT_FOUND');
    return product;
  }

  /**
   * Registra una merma de inventario.
   * @param {{ id: string, role: string }} actor req.user
   * @param {import('../dtos/inventory.dto.js').RecordLossDTO} dto
   * @param {{ ip?: string | null, userAgent?: string | null }} [context]
   * @returns {Promise<{ loss: object, previousStock: number, newStock: number }>}
   */
  async recordLoss(actor, dto, context = {}) {
    const productId = toObjectId(dto.productId);
    const now = this.#now();
    const occurredAt = dto.occurredAt ?? now;
    if (occurredAt.getTime() > now.getTime()) {
      throw HttpError.unprocessable('La fecha de la merma no puede estar en el futuro', 'LOSS_DATE_IN_FUTURE');
    }
    const recordedBy = actor?.id ? toObjectId(actor.id) : null;

    const result = await this.#transactions.run(async (session) => {
      const product = await this.#inventory.findById(productId, { session });
      if (!product) throw HttpError.notFound('Producto no encontrado', 'PRODUCT_NOT_FOUND');

      // Baja condicional: solo si stock >= cantidad.
      const decremented = await this.#stock.decrementStock(productId, dto.quantity, { session, now });
      if (!decremented) throw HttpError.insufficientStock(product.stock, productId.toString());

      const unitCostCents = product.costCents ?? 0;
      const loss = await this.#losses.insert(
        {
          productId,
          sku: product.sku,
          productName: product.name,
          category: product.category,
          supplierId: product.supplierId ?? null,
          quantity: dto.quantity,
          reason: dto.reason,
          unitCostCents,
          totalLossCents: unitCostCents * dto.quantity,
          notes: dto.notes ?? null,
          recordedBy,
          occurredAt,
          createdAt: now,
        },
        { session },
      );
      return { loss, previousStock: product.stock, newStock: product.stock - dto.quantity };
    });

    await this.#audit.recordChange({
      actor,
      action: AUDIT_ACTIONS.INVENTORY_LOSS_RECORDED,
      targetCollection: TARGET_COLLECTION,
      targetId: productId,
      previousState: { stock: result.previousStock },
      newState: { stock: result.newStock },
      context,
      metadata: {
        lossId: result.loss._id.toString(),
        reason: result.loss.reason,
        quantity: result.loss.quantity,
        unitCostCents: result.loss.unitCostCents,
        totalLossCents: result.loss.totalLossCents,
      },
    });
    return result;
  }

  /**
   * Listado de mermas para reportes.
   * @param {object} query ListLossesQueryDTO
   * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
   */
  async listLosses(query) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const criteria = { page, limit, reason: query.reason, from: query.from, to: query.to };
    if (query.productId) criteria.productId = toObjectId(query.productId);
    const { items, total } = await this.#losses.list(criteria);
    return { items, total, page, limit };
  }
}
