/**
 * Pruebas de inventario del panel (Fase 3, parte B): registro de mermas en
 * transaccion (descuento condicional de stock + registro de perdida), 409 por
 * stock insuficiente sin cambios, cumplimiento del $jsonSchema de
 * inventory_losses, auditoria, detalle con proveedor y filtros.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { LOSS_REASONS } from '../../src/constants/commerce.js';
import { inventoryLossesCollection } from '../../src/database/schemas/inventory-losses.schema.js';
import { InventoryLossDTO, InventoryProductDetailDTO, ListInventoryQueryDTO, RecordLossDTO } from '../../src/dtos/inventory.dto.js';
import { buildInventoryFilter } from '../../src/repositories/inventory.repository.js';
import { AUDIT_ACTIONS } from '../../src/services/audit.service.js';
import { InventoryService } from '../../src/services/inventory.service.js';
import { listInventoryQuerySchema, recordLossSchema } from '../../src/validators/inventory.validator.js';
import { validateSchema } from '../../src/validators/schema-validator.js';
import { adminActor } from '../helpers/admin-fakes.js';
import { jsonSchemaErrors, makeProduct } from '../helpers/checkout-fakes.js';
import { makeInventoryPurchaseDeps, makeSupplier } from '../helpers/inventory-purchase-fakes.js';

const NOW = new Date('2026-06-01T10:00:00Z');
const LOSS_SCHEMA = inventoryLossesCollection.validator.$jsonSchema;

/**
 * Valida el cuerpo como lo haria el middleware y construye el DTO.
 * @param {object} body
 */
function lossDto(body) {
  assert.deepEqual(validateSchema(recordLossSchema, body), []);
  return RecordLossDTO.from(body);
}

describe('InventoryService.recordLoss', () => {
  let product;
  let supplier;
  let deps;
  let service;

  beforeEach(() => {
    supplier = makeSupplier();
    product = makeProduct({ stock: 8, costCents: 1250, supplierId: supplier._id, images: ['https://cdn.example.com/a.png'] });
    deps = makeInventoryPurchaseDeps({ products: [product], suppliers: [supplier] });
    service = new InventoryService({ ...deps, clock: () => NOW });
  });

  it('descuenta stock y registra la perdida con el costo congelado', async () => {
    const dto = lossDto({ productId: product._id.toString(), quantity: 3, reason: LOSS_REASONS.DAMAGED, notes: '  caja   rota ' });
    const { loss, previousStock, newStock } = await service.recordLoss(adminActor, dto, { ip: '10.0.0.1' });

    assert.equal(deps.inventoryStockRepository.peek(product._id).stock, 5);
    assert.equal(previousStock, 8);
    assert.equal(newStock, 5);
    assert.equal(loss.unitCostCents, 1250);
    assert.equal(loss.totalLossCents, 3750);
    assert.equal(loss.notes, 'caja rota');
    assert.equal(loss.occurredAt.getTime(), NOW.getTime());
    assert.ok(loss.supplierId.equals(supplier._id));
    assert.equal(loss.recordedBy.toString(), adminActor.id);
    assert.deepEqual(jsonSchemaErrors(deps.inventoryLossRepository.peek(loss._id), LOSS_SCHEMA), []);

    const [change] = deps.auditService.changes;
    assert.equal(change.action, AUDIT_ACTIONS.INVENTORY_LOSS_RECORDED);
    assert.deepEqual(change.previousState, { stock: 8 });
    assert.deepEqual(change.newState, { stock: 5 });
    assert.equal(change.metadata.totalLossCents, 3750);
    assert.equal(change.context.ip, '10.0.0.1');

    const out = InventoryLossDTO.from(loss);
    assert.equal(out.unitCost, 12.5);
    assert.equal(out.totalLoss, 37.5);
  });

  it('usa costo 0 si el producto no tiene costo registrado', async () => {
    deps.inventoryStockRepository.peek(product._id).costCents = null;
    const { loss } = await service.recordLoss(
      adminActor,
      lossDto({ productId: product._id.toString(), quantity: 1, reason: LOSS_REASONS.EXPIRED }),
    );
    assert.equal(loss.unitCostCents, 0);
    assert.equal(loss.totalLossCents, 0);
    assert.deepEqual(jsonSchemaErrors(deps.inventoryLossRepository.peek(loss._id), LOSS_SCHEMA), []);
  });

  it('stock insuficiente -> 409 INSUFFICIENT_STOCK sin cambios ni auditoria', async () => {
    const dto = lossDto({ productId: product._id.toString(), quantity: 9, reason: LOSS_REASONS.EXPIRED });
    await assert.rejects(service.recordLoss(adminActor, dto), (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'INSUFFICIENT_STOCK');
      assert.equal(error.body.availableStock, 8);
      return true;
    });
    assert.equal(deps.inventoryStockRepository.peek(product._id).stock, 8);
    assert.equal(deps.inventoryLossRepository.all().length, 0);
    assert.equal(deps.auditService.changes.length, 0);
    assert.equal(deps.transactionRunner.stats.rolledBack, 1);
  });

  it('producto inexistente -> 404 y fecha futura -> 422', async () => {
    await assert.rejects(
      service.recordLoss(adminActor, lossDto({ productId: new ObjectId().toString(), quantity: 1, reason: 'expired' })),
      { status: 404, code: 'PRODUCT_NOT_FOUND' },
    );
    await assert.rejects(
      service.recordLoss(
        adminActor,
        lossDto({ productId: product._id.toString(), quantity: 1, reason: 'expired', occurredAt: '2027-01-01T00:00:00Z' }),
      ),
      { status: 422, code: 'LOSS_DATE_IN_FUTURE' },
    );
    assert.equal(deps.inventoryStockRepository.peek(product._id).stock, 8);
  });

  it('valida la entrada: motivo y cantidad', () => {
    const fields = (body) => validateSchema(recordLossSchema, body).map((error) => error.field);
    assert.ok(fields({ productId: product._id.toString(), quantity: 0, reason: 'expired' }).includes('quantity'));
    assert.ok(fields({ productId: product._id.toString(), quantity: 1.5, reason: 'expired' }).includes('quantity'));
    assert.ok(fields({ productId: product._id.toString(), quantity: 1, reason: 'stolen' }).includes('reason'));
  });

  it('listLosses filtra por producto y motivo', async () => {
    await service.recordLoss(adminActor, lossDto({ productId: product._id.toString(), quantity: 1, reason: 'expired' }));
    await service.recordLoss(adminActor, lossDto({ productId: product._id.toString(), quantity: 1, reason: 'damaged' }));
    const result = await service.listLosses({ page: 1, limit: 20, productId: product._id.toString(), reason: 'damaged' });
    assert.equal(result.total, 1);
    assert.equal(result.items[0].reason, 'damaged');
  });
});

describe('InventoryService consultas', () => {
  it('getProduct devuelve precios, costo, imagen y datos del proveedor', async () => {
    const supplier = makeSupplier();
    const product = makeProduct({ priceCents: 20000, discountPercent: 10, costCents: 9000, supplierId: supplier._id, images: ['https://x/y.png'] });
    const deps = makeInventoryPurchaseDeps({ products: [product], suppliers: [supplier] });
    const service = new InventoryService({ ...deps });
    const dto = InventoryProductDetailDTO.from(await service.getProduct(product._id.toString()));
    assert.equal(dto.costPrice, 90);
    assert.equal(dto.salePrice, 200);
    assert.equal(dto.finalPrice, 180);
    assert.equal(dto.imageUrl, 'https://x/y.png');
    assert.equal(dto.supplier.supplierCode, supplier.supplierCode);
    assert.equal(dto.supplier.nit, supplier.nit);
    await assert.rejects(service.getProduct(new ObjectId().toString()), { status: 404 });
  });

  it('listProducts convierte precios a centavos y el filtro escapa la regex', async () => {
    const cheap = makeProduct({ name: 'Cafe (molido)', priceCents: 300 });
    const pricey = makeProduct({ name: 'Cafe premium', priceCents: 9000 });
    const deps = makeInventoryPurchaseDeps({ products: [cheap, pricey] });
    const service = new InventoryService({ ...deps });
    const query = { productName: 'cafe', minPrice: '5', maxPrice: '95.5' };
    assert.deepEqual(validateSchema(listInventoryQuerySchema, query), []);
    const result = await service.listProducts(ListInventoryQueryDTO.from(query));
    assert.deepEqual(result.items.map((item) => item.name), ['Cafe premium']);

    const filter = buildInventoryFilter({ productName: 'a.b(c', minPriceCents: 100, createdFrom: NOW });
    assert.equal(filter.name.$regex, 'a\\.b\\(c');
    assert.deepEqual(filter.priceCents, { $gte: 100 });
    assert.deepEqual(filter.createdAt, { $gte: NOW });
    assert.equal(validateSchema(listInventoryQuerySchema, { minPrice: '10', maxPrice: '5' }).length, 1);
  });
});
