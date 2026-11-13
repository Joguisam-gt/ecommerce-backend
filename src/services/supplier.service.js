/**
 * Servicio de proveedores (Fase 3).
 *
 * - Alta con supplierCode asignado por el sistema (secuencia "supplier" ->
 *   PRV-000001) dentro de una transaccion, NIT unico (409) y catalogo con
 *   productos existentes (422).
 * - Consulta con filtros y detalle con catalogo enriquecido.
 * - Actualizacion (nunca del supplierCode), baja logica (isActive false) y
 *   borrado fisico reservado al permiso records:hard_delete (superusuario) y
 *   solo si el proveedor no tiene compras registradas (409).
 * Toda mutacion se audita despues de confirmarse, con previousState/newState.
 */
import { PERMISSIONS, hasPermission } from '../constants/permissions.js';
import { HttpError } from '../utils/http-error.js';
import { toObjectId } from '../utils/object-id.js';
import { AUDIT_ACTIONS } from './audit.service.js';

const TARGET_COLLECTION = 'suppliers';

/** Codigo de MongoDB para violacion de indice unico. */
const MONGO_DUPLICATE_KEY = 11000;

/** Prefijo y digitos del codigo de proveedor (PRV-000001). */
const CODE_PREFIX = 'PRV';
const CODE_DIGITS = 6;

/** 409 de NIT ya registrado. */
const nitInUse = () => HttpError.conflict('Ya existe un proveedor con ese NIT', 'SUPPLIER_NIT_IN_USE');

/**
 * Traduce un error de indice unico (NIT) a 409; relanza cualquier otro.
 * @param {any} error
 */
function rethrowDuplicate(error) {
  if (error?.code === MONGO_DUPLICATE_KEY) throw nitInUse();
  throw error;
}

export class SupplierService {
  #suppliers;
  #inventory;
  #purchases;
  #sequences;
  #transactions;
  #audit;
  #now;

  /**
   * @param {{ supplierRepository: import('../repositories/supplier.repository.js').SupplierRepository,
   *           inventoryRepository: import('../repositories/inventory.repository.js').InventoryRepository,
   *           purchaseRepository: import('../repositories/purchase.repository.js').PurchaseRepository,
   *           sequenceRepository: import('../repositories/sequence.repository.js').SequenceRepository,
   *           transactionRunner: { run: (work: (session: object) => Promise<any>) => Promise<any> },
   *           auditService: import('./audit.service.js').AuditService, clock?: () => Date }} deps
   */
  constructor({ supplierRepository, inventoryRepository, purchaseRepository, sequenceRepository, transactionRunner, auditService, clock = () => new Date() }) {
    this.#suppliers = supplierRepository;
    this.#inventory = inventoryRepository;
    this.#purchases = purchaseRepository;
    this.#sequences = sequenceRepository;
    this.#transactions = transactionRunner;
    this.#audit = auditService;
    this.#now = clock;
  }

  /**
   * Alta de proveedor.
   * @param {{ id: string, role: string }} actor
   * @param {import('../dtos/supplier.dto.js').CreateSupplierDTO} dto
   * @param {object} [context]
   */
  async createSupplier(actor, dto, context = {}) {
    if (await this.#suppliers.findByNit(dto.nit)) throw nitInUse();
    const catalog = await this.#resolveCatalog(dto.catalog);
    const now = this.#now();

    const supplier = await this.#transactions
      .run(async (session) => {
        const seq = await this.#sequences.next('supplier', { session });
        return this.#suppliers.insert(
          {
            supplierCode: `${CODE_PREFIX}-${String(seq).padStart(CODE_DIGITS, '0')}`,
            name: dto.name,
            nit: dto.nit,
            address: dto.address ?? null,
            phone: dto.phone ?? null,
            email: dto.email ?? null,
            contactName: dto.contactName ?? null,
            distributionDescription: dto.distributionDescription ?? null,
            catalog,
            isActive: true,
            createdBy: actor?.id ? toObjectId(actor.id) : null,
            createdAt: now,
            updatedAt: now,
          },
          { session },
        );
      })
      .catch(rethrowDuplicate);

    await this.#audit.recordChange({
      actor,
      action: AUDIT_ACTIONS.SUPPLIER_CREATED,
      targetCollection: TARGET_COLLECTION,
      targetId: supplier._id,
      previousState: null,
      newState: supplier,
      context,
      metadata: { supplierCode: supplier.supplierCode, nit: supplier.nit },
    });
    return supplier;
  }

  /**
   * Listado paginado con filtros.
   * @param {object} query ListSuppliersQueryDTO
   */
  async listSuppliers(query) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.#suppliers.list({
      page,
      limit,
      supplierCode: query.supplierCode,
      name: query.name,
      address: query.address,
      isActive: query.isActive,
    });
    return { items, total, page, limit };
  }

  /**
   * Detalle con catalogo enriquecido.
   * @param {string} id
   */
  async getSupplier(id) {
    const supplier = await this.#suppliers.findDetailById(toObjectId(id));
    if (!supplier) throw HttpError.notFound('Proveedor no encontrado', 'SUPPLIER_NOT_FOUND');
    return supplier;
  }

  /**
   * Actualizacion parcial (el supplierCode nunca cambia).
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {object} changes UpdateSupplierDTO
   * @param {object} [context]
   */
  async updateSupplier(actor, id, changes, context = {}) {
    const current = await this.#findOrFail(id);
    const { supplierCode: _ignored, ...safeChanges } = changes;
    if (safeChanges.nit && safeChanges.nit !== current.nit) {
      const other = await this.#suppliers.findByNit(safeChanges.nit);
      if (other && !other._id.equals(current._id)) throw nitInUse();
    }
    if (safeChanges.catalog !== undefined) safeChanges.catalog = await this.#resolveCatalog(safeChanges.catalog);

    const updated = await this.#suppliers.updateById(current._id, safeChanges, this.#now()).catch(rethrowDuplicate);
    if (!updated) throw HttpError.notFound('Proveedor no encontrado', 'SUPPLIER_NOT_FOUND');

    await this.#audit.recordChange({
      actor,
      action: AUDIT_ACTIONS.SUPPLIER_UPDATED,
      targetCollection: TARGET_COLLECTION,
      targetId: current._id,
      previousState: current,
      newState: updated,
      context,
      metadata: { fields: Object.keys(safeChanges) },
    });
    return updated;
  }

  /**
   * Baja logica (isActive false). Idempotente: si ya esta inactivo no hay cambio ni auditoria.
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {object} [context]
   */
  async deactivateSupplier(actor, id, context = {}) {
    const current = await this.#findOrFail(id);
    if (!current.isActive) return current;

    const updated = await this.#suppliers.updateById(current._id, { isActive: false }, this.#now());
    if (!updated) throw HttpError.notFound('Proveedor no encontrado', 'SUPPLIER_NOT_FOUND');

    await this.#audit.recordChange({
      actor,
      action: AUDIT_ACTIONS.SUPPLIER_DEACTIVATED,
      targetCollection: TARGET_COLLECTION,
      targetId: current._id,
      previousState: current,
      newState: updated,
      context,
    });
    return updated;
  }

  /**
   * Borrado fisico: solo con records:hard_delete y sin compras registradas.
   * El conteo y el borrado comparten transaccion: una compra concurrente
   * (que escribe en el catalogo del proveedor) provoca conflicto de escritura.
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {object} [context]
   */
  async deleteSupplier(actor, id, context = {}) {
    if (!hasPermission(actor?.role, PERMISSIONS.RECORDS_HARD_DELETE)) {
      throw HttpError.forbidden('El borrado fisico esta reservado al superusuario', 'HARD_DELETE_FORBIDDEN');
    }
    const supplierId = toObjectId(id);

    const previous = await this.#transactions.run(async (session) => {
      const current = await this.#suppliers.findById(supplierId, { session });
      if (!current) throw HttpError.notFound('Proveedor no encontrado', 'SUPPLIER_NOT_FOUND');
      const purchases = await this.#purchases.countBySupplier(supplierId, { session });
      if (purchases > 0) {
        throw HttpError.conflict('El proveedor tiene compras registradas: desactivalo en su lugar', 'SUPPLIER_HAS_PURCHASES');
      }
      await this.#suppliers.deleteById(supplierId, { session });
      return current;
    });

    await this.#audit.recordChange({
      actor,
      action: AUDIT_ACTIONS.SUPPLIER_DELETED,
      targetCollection: TARGET_COLLECTION,
      targetId: supplierId,
      previousState: previous,
      newState: null,
      context,
      metadata: { supplierCode: previous.supplierCode, nit: previous.nit },
    });
  }

  /**
   * Proveedor por id o 404.
   * @param {string} id
   */
  async #findOrFail(id) {
    const supplier = await this.#suppliers.findById(toObjectId(id));
    if (!supplier) throw HttpError.notFound('Proveedor no encontrado', 'SUPPLIER_NOT_FOUND');
    return supplier;
  }

  /**
   * Convierte el catalogo de entrada a ObjectId y verifica que no haya
   * productos repetidos ni inexistentes.
   * @param {Array<{ productId: string, costCents: number }>} catalog
   * @returns {Promise<Array<{ productId: import('mongodb').ObjectId, costCents: number }>>}
   */
  async #resolveCatalog(catalog = []) {
    const entries = catalog.map((entry) => ({ productId: toObjectId(entry.productId), costCents: entry.costCents }));
    const ids = entries.map((entry) => entry.productId.toString());
    if (new Set(ids).size !== ids.length) {
      throw HttpError.unprocessable('Hay productos repetidos en el catalogo', 'DUPLICATE_PRODUCTS');
    }
    if (entries.length === 0) return entries;

    const found = await this.#inventory.findManyByIds(entries.map((entry) => entry.productId));
    const existing = new Set(found.map((product) => product._id.toString()));
    const missing = ids.filter((productId) => !existing.has(productId));
    if (missing.length > 0) {
      throw HttpError.unprocessable('Hay productos del catalogo que no existen', 'PRODUCT_NOT_FOUND', { productIds: missing });
    }
    return entries;
  }
}
