/**
 * Pruebas de la purga (Fase 4): validador de la lista blanca, PurgeService
 * (404, borrado logico previo, bloqueo fiscal, cascadas, auditoria con
 * instantanea redactada en la misma transaccion) y PurgeRepository (nunca usa
 * el parametro crudo como nombre de coleccion).
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { ROLES } from '../../src/constants/roles.js';
import { ALL_PURGEABLE_COLLECTIONS } from '../../src/constants/superuser.js';
import { PurgeRepository } from '../../src/repositories/purge.repository.js';
import { AUDIT_ACTIONS } from '../../src/services/audit.service.js';
import { purgeParamsSchema } from '../../src/validators/purge.validator.js';
import { validateSchema } from '../../src/validators/schema-validator.js';
import { makeCoupon, makeProduct } from '../helpers/checkout-fakes.js';
import { actorOf, makeUser } from '../helpers/fixtures.js';
import { makeSuperuserHarness } from '../helpers/superuser-fakes.js';

/** Proveedor minimo. */
const makeSupplier = (overrides = {}) => ({
  _id: new ObjectId(),
  supplierCode: 'PRV-000001',
  name: 'Distribuidora',
  nit: '1234567-8',
  catalog: [],
  isActive: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('purgeParamsSchema', () => {
  it('lista blanca centralizada: users, products, suppliers, coupons', () => {
    assert.deepEqual([...ALL_PURGEABLE_COLLECTIONS].sort(), ['coupons', 'products', 'suppliers', 'users']);
    for (const collection of ALL_PURGEABLE_COLLECTIONS) {
      assert.deepEqual(validateSchema(purgeParamsSchema, { collection, id: new ObjectId().toString() }), [], collection);
    }
  });

  it('rechaza colecciones fuera de la lista y ids invalidos', () => {
    for (const collection of ['orders', 'invoices', 'audit_logs', 'system_settings', 'Users', '$where']) {
      const errors = validateSchema(purgeParamsSchema, { collection, id: new ObjectId().toString() });
      assert.deepEqual(errors.map((error) => error.field), ['collection'], collection);
    }
    assert.deepEqual(validateSchema(purgeParamsSchema, { collection: 'users', id: '123' }).map((e) => e.field), ['id']);
  });
});

describe('PurgeService', () => {
  let h;
  let root;
  let actor;

  beforeEach(() => {
    root = makeUser({ role: ROLES.SUPERUSER });
    actor = actorOf(root);
    h = makeSuperuserHarness({ users: [root] });
  });

  /** Inserta documentos en la base en memoria de la purga. */
  const seed = (name, ...docs) => h.purgeDatabase.insert(name, ...docs);

  it('404 RECORD_NOT_FOUND si no existe', async () => {
    await assert.rejects(h.purgeService.purge(actor, 'users', new ObjectId().toString()), { status: 404, code: 'RECORD_NOT_FOUND' });
  });

  it('400 NOT_SOFT_DELETED si el registro sigue activo', async () => {
    const customer = makeUser({ role: ROLES.USER, isActive: true });
    seed('users', customer);
    await assert.rejects(h.purgeService.purge(actor, 'users', customer._id.toString()), { status: 400, code: 'NOT_SOFT_DELETED' });
    assert.ok(h.purgeDatabase.find('users', customer._id));
  });

  it('400 si se pide una coleccion fuera de la lista blanca aunque se salte el validador', async () => {
    await assert.rejects(h.purgeService.purge(actor, 'orders', new ObjectId().toString()), {
      status: 400,
      code: 'COLLECTION_NOT_PURGEABLE',
    });
  });

  it('409 SELF_PURGE: el actor no puede purgar su propia cuenta', async () => {
    seed('users', { ...root, isActive: false });
    await assert.rejects(h.purgeService.purge(actor, 'users', root._id.toString()), { status: 409, code: 'SELF_PURGE' });
  });

  it('409 FISCAL_INTEGRITY_LOCK al purgar un cliente con pedidos y facturas', async () => {
    const customer = makeUser({ role: ROLES.USER, isActive: false });
    seed('users', customer);
    seed('orders', { _id: new ObjectId(), userId: customer._id, items: [] });
    seed('invoices', { _id: new ObjectId(), userId: customer._id, entityType: 'cliente', items: [] }, { _id: new ObjectId(), userId: customer._id, entityType: 'cliente', items: [] });

    await assert.rejects(h.purgeService.purge(actor, 'users', customer._id.toString()), (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'FISCAL_INTEGRITY_LOCK');
      assert.deepEqual(error.details, { collection: 'users', references: { orders: 1, invoices: 2 } });
      return true;
    });
    assert.ok(h.purgeDatabase.find('users', customer._id), 'no se borra');
    assert.equal(h.auditLogRepository.entries.length, 0);
  });

  it('purga un cliente sin dependencias: borra su carrito y audita la instantanea redactada', async () => {
    const customer = makeUser({ role: ROLES.USER, isActive: false, tokenVersion: 3 });
    seed('users', customer);
    seed('carts', { _id: new ObjectId(), userId: customer._id, items: [], couponCode: null });

    const result = await h.purgeService.purge(actor, 'users', customer._id.toString(), { ip: '10.1.1.1', userAgent: 'jest' });

    assert.equal(h.purgeDatabase.find('users', customer._id), null);
    assert.equal(h.purgeDatabase.collections.carts.length, 0);
    const [entry] = h.auditLogRepository.entries;
    assert.deepEqual(result, { collection: 'users', id: customer._id.toString(), purged: true, auditLogId: entry._id.toString() });

    assert.equal(entry.action, AUDIT_ACTIONS.RECORD_PURGED);
    assert.equal(entry.targetCollection, 'users');
    assert.equal(entry.entityId, customer._id.toString());
    assert.equal(entry.actorId.toString(), root._id.toString());
    assert.equal(entry.actorRole, ROLES.SUPERUSER);
    assert.equal(entry.snapshot.email, customer.email);
    for (const secret of ['passwordHash', 'tokenVersion', 'failedLoginAttempts', 'lockUntil']) {
      assert.equal(Object.hasOwn(entry.snapshot, secret), false, secret);
    }
    assert.deepEqual(entry.metadata, { cascade: { cartsDeleted: 1 } });
    assert.ok(h.auditLogRepository.sessions[0], 'auditoria dentro de la transaccion');
    assert.deepEqual(entry.timestamp, entry.createdAt);
  });

  it('si la auditoria falla, la purga se revierte', async () => {
    const customer = makeUser({ role: ROLES.USER, isActive: false });
    seed('users', customer);
    h.auditLogRepository.failOnCreate = true;
    await assert.rejects(h.purgeService.purge(actor, 'users', customer._id.toString()), /fallo simulado/);
    assert.ok(h.purgeDatabase.find('users', customer._id), 'el usuario sigue existiendo');
  });

  it('productos: bloqueo por pedidos, facturas y compras', async () => {
    const product = makeProduct({ isActive: false });
    seed('products', product);
    seed('purchases', { _id: new ObjectId(), supplierId: new ObjectId(), items: [{ productId: product._id }] });
    seed('invoices', { _id: new ObjectId(), entityType: 'proveedor', supplierId: new ObjectId(), items: [{ productId: product._id }] });

    await assert.rejects(h.purgeService.purge(actor, 'products', product._id.toString()), (error) => {
      assert.equal(error.code, 'FISCAL_INTEGRITY_LOCK');
      assert.deepEqual(error.details.references, { orders: 0, invoices: 1, purchases: 1 });
      return true;
    });
  });

  it('productos sin referencias: se purgan y salen del catalogo de los proveedores', async () => {
    const product = makeProduct({ isActive: false });
    const other = new ObjectId();
    seed('products', product);
    seed('suppliers', makeSupplier({ isActive: true, catalog: [{ productId: product._id, costCents: 100 }, { productId: other, costCents: 50 }] }));

    const result = await h.purgeService.purge(actor, 'products', product._id.toString());
    assert.equal(result.purged, true);
    assert.equal(h.purgeDatabase.find('products', product._id), null);
    assert.deepEqual(h.purgeDatabase.collections.suppliers[0].catalog.map((entry) => entry.productId.toString()), [other.toString()]);
    assert.deepEqual(h.auditLogRepository.entries[0].metadata.cascade, { supplierCatalogsUpdated: 1 });
    assert.equal(h.auditLogRepository.entries[0].snapshot.sku, product.sku);
  });

  it('proveedores: bloqueo fiscal por compras y facturas de proveedor', async () => {
    const supplier = makeSupplier();
    seed('suppliers', supplier);
    seed('purchases', { _id: new ObjectId(), supplierId: supplier._id, items: [] });
    seed('invoices', { _id: new ObjectId(), entityType: 'proveedor', supplierId: supplier._id, items: [] });

    await assert.rejects(h.purgeService.purge(actor, 'suppliers', supplier._id.toString()), (error) => {
      assert.equal(error.code, 'FISCAL_INTEGRITY_LOCK');
      assert.deepEqual(error.details.references, { orders: 0, invoices: 0, purchases: 1, supplierInvoices: 1, products: 0 });
      return true;
    });
  });

  it('proveedores: bloqueo fiscal por ventas de sus productos', async () => {
    const supplier = makeSupplier();
    const product = makeProduct({ supplierId: supplier._id });
    seed('suppliers', supplier);
    seed('products', product);
    seed('orders', { _id: new ObjectId(), userId: new ObjectId(), items: [{ productId: product._id }] });

    await assert.rejects(h.purgeService.purge(actor, 'suppliers', supplier._id.toString()), (error) => {
      assert.equal(error.code, 'FISCAL_INTEGRITY_LOCK');
      assert.equal(error.details.references.orders, 1);
      assert.equal(error.details.references.products, 1);
      return true;
    });
  });

  it('proveedores con productos existentes (sin documentos fiscales): 409 SUPPLIER_HAS_PRODUCTS', async () => {
    const supplier = makeSupplier();
    seed('suppliers', supplier);
    seed('products', makeProduct({ supplierId: supplier._id }), makeProduct({ supplierId: supplier._id }));

    await assert.rejects(h.purgeService.purge(actor, 'suppliers', supplier._id.toString()), (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'SUPPLIER_HAS_PRODUCTS');
      assert.equal(error.details.references.products, 2);
      return true;
    });
  });

  it('proveedores sin dependencias y cupones desactivados se purgan', async () => {
    const supplier = makeSupplier();
    const coupon = makeCoupon({ isActive: false });
    seed('suppliers', supplier);
    seed('coupons', coupon);
    // Un pedido que uso el cupon NO bloquea: conserva su propia copia del cupon.
    seed('orders', { _id: new ObjectId(), userId: new ObjectId(), items: [], coupon: { couponId: coupon._id, code: coupon.code } });

    assert.equal((await h.purgeService.purge(actor, 'suppliers', supplier._id.toString())).purged, true);
    assert.equal((await h.purgeService.purge(actor, 'coupons', coupon._id.toString())).purged, true);
    assert.equal(h.purgeDatabase.find('coupons', coupon._id), null);
    assert.deepEqual(h.auditLogRepository.actions(), [AUDIT_ACTIONS.RECORD_PURGED, AUDIT_ACTIONS.RECORD_PURGED]);
    assert.deepEqual(h.auditLogRepository.entries.map((entry) => entry.targetCollection), ['suppliers', 'coupons']);
  });

  it('400 con un id invalido', async () => {
    await assert.rejects(h.purgeService.purge(actor, 'users', 'no-es-un-id'), { status: 400, code: 'INVALID_ID' });
  });
});

describe('PurgeRepository', () => {
  /** Base de datos falsa que registra las colecciones pedidas y las operaciones. */
  function makeFakeDb() {
    const requested = [];
    const operations = [];
    const collectionFor = (name) => ({
      findOne: async (filter, options) => {
        operations.push({ name, op: 'findOne', filter, options });
        return null;
      },
      deleteOne: async (filter, options) => {
        operations.push({ name, op: 'deleteOne', filter, options });
        return { deletedCount: 1 };
      },
      updateMany: async (filter, update, options) => {
        operations.push({ name, op: 'updateMany', filter, update, options });
        return { modifiedCount: 2 };
      },
    });
    return {
      requested,
      operations,
      collection(name) {
        requested.push(name);
        return collectionFor(name);
      },
    };
  }

  it('resuelve solo las colecciones de la lista blanca (mas carts y suppliers para la cascada)', () => {
    const db = makeFakeDb();
    new PurgeRepository(db);
    assert.deepEqual([...db.requested].sort(), ['carts', 'coupons', 'products', 'suppliers', 'suppliers', 'users'].sort());
  });

  it('un nombre fuera de la lista lanza error y no consulta ninguna coleccion', async () => {
    const db = makeFakeDb();
    const repository = new PurgeRepository(db);
    const before = db.requested.length;
    assert.throws(() => repository.findById('orders', new ObjectId()), /no purgable/);
    assert.throws(() => repository.findById('__proto__', new ObjectId()), /no purgable/);
    assert.equal(db.requested.length, before);
    assert.equal(db.operations.length, 0);
  });

  it('propaga la sesion y borra solo documentos desactivados', async () => {
    const db = makeFakeDb();
    const repository = new PurgeRepository(db);
    const session = { id: 's1' };
    const id = new ObjectId();
    await repository.findById('users', id, { session });
    assert.equal(await repository.deleteById('users', id, { session }), true);
    assert.equal(await repository.removeProductFromSupplierCatalogs(id, new Date(), { session }), 2);

    const [find, remove, pull] = db.operations;
    assert.deepEqual(find.options, { session });
    assert.deepEqual(remove.filter, { _id: id, isActive: false });
    assert.deepEqual(remove.options, { session });
    assert.equal(pull.name, 'suppliers');
    assert.deepEqual(pull.update.$pull, { catalog: { productId: id } });
  });
});
