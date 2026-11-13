/**
 * Modulo de superusuario (Fase 4) contra un MongoDB REAL con replica set.
 *
 * Se omite automaticamente si no se define MONGODB_TEST_URI (ver
 * checkout.mongo.test.js para levantar un replica set con Docker).
 *
 * Verifica lo que los dobles en memoria no pueden demostrar:
 * - write skew: dos superusuarios que se degradan mutuamente a la vez; el
 *   centinela fuerza WriteConflict y siempre queda un superusuario activo;
 * - $jsonSchema real de system_settings y upsert con $setOnInsert;
 * - purga atomica: si la auditoria falla, el borrado se revierte;
 * - relleno de timestamp en audit_logs y uso de los indices nuevos.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { MongoClient, ObjectId } from 'mongodb';
import { ROLES } from '../../src/constants/roles.js';
import { SETTINGS_DEFAULTS, SYSTEM_SETTINGS_ID } from '../../src/constants/settings.js';
import { SUPERUSER_GOVERNANCE_LOCK } from '../../src/constants/superuser.js';
import { COLLECTIONS } from '../../src/database/collections.js';
import { ensureCollections } from '../../src/database/setup.js';
import { MongoTransactionRunner } from '../../src/database/transaction-runner.js';
import { AuditLogRepository } from '../../src/repositories/audit-log.repository.js';
import { FiscalReferenceRepository } from '../../src/repositories/fiscal-reference.repository.js';
import { PurgeRepository } from '../../src/repositories/purge.repository.js';
import { SequenceRepository } from '../../src/repositories/sequence.repository.js';
import { SystemSettingsRepository } from '../../src/repositories/system-settings.repository.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { AUDIT_ACTIONS, AuditService } from '../../src/services/audit.service.js';
import { PurgeService } from '../../src/services/purge.service.js';
import { SettingsService } from '../../src/services/settings.service.js';
import { StaffService } from '../../src/services/staff.service.js';
import { silentLogger } from '../../src/utils/logger.js';
import { actorOf, makeUser } from '../helpers/fixtures.js';
import { fastPasswordService } from '../helpers/superuser-fakes.js';

const uri = process.env.MONGODB_TEST_URI;

describe('Superusuario contra MongoDB real', { skip: !uri && 'Define MONGODB_TEST_URI (replica set) para ejecutarla' }, () => {
  let client;
  let db;
  let services;

  before(async () => {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db(`ecommerce_su_${Date.now()}`);
    await ensureCollections(db);

    const transactionRunner = new MongoTransactionRunner(client);
    const auditService = new AuditService({ auditLogRepository: new AuditLogRepository(db), logger: silentLogger });
    const shared = { transactionRunner, auditService };
    services = {
      staff: new StaffService({
        userRepository: new UserRepository(db),
        passwordService: fastPasswordService,
        sequenceRepository: new SequenceRepository(db),
        ...shared,
      }),
      settings: new SettingsService({ systemSettingsRepository: new SystemSettingsRepository(db), ...shared }),
      purge: new PurgeService({ purgeRepository: new PurgeRepository(db), fiscalReferenceRepository: new FiscalReferenceRepository(db), ...shared }),
    };
  });

  after(async () => {
    await db?.dropDatabase();
    await client?.close();
  });

  /** Inserta superusuarios activos y devuelve sus documentos. */
  async function insertSuperusers(count) {
    const docs = Array.from({ length: count }, (_, index) => makeUser({ role: ROLES.SUPERUSER, email: `root${index}.${new ObjectId()}@example.com` }));
    await db.collection(COLLECTIONS.USERS).insertMany(docs);
    return docs;
  }

  /** Limpia usuarios y auditoria entre escenarios. */
  async function reset() {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_LOGS).deleteMany({});
  }

  it('write skew: degradacion mutua simultanea; siempre queda un superusuario activo', async () => {
    for (let round = 0; round < 5; round += 1) {
      await reset();
      const [a, b] = await insertSuperusers(2);
      const results = await Promise.allSettled([
        services.staff.changeRole(actorOf(a), b._id.toString(), ROLES.ADMIN),
        services.staff.changeRole(actorOf(b), a._id.toString(), ROLES.ADMIN),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      assert.equal(fulfilled.length, 1, `ronda ${round}`);
      assert.equal(rejected.length, 1, `ronda ${round}`);
      assert.equal(rejected[0].reason.code, 'LAST_SUPERUSER', `ronda ${round}: ${rejected[0].reason.message}`);
      assert.equal(await db.collection(COLLECTIONS.USERS).countDocuments({ role: ROLES.SUPERUSER, isActive: true }), 1);
      assert.equal(await db.collection(COLLECTIONS.AUDIT_LOGS).countDocuments({ action: AUDIT_ACTIONS.STAFF_ROLE_CHANGED }), 1);
    }
    const lock = await db.collection(COLLECTIONS.COUNTERS).findOne({ _id: SUPERUSER_GOVERNANCE_LOCK });
    assert.ok(lock.seq >= 5, 'el centinela se escribe en cada cambio confirmado');
  });

  it('write skew: desactivacion mutua simultanea', async () => {
    await reset();
    const [a, b] = await insertSuperusers(2);
    const results = await Promise.allSettled([
      services.staff.changeStatus(actorOf(a), b._id.toString(), false),
      services.staff.changeStatus(actorOf(b), a._id.toString(), false),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(await db.collection(COLLECTIONS.USERS).countDocuments({ role: ROLES.SUPERUSER, isActive: true }), 1);
  });

  it('system_settings: $jsonSchema real, upsert con valores por defecto e idempotencia de ensureGlobal', async () => {
    const repository = new SystemSettingsRepository(db);
    await assert.rejects(
      db.collection(COLLECTIONS.SYSTEM_SETTINGS).insertOne({ _id: SYSTEM_SETTINGS_ID, ...SETTINGS_DEFAULTS, defaultTaxRate: 1.5, updatedAt: new Date(), updatedBy: null }),
      { code: 121 },
    );
    await assert.rejects(
      db.collection(COLLECTIONS.SYSTEM_SETTINGS).insertOne({ _id: 'otra', ...SETTINGS_DEFAULTS, updatedAt: new Date(), updatedBy: null }),
      { code: 121 },
    );

    const root = makeUser({ role: ROLES.SUPERUSER });
    const updated = await services.settings.updateSettings(actorOf(root), { maintenanceMode: true });
    assert.equal(updated.defaultTaxRate, 0.12);
    assert.deepEqual(updated.companyBankAccounts, []);
    assert.equal(updated.maintenanceMode, true);

    assert.equal(await repository.ensureGlobal({ ...SETTINGS_DEFAULTS, companyBankAccounts: [], updatedAt: new Date(), updatedBy: null }), false);
    const stored = await repository.findGlobal();
    assert.equal(stored.maintenanceMode, true, 'ensureGlobal no sobrescribe');

    const withAccounts = await services.settings.updateSettings(actorOf(root), {
      defaultTaxRate: 0.1,
      companyBankAccounts: [{ bankName: 'G&T', accountNumber: '01-2345678-9', accountHolder: 'Tienda S.A.', accountType: 'monetaria', isActive: true }],
    });
    assert.equal(withAccounts.defaultTaxRate, 0.1);
    assert.equal((await services.settings.getPublicConfig()).companyBankAccounts.length, 1);
    assert.equal(await db.collection(COLLECTIONS.AUDIT_LOGS).countDocuments({ action: AUDIT_ACTIONS.SETTINGS_UPDATED }), 2);
  });

  it('purga: bloqueo fiscal, borrado con cascada y rollback si la auditoria falla', async () => {
    await reset();
    const root = makeUser({ role: ROLES.SUPERUSER });
    const locked = makeUser({ role: ROLES.USER, isActive: false });
    const clean = makeUser({ role: ROLES.USER, isActive: false });
    const atomic = makeUser({ role: ROLES.USER, isActive: false });
    await db.collection(COLLECTIONS.USERS).insertMany([root, locked, clean, atomic]);
    // Pedido minimo valido del cliente bloqueado (la purga solo cuenta por userId).
    await db.collection(COLLECTIONS.ORDERS).insertOne(
      {
        orderNumber: 'ORD-00000001',
        userId: locked._id,
        channel: 'pos',
        status: 'paid',
        currency: 'GTQ',
        customer: { name: 'Ana Perez', email: locked.email },
        items: [
          {
            productId: new ObjectId(), sku: 'SKU-1', name: 'P', quantity: 1, unitPriceCents: 100, discountPercent: 0,
            unitFinalPriceCents: 100, taxRatePercent: 12, subtotalCents: 100, productDiscountCents: 0, couponDiscountCents: 0,
            discountTotalCents: 0, taxCents: 12, grandTotalCents: 112,
          },
        ],
        totals: { subtotalCents: 100, productDiscountCents: 0, couponDiscountCents: 0, discountTotalCents: 0, taxTotalCents: 12, grandTotalCents: 112, totalItemsCount: 1 },
        payment: { method: 'cash_on_delivery', status: 'cash_due' },
        invoiceId: new ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    );
    await db.collection(COLLECTIONS.CARTS).insertOne({ userId: clean._id, items: [], couponCode: null, createdAt: new Date(), updatedAt: new Date() });

    await assert.rejects(services.purge.purge(actorOf(root), 'users', locked._id.toString()), { code: 'FISCAL_INTEGRITY_LOCK' });

    const result = await services.purge.purge(actorOf(root), 'users', clean._id.toString());
    assert.equal(await db.collection(COLLECTIONS.USERS).countDocuments({ _id: clean._id }), 0);
    assert.equal(await db.collection(COLLECTIONS.CARTS).countDocuments({ userId: clean._id }), 0);
    const entry = await db.collection(COLLECTIONS.AUDIT_LOGS).findOne({ _id: ObjectId.createFromHexString(result.auditLogId) });
    assert.equal(entry.action, AUDIT_ACTIONS.RECORD_PURGED);
    assert.equal(entry.snapshot.email, clean.email);
    assert.equal(entry.snapshot.passwordHash, undefined);
    assert.deepEqual(entry.timestamp, entry.createdAt);

    // actorRole de mas de 30 caracteres: el $jsonSchema de audit_logs rechaza la entrada -> rollback.
    const brokenActor = { id: root._id.toString(), role: 'x'.repeat(31) };
    await assert.rejects(services.purge.purge(brokenActor, 'users', atomic._id.toString()), { code: 121 });
    assert.equal(await db.collection(COLLECTIONS.USERS).countDocuments({ _id: atomic._id }), 1, 'sin auditoria no hay borrado');
  });

  it('audit_logs: relleno de timestamp tras el collMod y uso de los indices nuevos', async () => {
    const legacyCreatedAt = new Date('2025-06-01T00:00:00Z');
    const { insertedId } = await db
      .collection(COLLECTIONS.AUDIT_LOGS)
      .insertOne({ action: 'auth.login', entity: 'user', outcome: 'success', createdAt: legacyCreatedAt });
    await ensureCollections(db);
    const legacy = await db.collection(COLLECTIONS.AUDIT_LOGS).findOne({ _id: insertedId });
    assert.deepEqual(legacy.timestamp, legacyCreatedAt);

    const byCollection = await db
      .collection(COLLECTIONS.AUDIT_LOGS)
      .find({ targetCollection: 'users', timestamp: { $gte: legacyCreatedAt } })
      .sort({ timestamp: -1, _id: -1 })
      .explain();
    assert.match(JSON.stringify(byCollection.queryPlanner.winningPlan), /ix_audit_collection_timestamp/);

    const byDate = await db.collection(COLLECTIONS.AUDIT_LOGS).find({ timestamp: { $gte: legacyCreatedAt } }).sort({ timestamp: -1, _id: -1 }).explain();
    assert.match(JSON.stringify(byDate.queryPlanner.winningPlan), /ix_audit_timestamp/);
  });

  it('referencias fiscales: el filtro por supplierId usa el indice parcial de products', async () => {
    const plan = await db
      .collection(COLLECTIONS.PRODUCTS)
      .find({ supplierId: { $eq: new ObjectId(), $type: 'objectId' } })
      .explain();
    assert.match(JSON.stringify(plan.queryPlanner.winningPlan), /ix_products_supplier/);
  });
});
