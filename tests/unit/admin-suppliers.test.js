/**
 * Pruebas de proveedores (Fase 3, parte B): supplierCode generado por el
 * sistema, NIT duplicado -> 409, catalogo validado, actualizacion auditada,
 * baja logica, borrado fisico solo para superusuario (servicio y ruta) y
 * bloqueado si hay compras registradas.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import express from 'express';
import { ObjectId } from 'mongodb';
import { suppliersCollection } from '../../src/database/schemas/suppliers.schema.js';
import { CreateSupplierDTO, SupplierDetailDTO, UpdateSupplierDTO } from '../../src/dtos/supplier.dto.js';
import { createErrorHandler } from '../../src/middlewares/error-handler.js';
import { buildSupplierFilter } from '../../src/repositories/supplier.repository.js';
import { createSupplierRoutes } from '../../src/routes/supplier.routes.js';
import { AUDIT_ACTIONS } from '../../src/services/audit.service.js';
import { SupplierService } from '../../src/services/supplier.service.js';
import { validateSchema } from '../../src/validators/schema-validator.js';
import { createSupplierSchema, updateSupplierSchema } from '../../src/validators/supplier.validator.js';
import { silentLogger } from '../../src/utils/logger.js';
import { adminActor, customerActor, superuserActor } from '../helpers/admin-fakes.js';
import { jsonSchemaErrors, makeProduct } from '../helpers/checkout-fakes.js';
import { makeInventoryPurchaseDeps, makeSupplier } from '../helpers/inventory-purchase-fakes.js';

const NOW = new Date('2026-06-01T10:00:00Z');
const SUPPLIER_SCHEMA = suppliersCollection.validator.$jsonSchema;

describe('SupplierService', () => {
  let product;
  let deps;
  let service;

  beforeEach(() => {
    product = makeProduct();
    deps = makeInventoryPurchaseDeps({ products: [product] });
    service = new SupplierService({ ...deps, clock: () => NOW });
  });

  const body = (overrides = {}) => ({
    name: '  Distribuidora   Central ',
    nit: '1234567-k',
    address: '6a Avenida 1-20 zona 4',
    phone: '+502 2222-3333',
    email: 'Ventas@Central.example.com',
    distributionDescription: 'Entregas semanales',
    catalog: [{ productId: product._id.toString(), cost: 12.5 }],
    ...overrides,
  });

  /** Valida y construye el DTO de alta. */
  const createDto = (overrides) => {
    const input = body(overrides);
    assert.deepEqual(validateSchema(createSupplierSchema, input), []);
    return CreateSupplierDTO.from(input);
  };

  it('genera supplierCode correlativo y cumple el $jsonSchema', async () => {
    const first = await service.createSupplier(adminActor, createDto(), { ip: '1.1.1.1' });
    const second = await service.createSupplier(adminActor, createDto({ nit: '7654321-0' }));
    assert.equal(first.supplierCode, 'PRV-000001');
    assert.equal(second.supplierCode, 'PRV-000002');
    assert.equal(first.name, 'Distribuidora Central');
    assert.equal(first.nit, '1234567-K');
    assert.equal(first.email, 'ventas@central.example.com');
    assert.equal(first.contactName, null);
    assert.equal(first.catalog[0].costCents, 1250);
    assert.ok(first.catalog[0].productId.equals(product._id));
    assert.deepEqual(jsonSchemaErrors(deps.supplierRepository.peek(first._id), SUPPLIER_SCHEMA), []);

    const [change] = deps.auditService.changes;
    assert.equal(change.action, AUDIT_ACTIONS.SUPPLIER_CREATED);
    assert.equal(change.targetCollection, 'suppliers');
    assert.equal(change.previousState, null);
    assert.equal(change.newState.supplierCode, 'PRV-000001');
  });

  it('NIT duplicado -> 409 sin consumir codigo ni auditar', async () => {
    await service.createSupplier(adminActor, createDto());
    await assert.rejects(service.createSupplier(adminActor, createDto({ name: 'Otro' })), {
      status: 409,
      code: 'SUPPLIER_NIT_IN_USE',
    });
    assert.equal(deps.supplierRepository.all().length, 1);
    assert.equal(deps.sequenceRepository.peek('supplier'), 1);
    assert.equal(deps.auditService.changes.length, 1);
  });

  it('NIT duplicado detectado por el indice unico (carrera) -> 409 y rollback del codigo', async () => {
    await service.createSupplier(adminActor, createDto());
    const original = deps.supplierRepository.findByNit.bind(deps.supplierRepository);
    deps.supplierRepository.findByNit = async () => null;
    await assert.rejects(service.createSupplier(adminActor, createDto()), { status: 409, code: 'SUPPLIER_NIT_IN_USE' });
    deps.supplierRepository.findByNit = original;
    assert.equal(deps.sequenceRepository.peek('supplier'), 1);
  });

  it('catalogo con producto inexistente -> 422', async () => {
    const missing = new ObjectId().toString();
    await assert.rejects(service.createSupplier(adminActor, createDto({ catalog: [{ productId: missing, cost: 1 }] })), {
      status: 422,
      code: 'PRODUCT_NOT_FOUND',
    });
    assert.equal(deps.supplierRepository.all().length, 0);
  });

  it('actualiza con previousState/newState y rechaza NIT de otro proveedor', async () => {
    const supplier = await service.createSupplier(adminActor, createDto());
    const other = await service.createSupplier(adminActor, createDto({ nit: '7654321-0' }));
    const changes = UpdateSupplierDTO.from({ phone: '+502 5555-0000', contactName: 'Ana' });
    const updated = await service.updateSupplier(adminActor, supplier._id.toString(), changes);
    assert.equal(updated.phone, '+502 5555-0000');
    assert.equal(updated.supplierCode, 'PRV-000001');

    const change = deps.auditService.changes.at(-1);
    assert.equal(change.action, AUDIT_ACTIONS.SUPPLIER_UPDATED);
    assert.equal(change.previousState.phone, '+502 2222-3333');
    assert.equal(change.newState.phone, '+502 5555-0000');

    await assert.rejects(service.updateSupplier(adminActor, other._id.toString(), UpdateSupplierDTO.from({ nit: '1234567-K' })), {
      status: 409,
    });
  });

  it('el validador de actualizacion no permite cambiar supplierCode y exige algun campo', () => {
    const fields = (input) => validateSchema(updateSupplierSchema, input).map((error) => error.field);
    assert.ok(fields({ supplierCode: 'PRV-000009' }).includes('supplierCode'));
    assert.ok(fields({}).includes('_root'));
    assert.deepEqual(fields({ name: 'Nuevo nombre' }), []);
    const dupCatalog = [
      { productId: product._id.toString(), cost: 1 },
      { productId: product._id.toString(), cost: 2 },
    ];
    assert.ok(fields({ catalog: dupCatalog }).includes('catalog[1].productId'));
    assert.ok(validateSchema(createSupplierSchema, body({ supplierCode: 'PRV-000001' })).some((e) => e.field === 'supplierCode'));
  });

  it('soft delete: isActive false, auditado e idempotente', async () => {
    const supplier = await service.createSupplier(adminActor, createDto());
    const deactivated = await service.deactivateSupplier(adminActor, supplier._id.toString());
    assert.equal(deactivated.isActive, false);
    assert.equal(deps.supplierRepository.peek(supplier._id).isActive, false);
    const change = deps.auditService.changes.at(-1);
    assert.equal(change.action, AUDIT_ACTIONS.SUPPLIER_DEACTIVATED);
    assert.equal(change.previousState.isActive, true);
    assert.equal(change.newState.isActive, false);

    const auditCount = deps.auditService.changes.length;
    await service.deactivateSupplier(adminActor, supplier._id.toString());
    assert.equal(deps.auditService.changes.length, auditCount);
  });

  it('borrado fisico: denegado al admin, bloqueado con compras y permitido al superusuario', async () => {
    const supplier = await service.createSupplier(adminActor, createDto());
    const id = supplier._id.toString();

    await assert.rejects(service.deleteSupplier(adminActor, id), { status: 403, code: 'HARD_DELETE_FORBIDDEN' });
    assert.ok(deps.supplierRepository.peek(supplier._id));

    deps.purchaseRepository.docs.set('p1', { _id: new ObjectId(), supplierId: supplier._id });
    await assert.rejects(service.deleteSupplier(superuserActor, id), { status: 409, code: 'SUPPLIER_HAS_PURCHASES' });
    assert.ok(deps.supplierRepository.peek(supplier._id));

    deps.purchaseRepository.docs.clear();
    await service.deleteSupplier(superuserActor, id);
    assert.equal(deps.supplierRepository.peek(supplier._id), undefined);
    const change = deps.auditService.changes.at(-1);
    assert.equal(change.action, AUDIT_ACTIONS.SUPPLIER_DELETED);
    assert.equal(change.previousState.supplierCode, 'PRV-000001');
    assert.equal(change.newState, null);

    await assert.rejects(service.deleteSupplier(superuserActor, id), { status: 404 });
  });

  it('detalle y filtros', async () => {
    const supplier = await service.createSupplier(adminActor, createDto());
    const detail = SupplierDetailDTO.from({
      ...(await service.getSupplier(supplier._id.toString())),
      catalog: [{ productId: product._id, costCents: 1250, product: { ...product } }],
    });
    assert.equal(detail.catalog[0].sku, product.sku);
    assert.equal(detail.catalog[0].cost, 12.5);
    assert.equal(detail.catalog[0].salePrice, 100);

    assert.deepEqual(buildSupplierFilter({ supplierCode: 'PRV-000001' }), { supplierCode: 'PRV-000001' });
    assert.deepEqual(buildSupplierFilter({ supplierCode: 'PRV-00' }), { supplierCode: { $regex: '^PRV-00' } });
    assert.equal(buildSupplierFilter({ name: 'a+b' }).name.$regex, 'a\\+b');
  });
});

describe('Rutas de proveedores (permisos)', () => {
  /**
   * Levanta el sub-router con un controlador simulado y el actor indicado.
   * @param {object} actor
   */
  async function request(actor, method, path) {
    const calls = [];
    const handler = (name) => (_req, res) => {
      calls.push(name);
      res.status(name === 'remove' ? 204 : 200).json({ ok: true });
    };
    const supplierController = Object.fromEntries(
      ['create', 'list', 'getById', 'update', 'deactivate', 'remove'].map((name) => [name, handler(name)]),
    );
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = actor;
      next();
    });
    app.use('/admin/suppliers', createSupplierRoutes({ supplierController }));
    app.use(createErrorHandler({ logger: silentLogger, isProduction: false }));

    const server = app.listen(0);
    try {
      await new Promise((resolve) => server.once('listening', resolve));
      const { port } = server.address();
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
      return { status: response.status, calls };
    } finally {
      server.close();
    }
  }

  const id = new ObjectId().toString();

  it('DELETE /:id es 403 para admin y 204 para superusuario', async () => {
    const asAdmin = await request(adminActor, 'DELETE', `/admin/suppliers/${id}`);
    assert.equal(asAdmin.status, 403);
    assert.deepEqual(asAdmin.calls, []);
    const asSuper = await request(superuserActor, 'DELETE', `/admin/suppliers/${id}`);
    assert.equal(asSuper.status, 204);
    assert.deepEqual(asSuper.calls, ['remove']);
  });

  it('el admin puede desactivar y un cliente no accede', async () => {
    assert.equal((await request(adminActor, 'PATCH', `/admin/suppliers/${id}/deactivate`)).status, 200);
    assert.equal((await request(customerActor, 'GET', '/admin/suppliers')).status, 403);
    assert.equal((await request(adminActor, 'GET', '/admin/suppliers/no-es-id')).status, 400);
  });
});
