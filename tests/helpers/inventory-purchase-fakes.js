/**
 * Dobles en memoria para probar inventario, mermas, compras a proveedores y
 * proveedores (Fase 3, parte B) sin MongoDB.
 *
 * Cada repositorio implementa el contrato publico del real, expone
 * snapshot()/restore() para participar en InMemoryTransactionRunner y exige la
 * sesion en las escrituras transaccionales. InMemoryInventoryRepository lee los
 * productos del mismo InMemoryInventoryStockRepository, de modo que ambos ven
 * siempre el mismo estado (como en MongoDB, donde comparten coleccion).
 */
import { ObjectId } from 'mongodb';
import { InMemoryTransactionRunner, InMemorySequenceRepository, deepClone } from './checkout-fakes.js';
import { InMemoryInventoryStockRepository, RecordingAuditService } from './admin-fakes.js';

/**
 * Falla si una escritura transaccional llega sin sesion.
 * @param {object | undefined} session
 * @param {string} operation
 */
function assertSession(session, operation) {
  if (!session) throw new Error(`${operation} se invoco sin la sesion de la transaccion`);
}

/** Error equivalente al de un indice unico violado en MongoDB. */
const duplicateKeyError = (keyValue) => Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyValue });

/**
 * Pagina un arreglo de documentos (copias).
 * @param {object[]} items
 * @param {{ page?: number, limit?: number }} criteria
 */
const paginate = (items, { page = 1, limit = 20 }) => ({
  items: items.slice((page - 1) * limit, page * limit).map(deepClone),
  total: items.length,
});

/** Base comun: Map de documentos por id con snapshot/restore. */
class InMemoryCollection {
  /** @type {Map<string, object>} */
  docs = new Map();

  /** @param {object[]} [seed] */
  constructor(seed = []) {
    for (const doc of seed) this.docs.set(doc._id.toString(), deepClone(doc));
  }

  snapshot() {
    return new Map([...this.docs].map(([key, doc]) => [key, deepClone(doc)]));
  }

  /** @param {Map<string, object>} snapshot */
  restore(snapshot) {
    this.docs = new Map([...snapshot].map(([key, doc]) => [key, deepClone(doc)]));
  }

  /** Todos los documentos (copias). */
  all() {
    return [...this.docs.values()].map(deepClone);
  }

  /** @param {unknown} id */
  peek(id) {
    return this.docs.get(id.toString());
  }
}

/** Consultas administrativas de productos sobre el almacen de InMemoryInventoryStockRepository. */
export class InMemoryInventoryRepository {
  #stock;
  #suppliers;

  /**
   * @param {InMemoryInventoryStockRepository} stockRepository Fuente de los productos.
   * @param {InMemorySupplierRepository} [supplierRepository] Para el $lookup del detalle.
   */
  constructor(stockRepository, supplierRepository = undefined) {
    this.#stock = stockRepository;
    this.#suppliers = supplierRepository;
  }

  async findById(id) {
    const doc = this.#stock.docs.get(id.toString());
    return doc ? deepClone(doc) : null;
  }

  async findManyByIds(ids) {
    const wanted = new Set(ids.map((id) => id.toString()));
    return [...this.#stock.docs.values()].filter((doc) => wanted.has(doc._id.toString())).map(deepClone);
  }

  async findDetailById(id) {
    const doc = this.#stock.docs.get(id.toString());
    if (!doc) return null;
    const supplier = doc.supplierId ? this.#suppliers?.peek(doc.supplierId) : null;
    return { ...deepClone(doc), supplier: supplier ? deepClone(supplier) : null };
  }

  async list(criteria) {
    const items = [...this.#stock.docs.values()].filter(
      (doc) =>
        (!criteria.productName || doc.name.toLowerCase().includes(criteria.productName.toLowerCase())) &&
        (!criteria.supplierId || doc.supplierId?.equals(criteria.supplierId)) &&
        (!criteria.category || doc.category === criteria.category) &&
        (criteria.minPriceCents === undefined || doc.priceCents >= criteria.minPriceCents) &&
        (criteria.maxPriceCents === undefined || doc.priceCents <= criteria.maxPriceCents),
    );
    return paginate(items, criteria);
  }
}

export class InMemoryInventoryLossRepository extends InMemoryCollection {
  async insert(doc, { session } = {}) {
    assertSession(session, 'loss.insert');
    const stored = deepClone({ ...doc, _id: doc._id ?? new ObjectId() });
    this.docs.set(stored._id.toString(), stored);
    return deepClone(stored);
  }

  async list(criteria) {
    const items = [...this.docs.values()].filter(
      (doc) => (!criteria.productId || doc.productId.equals(criteria.productId)) && (!criteria.reason || doc.reason === criteria.reason),
    );
    return paginate(items, criteria);
  }
}

export class InMemoryPurchaseRepository extends InMemoryCollection {
  async insert(doc, { session } = {}) {
    assertSession(session, 'purchase.insert');
    const stored = deepClone({ ...doc, _id: doc._id ?? new ObjectId() });
    this.docs.set(stored._id.toString(), stored);
    return deepClone(stored);
  }

  async findById(id) {
    const doc = this.docs.get(id.toString());
    return doc ? deepClone(doc) : null;
  }

  async countBySupplier(supplierId) {
    return [...this.docs.values()].filter((doc) => doc.supplierId.equals(supplierId)).length;
  }

  async list(criteria) {
    const items = [...this.docs.values()].filter((doc) => !criteria.supplierId || doc.supplierId.equals(criteria.supplierId));
    return paginate(items, criteria);
  }
}

export class InMemorySupplierInvoiceRepository extends InMemoryCollection {
  /** Si es true, insert lanza (simula un fallo al generar la factura). */
  failInsert = false;

  async insert(doc, { session } = {}) {
    assertSession(session, 'supplierInvoice.insert');
    if (this.failInsert) throw new Error('Fallo simulado al insertar la factura');
    const stored = deepClone({ ...doc, _id: doc._id ?? new ObjectId() });
    this.docs.set(stored._id.toString(), stored);
    return deepClone(stored);
  }

  async findById(id) {
    const doc = this.docs.get(id.toString());
    return doc ? deepClone(doc) : null;
  }
}

export class InMemorySupplierRepository extends InMemoryCollection {
  async insert(doc, { session } = {}) {
    assertSession(session, 'supplier.insert');
    const clash = [...this.docs.values()].find((other) => other.nit === doc.nit || other.supplierCode === doc.supplierCode);
    if (clash) throw duplicateKeyError(clash.nit === doc.nit ? { nit: doc.nit } : { supplierCode: doc.supplierCode });
    const stored = deepClone({ ...doc, _id: doc._id ?? new ObjectId() });
    this.docs.set(stored._id.toString(), stored);
    return deepClone(stored);
  }

  async findById(id) {
    const doc = this.docs.get(id.toString());
    return doc ? deepClone(doc) : null;
  }

  async findByNit(nit) {
    const doc = [...this.docs.values()].find((supplier) => supplier.nit === nit);
    return doc ? deepClone(doc) : null;
  }

  async findDetailById(id) {
    const doc = this.docs.get(id.toString());
    return doc ? deepClone({ ...doc, catalog: doc.catalog.map((entry) => ({ ...entry, product: null })) }) : null;
  }

  async list(criteria) {
    const items = [...this.docs.values()].filter(
      (doc) =>
        (!criteria.supplierCode || doc.supplierCode.startsWith(criteria.supplierCode)) &&
        (!criteria.name || doc.name.toLowerCase().includes(criteria.name.toLowerCase())) &&
        (criteria.isActive === undefined || doc.isActive === criteria.isActive),
    );
    return paginate(items, criteria);
  }

  async updateById(id, changes, now) {
    const doc = this.docs.get(id.toString());
    if (!doc) return null;
    if (changes.nit && [...this.docs.values()].some((other) => other !== doc && other.nit === changes.nit)) {
      throw duplicateKeyError({ nit: changes.nit });
    }
    Object.assign(doc, deepClone(changes), { updatedAt: now });
    return deepClone(doc);
  }

  async upsertCatalogCost(supplierId, productId, costCents, { session, now } = {}) {
    assertSession(session, 'supplier.upsertCatalogCost');
    const doc = this.docs.get(supplierId.toString());
    if (!doc) return false;
    const entry = doc.catalog.find((item) => item.productId.equals(productId));
    if (entry) entry.costCents = costCents;
    else doc.catalog.push({ productId, costCents });
    doc.updatedAt = now ?? new Date();
    return true;
  }

  async deleteById(id, { session } = {}) {
    assertSession(session, 'supplier.deleteById');
    return this.docs.delete(id.toString());
  }
}

/**
 * Proveedor completo valido segun suppliers.schema.js.
 * @param {Partial<object>} overrides
 */
export function makeSupplier(overrides = {}) {
  const suffix = String(Math.floor(Math.random() * 900000) + 100000);
  return {
    _id: new ObjectId(),
    supplierCode: `PRV-${suffix}`,
    name: `Distribuidora ${suffix}`,
    nit: `${suffix}-7`,
    address: '6a Avenida 1-20 zona 4, Guatemala',
    phone: '+502 2222-3333',
    email: `ventas${suffix}@proveedor.example.com`,
    contactName: 'Luis Gomez',
    distributionDescription: 'Distribucion semanal en la capital',
    catalog: [],
    isActive: true,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Construye los repositorios en memoria, el runner transaccional y la auditoria.
 * @param {{ products?: object[], suppliers?: object[], purchases?: object[] }} [seed]
 */
export function makeInventoryPurchaseDeps({ products = [], suppliers = [], purchases = [] } = {}) {
  const inventoryStockRepository = new InMemoryInventoryStockRepository(products);
  const supplierRepository = new InMemorySupplierRepository(suppliers);
  const inventoryRepository = new InMemoryInventoryRepository(inventoryStockRepository, supplierRepository);
  const inventoryLossRepository = new InMemoryInventoryLossRepository();
  const purchaseRepository = new InMemoryPurchaseRepository(purchases);
  const supplierInvoiceRepository = new InMemorySupplierInvoiceRepository();
  const sequenceRepository = new InMemorySequenceRepository();
  const transactionRunner = new InMemoryTransactionRunner([
    inventoryStockRepository,
    supplierRepository,
    inventoryLossRepository,
    purchaseRepository,
    supplierInvoiceRepository,
    sequenceRepository,
  ]);
  const auditService = new RecordingAuditService();
  return {
    inventoryStockRepository,
    supplierRepository,
    inventoryRepository,
    inventoryLossRepository,
    purchaseRepository,
    supplierInvoiceRepository,
    sequenceRepository,
    transactionRunner,
    auditService,
  };
}
