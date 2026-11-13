/**
 * Dobles en memoria del modulo de superusuario (Fase 4).
 *
 * - FakeTransactionRunner: ejecuta el callback con una sesion falsa, revierte a
 *   los participantes (snapshot/restore) si lanza y, como withTransaction,
 *   reintenta ante errores con la etiqueta TransientTransactionError. Puede
 *   simular N conflictos de escritura y ejecutar un gancho antes de cada
 *   reintento (la transaccion concurrente "ganadora").
 * - TransactionalUserRepository / TransactionalAuditLogRepository: amplian los
 *   dobles de la Fase 1 exigiendo la sesion en las escrituras transaccionales.
 * - InMemorySystemSettingsRepository: valida cada documento contra el
 *   $jsonSchema real de system_settings.
 * - InMemoryPurgeDatabase + repositorios de purga y referencias fiscales.
 * - makeSuperuserHarness: monta todo lo anterior con los servicios reales.
 */
import { ObjectId } from 'mongodb';
import { ALL_PURGEABLE_COLLECTIONS } from '../../src/constants/superuser.js';
import { SYSTEM_SETTINGS_ID } from '../../src/constants/settings.js';
import { systemSettingsCollection } from '../../src/database/schemas/system-settings.schema.js';
import { buildAuditSearchFilter } from '../../src/repositories/audit-log.repository.js';
import { buildSettingsUpsert } from '../../src/repositories/system-settings.repository.js';
import { AuditService } from '../../src/services/audit.service.js';
import { PasswordService } from '../../src/services/password.service.js';
import { PurgeService } from '../../src/services/purge.service.js';
import { SettingsService } from '../../src/services/settings.service.js';
import { StaffService } from '../../src/services/staff.service.js';
import { silentLogger } from '../../src/utils/logger.js';
import { InMemorySequenceRepository, deepClone, jsonSchemaErrors } from './checkout-fakes.js';
import { InMemoryAuditLogRepository, InMemoryUserRepository } from './in-memory-repositories.js';

/** Instante fijo de las pruebas. */
export const NOW = new Date('2026-11-12T10:00:00Z');

/**
 * Falla si una escritura transaccional llega sin sesion.
 * @param {object | undefined} session
 * @param {string} operation
 */
function assertSession(session, operation) {
  if (!session) throw new Error(`${operation} se invoco sin la sesion de la transaccion`);
}

/**
 * Error transitorio simulado (equivale a un WriteConflict de MongoDB).
 * @returns {Error}
 */
export function transientConflict() {
  return Object.assign(new Error('WriteConflict simulado'), { code: 112, errorLabels: ['TransientTransactionError'] });
}

export class FakeTransactionRunner {
  /** @type {Array<{ snapshot(): unknown, restore(s: unknown): void }>} */
  #participants;

  /** Conflictos transitorios a simular al confirmar (cada uno revierte y reintenta). */
  conflictsBeforeCommit = 0;

  /** Gancho opcional antes de cada reintento: aplica los cambios de la transaccion concurrente que gano. */
  beforeRetry = null;

  /** Sesiones entregadas (una por intento). */
  sessions = [];

  stats = { started: 0, committed: 0, rolledBack: 0, retries: 0 };

  /** @param {Array<{ snapshot(): unknown, restore(s: unknown): void }>} [participants] */
  constructor(participants = []) {
    this.#participants = participants;
  }

  /**
   * @template T
   * @param {(session: object) => Promise<T>} work
   * @returns {Promise<T>}
   */
  async run(work) {
    for (;;) {
      const snapshots = this.#participants.map((participant) => participant.snapshot());
      const session = Object.freeze({ id: new ObjectId(), inTransaction: () => true });
      this.sessions.push(session);
      this.stats.started += 1;
      try {
        const result = await work(session);
        if (this.conflictsBeforeCommit > 0) {
          this.conflictsBeforeCommit -= 1;
          throw transientConflict();
        }
        this.stats.committed += 1;
        return result;
      } catch (error) {
        this.#participants.forEach((participant, index) => participant.restore(snapshots[index]));
        this.stats.rolledBack += 1;
        if (!error?.errorLabels?.includes('TransientTransactionError')) throw error;
        this.stats.retries += 1;
        if (this.beforeRetry) await this.beforeRetry(this.stats.retries);
      }
    }
  }
}

/** Repositorio de usuarios que exige la sesion en las escrituras del modulo de personal. */
export class TransactionalUserRepository extends InMemoryUserRepository {
  async create(document, { session } = {}) {
    assertSession(session, 'users.create');
    return super.create(document);
  }

  async updateRole(id, role, now, { session } = {}) {
    assertSession(session, 'users.updateRole');
    return super.updateRole(id, role, now);
  }

  async updateStatus(id, isActive, now, { session } = {}) {
    assertSession(session, 'users.updateStatus');
    return super.updateStatus(id, isActive, now);
  }

  /** Ayuda de prueba: modifica un documento sin pasar por el servicio (cambio concurrente). */
  force(id, changes) {
    Object.assign(this.peek(id), changes);
  }
}

/** Repositorio de auditoria con sesion, consulta del superusuario y rollback. Sin update ni delete. */
export class TransactionalAuditLogRepository extends InMemoryAuditLogRepository {
  /** Sesion recibida por cada insercion (null si se inserto fuera de transaccion). */
  sessions = [];

  async create(entry, { session } = {}) {
    this.sessions.push(session ?? null);
    return super.create(entry);
  }

  /**
   * Misma semantica que AuditLogRepository.search (filtro de buildAuditSearchFilter).
   * @param {object} criteria
   */
  async search(criteria) {
    const filter = buildAuditSearchFilter(criteria);
    const matches = (entry) =>
      (!filter.actorId || entry.actorId?.equals(filter.actorId)) &&
      (!filter.actorRole || entry.actorRole === filter.actorRole) &&
      (!filter.action || entry.action === filter.action) &&
      (!filter.targetCollection || entry.targetCollection === filter.targetCollection) &&
      (!filter.timestamp?.$gte || entry.timestamp >= filter.timestamp.$gte) &&
      (!filter.timestamp?.$lte || entry.timestamp <= filter.timestamp.$lte);
    const items = this.entries
      .filter(matches)
      .sort((a, b) => b.timestamp - a.timestamp || b._id.toString().localeCompare(a._id.toString()));
    const { page, limit } = criteria;
    return { items: items.slice((page - 1) * limit, page * limit).map(deepClone), total: items.length };
  }

  snapshot() {
    return this.entries.map(deepClone);
  }

  restore(snapshot) {
    this.entries = snapshot.map(deepClone);
  }
}

/** Repositorio de configuracion: un unico documento validado contra el $jsonSchema real. */
export class InMemorySystemSettingsRepository {
  /** @type {object | null} */
  doc = null;

  /** @param {object | null} [seed] Documento inicial (sin _id). */
  constructor(seed = null) {
    if (seed) this.doc = { _id: SYSTEM_SETTINGS_ID, ...deepClone(seed) };
  }

  /** Errores del documento actual contra el validador de system_settings. */
  schemaErrors() {
    return this.doc ? jsonSchemaErrors(this.doc, systemSettingsCollection.validator.$jsonSchema) : [];
  }

  async findGlobal() {
    return this.doc ? deepClone(this.doc) : null;
  }

  async upsertGlobal(changes, defaults, { session } = {}) {
    assertSession(session, 'settings.upsertGlobal');
    const { $set, $setOnInsert = {} } = buildSettingsUpsert(changes, defaults);
    for (const key of Object.keys($setOnInsert)) {
      if (Object.hasOwn($set, key)) throw new Error(`Conflicto $set/$setOnInsert en ${key}`);
    }
    this.doc = this.doc
      ? { ...this.doc, ...deepClone($set) }
      : { _id: SYSTEM_SETTINGS_ID, ...deepClone($setOnInsert), ...deepClone($set) };
    const errors = this.schemaErrors();
    if (errors.length > 0) throw Object.assign(new Error(`Document failed validation: ${errors.join(', ')}`), { code: 121 });
    return deepClone(this.doc);
  }

  async ensureGlobal(document) {
    if (this.doc) return false;
    this.doc = { _id: SYSTEM_SETTINGS_ID, ...deepClone(document) };
    return true;
  }

  snapshot() {
    return this.doc ? deepClone(this.doc) : null;
  }

  restore(snapshot) {
    this.doc = snapshot ? deepClone(snapshot) : null;
  }
}

/**
 * "Base de datos" en memoria compartida por los repositorios de purga y de
 * referencias fiscales (mismos nombres de coleccion y campos que MongoDB).
 */
export class InMemoryPurgeDatabase {
  /** @type {Record<string, object[]>} */
  collections = { users: [], products: [], suppliers: [], coupons: [], carts: [], orders: [], invoices: [], purchases: [] };

  /**
   * @param {string} name
   * @param {...object} docs
   */
  insert(name, ...docs) {
    this.collections[name].push(...docs.map(deepClone));
    return this;
  }

  /**
   * @param {string} name
   * @param {unknown} id
   */
  find(name, id) {
    return this.collections[name].find((doc) => doc._id.equals(id)) ?? null;
  }

  snapshot() {
    return deepClone(this.collections);
  }

  restore(snapshot) {
    this.collections = deepClone(snapshot);
  }
}

export class InMemoryPurgeRepository {
  #db;

  /** @param {InMemoryPurgeDatabase} db */
  constructor(db) {
    this.#db = db;
  }

  /** @param {string} collection */
  #assertPurgeable(collection) {
    if (!ALL_PURGEABLE_COLLECTIONS.includes(collection)) throw new Error(`Coleccion no purgable: ${collection}`);
  }

  async findById(collection, id, { session } = {}) {
    this.#assertPurgeable(collection);
    assertSession(session, 'purge.findById');
    const doc = this.#db.find(collection, id);
    return doc ? deepClone(doc) : null;
  }

  async deleteById(collection, id, { session } = {}) {
    this.#assertPurgeable(collection);
    assertSession(session, 'purge.deleteById');
    const docs = this.#db.collections[collection];
    const index = docs.findIndex((doc) => doc._id.equals(id) && doc.isActive === false);
    if (index === -1) return false;
    docs.splice(index, 1);
    return true;
  }

  async deleteCartByUserId(userId, { session } = {}) {
    assertSession(session, 'purge.deleteCartByUserId');
    const carts = this.#db.collections.carts;
    const index = carts.findIndex((cart) => cart.userId.equals(userId));
    if (index === -1) return 0;
    carts.splice(index, 1);
    return 1;
  }

  async removeProductFromSupplierCatalogs(productId, now, { session } = {}) {
    assertSession(session, 'purge.removeProductFromSupplierCatalogs');
    let modified = 0;
    for (const supplier of this.#db.collections.suppliers) {
      const before = supplier.catalog.length;
      supplier.catalog = supplier.catalog.filter((entry) => !entry.productId.equals(productId));
      if (supplier.catalog.length !== before) {
        supplier.updatedAt = now;
        modified += 1;
      }
    }
    return modified;
  }
}

export class InMemoryFiscalReferenceRepository {
  #db;

  /** @param {InMemoryPurgeDatabase} db */
  constructor(db) {
    this.#db = db;
  }

  /**
   * Cuenta documentos de una coleccion que cumplen el predicado.
   * @param {string} name
   * @param {(doc: object) => boolean} predicate
   */
  #count(name, predicate) {
    return this.#db.collections[name].filter(predicate).length;
  }

  /** @param {object} doc @param {object[]} ids */
  #hasProduct(doc, ids) {
    return (doc.items ?? []).some((item) => ids.some((id) => item.productId.equals(id)));
  }

  async countUserReferences(userId, { session } = {}) {
    assertSession(session, 'fiscal.countUserReferences');
    return {
      orders: this.#count('orders', (doc) => doc.userId?.equals(userId)),
      invoices: this.#count('invoices', (doc) => doc.userId?.equals(userId)),
    };
  }

  async countProductReferences(productId, { session } = {}) {
    assertSession(session, 'fiscal.countProductReferences');
    return {
      orders: this.#count('orders', (doc) => this.#hasProduct(doc, [productId])),
      invoices: this.#count('invoices', (doc) => this.#hasProduct(doc, [productId])),
      purchases: this.#count('purchases', (doc) => this.#hasProduct(doc, [productId])),
    };
  }

  async findProductIdsBySupplier(supplierId, { session } = {}) {
    assertSession(session, 'fiscal.findProductIdsBySupplier');
    return this.#db.collections.products.filter((doc) => doc.supplierId?.equals(supplierId)).map((doc) => doc._id);
  }

  async countSupplierReferences(supplierId, productIds, { session } = {}) {
    assertSession(session, 'fiscal.countSupplierReferences');
    return {
      orders: productIds.length ? this.#count('orders', (doc) => this.#hasProduct(doc, productIds)) : 0,
      invoices: productIds.length ? this.#count('invoices', (doc) => this.#hasProduct(doc, productIds)) : 0,
      purchases: this.#count('purchases', (doc) => doc.supplierId?.equals(supplierId)),
      supplierInvoices: this.#count('invoices', (doc) => doc.entityType === 'proveedor' && doc.supplierId?.equals(supplierId)),
    };
  }
}

/** Contrasenas con coste bajo para pruebas rapidas. */
export const fastPasswordService = new PasswordService({ saltRounds: 4 });

/**
 * Monta los repositorios en memoria, el ejecutor de transacciones y los
 * servicios reales del modulo.
 * @param {{ users?: object[], settings?: object | null, clock?: () => Date }} [options]
 */
export function makeSuperuserHarness({ users = [], settings = null, clock = () => NOW } = {}) {
  const userRepository = new TransactionalUserRepository(users);
  const auditLogRepository = new TransactionalAuditLogRepository();
  const sequenceRepository = new InMemorySequenceRepository();
  const systemSettingsRepository = new InMemorySystemSettingsRepository(settings);
  const purgeDatabase = new InMemoryPurgeDatabase();
  const purgeRepository = new InMemoryPurgeRepository(purgeDatabase);
  const fiscalReferenceRepository = new InMemoryFiscalReferenceRepository(purgeDatabase);
  const transactionRunner = new FakeTransactionRunner([
    userRepository,
    auditLogRepository,
    sequenceRepository,
    systemSettingsRepository,
    purgeDatabase,
  ]);
  const auditService = new AuditService({ auditLogRepository, logger: silentLogger, clock });
  const shared = { transactionRunner, auditService, clock };

  return {
    userRepository,
    auditLogRepository,
    sequenceRepository,
    systemSettingsRepository,
    purgeDatabase,
    purgeRepository,
    fiscalReferenceRepository,
    transactionRunner,
    auditService,
    staffService: new StaffService({ userRepository, passwordService: fastPasswordService, sequenceRepository, ...shared }),
    settingsService: new SettingsService({ systemSettingsRepository, ...shared }),
    purgeService: new PurgeService({ purgeRepository, fiscalReferenceRepository, ...shared }),
  };
}
