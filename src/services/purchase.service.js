/**
 * Servicio de compras a proveedores (Fase 3).
 *
 * createPurchase ejecuta una transaccion ACID (todo o nada):
 *   0) carga el proveedor (404 si no existe, 409 si esta inactivo) y los
 *      productos (422 si alguno no existe);
 *   1) por cada linea: ingreso de stock y nuevo costo unitario del producto
 *      (guardando el costo anterior) y actualizacion del costo en el catalogo
 *      del proveedor;
 *   2) numeracion correlativa de la compra y de la factura (misma secuencia
 *      "invoice" y mismo formato que el checkout);
 *   3) documento de compra (snapshot inmutable);
 *   4) factura contable con entityType "proveedor" enlazada a la compra.
 * El callback es idempotente y sin E/S externa: todo se escribe con la sesion.
 * La auditoria PURCHASE_CREATED se registra despues del commit.
 */
import { ObjectId } from 'mongodb';
import { INVOICE_ENTITY_TYPES, INVOICE_STATUSES, NIT_TYPES } from '../constants/commerce.js';
import { HttpError } from '../utils/http-error.js';
import { toObjectId } from '../utils/object-id.js';
import { AUDIT_ACTIONS } from './audit.service.js';

/** Prefijo y digitos del numero de compra (p. ej. PUR-000001). */
const PURCHASE_PREFIX = 'PUR';
const PURCHASE_DIGITS = 6;

/** Digitos del numero de factura: identico al checkout (PREFIJO-00000001). */
const INVOICE_DIGITS = 8;

/**
 * Formatea un numero correlativo con relleno de ceros.
 * @param {string} prefix
 * @param {number} seq
 * @param {number} digits
 */
const formatNumber = (prefix, seq, digits) => `${prefix}-${String(seq).padStart(digits, '0')}`;

export class PurchaseService {
  #suppliers;
  #inventory;
  #stock;
  #purchases;
  #invoices;
  #sequences;
  #transactions;
  #audit;
  #store;
  #now;

  /**
   * @param {{ supplierRepository: import('../repositories/supplier.repository.js').SupplierRepository,
   *           inventoryRepository: import('../repositories/inventory.repository.js').InventoryRepository,
   *           inventoryStockRepository: import('../repositories/inventory-stock.repository.js').InventoryStockRepository,
   *           purchaseRepository: import('../repositories/purchase.repository.js').PurchaseRepository,
   *           supplierInvoiceRepository: import('../repositories/supplier-invoice.repository.js').SupplierInvoiceRepository,
   *           sequenceRepository: import('../repositories/sequence.repository.js').SequenceRepository,
   *           transactionRunner: { run: (work: (session: object) => Promise<any>) => Promise<any> },
   *           auditService: import('./audit.service.js').AuditService,
   *           storeConfig?: { currency?: string, invoiceNumberPrefix?: string }, clock?: () => Date }} deps
   */
  constructor({
    supplierRepository,
    inventoryRepository,
    inventoryStockRepository,
    purchaseRepository,
    supplierInvoiceRepository,
    sequenceRepository,
    transactionRunner,
    auditService,
    storeConfig = {},
    clock = () => new Date(),
  }) {
    this.#suppliers = supplierRepository;
    this.#inventory = inventoryRepository;
    this.#stock = inventoryStockRepository;
    this.#purchases = purchaseRepository;
    this.#invoices = supplierInvoiceRepository;
    this.#sequences = sequenceRepository;
    this.#transactions = transactionRunner;
    this.#audit = auditService;
    this.#store = { currency: storeConfig.currency ?? 'GTQ', invoiceNumberPrefix: storeConfig.invoiceNumberPrefix ?? 'FAC' };
    this.#now = clock;
  }

  /**
   * Registra una compra a proveedor con ingreso de stock y factura automatica.
   * @param {{ id: string, role: string }} actor req.user
   * @param {import('../dtos/purchase.dto.js').CreatePurchaseDTO} dto
   * @param {{ ip?: string | null, userAgent?: string | null }} [context]
   * @returns {Promise<{ purchase: object, invoice: object }>}
   */
  async createPurchase(actor, dto, context = {}) {
    const supplierId = toObjectId(dto.supplierId);
    const lines = dto.items.map((item) => ({ ...item, productId: toObjectId(item.productId) }));
    const ids = lines.map((line) => line.productId.toString());
    if (new Set(ids).size !== ids.length) {
      throw HttpError.unprocessable('Hay productos repetidos en la compra', 'DUPLICATE_PRODUCTS');
    }
    const now = this.#now();
    const purchasedAt = dto.purchasedAt ?? now;
    if (purchasedAt.getTime() > now.getTime()) {
      throw HttpError.unprocessable('La fecha de compra no puede estar en el futuro', 'PURCHASE_DATE_IN_FUTURE');
    }
    const createdBy = actor?.id ? toObjectId(actor.id) : null;

    const result = await this.#transactions.run((session) =>
      this.#persistPurchase(session, { supplierId, lines, dto, now, purchasedAt, createdBy }),
    );

    await this.#audit.recordChange({
      actor,
      action: AUDIT_ACTIONS.PURCHASE_CREATED,
      targetCollection: 'purchases',
      targetId: result.purchase._id,
      previousState: null,
      newState: result.purchase,
      context,
      metadata: {
        purchaseNumber: result.purchase.purchaseNumber,
        invoiceId: result.invoice._id.toString(),
        invoiceNumber: result.invoice.invoiceNumber,
        totalCostCents: result.purchase.totalCostCents,
        stockChanges: result.stockChanges,
      },
    });
    return { purchase: result.purchase, invoice: result.invoice };
  }

  /**
   * Callback transaccional. Orden: proveedor -> productos -> stock/costos ->
   * catalogo -> numeracion -> compra -> factura.
   * @param {object} session
   * @param {{ supplierId: ObjectId, lines: object[], dto: object, now: Date, purchasedAt: Date, createdBy: ObjectId | null }} input
   */
  async #persistPurchase(session, { supplierId, lines, dto, now, purchasedAt, createdBy }) {
    // 0. Proveedor activo y productos existentes.
    const supplier = await this.#suppliers.findById(supplierId, { session });
    if (!supplier) throw HttpError.notFound('Proveedor no encontrado', 'SUPPLIER_NOT_FOUND');
    if (!supplier.isActive) throw HttpError.conflict('El proveedor esta inactivo', 'SUPPLIER_INACTIVE');

    const products = await this.#inventory.findManyByIds(lines.map((line) => line.productId), { session });
    const byId = new Map(products.map((product) => [product._id.toString(), product]));
    const missing = lines.filter((line) => !byId.has(line.productId.toString())).map((line) => line.productId.toString());
    if (missing.length > 0) {
      throw HttpError.unprocessable('Hay productos que no existen', 'PRODUCT_NOT_FOUND', { productIds: missing });
    }

    // 1. Ingreso de stock, nuevo costo y costo en el catalogo del proveedor.
    const items = [];
    const stockChanges = [];
    for (const line of lines) {
      const product = byId.get(line.productId.toString());
      const previousCostCents = product.costCents ?? null;
      const received = await this.#stock.receiveStock(line.productId, line.quantity, line.unitCostCents, { session, now });
      if (!received) {
        throw HttpError.unprocessable('Hay productos que no existen', 'PRODUCT_NOT_FOUND', { productIds: [line.productId.toString()] });
      }
      await this.#suppliers.upsertCatalogCost(supplierId, line.productId, line.unitCostCents, { session, now });

      items.push({
        productId: line.productId,
        sku: product.sku,
        name: product.name,
        quantity: line.quantity,
        unitCostCents: line.unitCostCents,
        previousCostCents,
        totalCents: line.unitCostCents * line.quantity,
      });
      stockChanges.push({
        productId: line.productId.toString(),
        quantity: line.quantity,
        previousStock: product.stock,
        newStock: product.stock + line.quantity,
        previousCostCents,
        newCostCents: line.unitCostCents,
      });
    }
    const totalCostCents = items.reduce((sum, item) => sum + item.totalCents, 0);

    // 2. Numeracion correlativa (se revierte con la transaccion).
    const purchaseNumber = formatNumber(PURCHASE_PREFIX, await this.#sequences.next('purchase', { session }), PURCHASE_DIGITS);
    const invoiceNumber = formatNumber(
      this.#store.invoiceNumberPrefix,
      await this.#sequences.next('invoice', { session }),
      INVOICE_DIGITS,
    );
    const purchaseId = new ObjectId();
    const invoiceId = new ObjectId();

    // 3. Compra (snapshot inmutable).
    const purchase = await this.#purchases.insert(
      {
        _id: purchaseId,
        purchaseNumber,
        supplierId,
        supplier: { supplierCode: supplier.supplierCode, name: supplier.name, nit: supplier.nit },
        items,
        totalCostCents,
        paymentMethod: dto.paymentMethod,
        invoiceId,
        supplierInvoiceNumber: dto.supplierInvoiceNumber ?? null,
        notes: dto.notes ?? null,
        createdBy,
        purchasedAt,
        createdAt: now,
        updatedAt: now,
      },
      { session },
    );

    // 4. Factura contable de proveedor.
    const invoice = await this.#invoices.insert(
      {
        _id: invoiceId,
        invoiceNumber,
        entityType: INVOICE_ENTITY_TYPES.SUPPLIER,
        supplierId,
        purchaseId,
        nit: supplier.nit,
        nitType: NIT_TYPES.NIT,
        entityName: supplier.name,
        email: supplier.email ?? null,
        paymentMethod: dto.paymentMethod,
        shippingAddress: null,
        items: items.map((item) => ({
          productId: item.productId,
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitPriceCents: item.unitCostCents,
          discountCents: 0,
          taxRatePercent: 0,
          taxCents: 0,
          totalCents: item.totalCents,
        })),
        currency: this.#store.currency,
        subtotalCents: totalCostCents,
        discountTotalCents: 0,
        taxTotalCents: 0,
        grandTotalCents: totalCostCents,
        status: INVOICE_STATUSES.PAID,
        issuedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      { session },
    );

    return { purchase, invoice, stockChanges };
  }

  /**
   * Listado paginado de compras.
   * @param {object} query ListPurchasesQueryDTO
   * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
   */
  async listPurchases(query) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const criteria = { page, limit, from: query.from, to: query.to };
    if (query.supplierId) criteria.supplierId = toObjectId(query.supplierId);
    const { items, total } = await this.#purchases.list(criteria);
    return { items, total, page, limit };
  }

  /**
   * Detalle de una compra con su factura de proveedor.
   * @param {string} id
   * @returns {Promise<{ purchase: object, invoice: object | null }>}
   */
  async getPurchase(id) {
    const purchase = await this.#purchases.findById(toObjectId(id));
    if (!purchase) throw HttpError.notFound('Compra no encontrada', 'PURCHASE_NOT_FOUND');
    const invoice = await this.#invoices.findById(purchase.invoiceId);
    return { purchase, invoice };
  }
}
