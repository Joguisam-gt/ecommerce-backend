/**
 * Pruebas de compras a proveedores (Fase 3, parte B): transaccion ACID de
 * ingreso de mercaderia con factura contable automatica de proveedor,
 * rollback completo ante fallos, cumplimiento de los $jsonSchema de purchases
 * e invoices, auditoria y validacion de entrada.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { INVOICE_ENTITY_TYPES, PAYMENT_METHODS } from '../../src/constants/commerce.js';
import { invoicesCollection } from '../../src/database/schemas/invoices.schema.js';
import { purchasesCollection } from '../../src/database/schemas/purchases.schema.js';
import { CreatePurchaseDTO, PurchaseDTO } from '../../src/dtos/purchase.dto.js';
import { AUDIT_ACTIONS } from '../../src/services/audit.service.js';
import { PurchaseService } from '../../src/services/purchase.service.js';
import { createPurchaseSchema } from '../../src/validators/purchase.validator.js';
import { validateSchema } from '../../src/validators/schema-validator.js';
import { adminActor } from '../helpers/admin-fakes.js';
import { jsonSchemaErrors, makeProduct } from '../helpers/checkout-fakes.js';
import { makeInventoryPurchaseDeps, makeSupplier } from '../helpers/inventory-purchase-fakes.js';

const NOW = new Date('2026-06-01T10:00:00Z');
const PURCHASE_SCHEMA = purchasesCollection.validator.$jsonSchema;
const INVOICE_SCHEMA = invoicesCollection.validator.$and[0].$jsonSchema;
const SUPPLIER_BRANCH = invoicesCollection.validator.$and[1].$or.find(
  (branch) => branch.entityType === INVOICE_ENTITY_TYPES.SUPPLIER,
);

/**
 * Valida el cuerpo como lo haria el middleware y construye el DTO.
 * @param {object} body
 */
function dtoFrom(body) {
  const errors = validateSchema(createPurchaseSchema, body);
  assert.deepEqual(errors, [], `el cuerpo de prueba deberia ser valido: ${JSON.stringify(errors)}`);
  return CreatePurchaseDTO.from(body);
}

/**
 * Comprueba la rama "proveedor" del $or de invoices ({ campo: valor } o { campo: { $type } }).
 * @param {object} invoice
 */
function matchesSupplierBranch(invoice) {
  return Object.entries(SUPPLIER_BRANCH).every(([field, condition]) => {
    if (condition && typeof condition === 'object' && condition.$type === 'objectId') return invoice[field] instanceof ObjectId;
    return invoice[field] === condition;
  });
}

describe('PurchaseService.createPurchase', () => {
  let supplier;
  let p1;
  let p2;
  let deps;
  let service;

  beforeEach(() => {
    p1 = makeProduct({ stock: 10, costCents: 500 });
    p2 = makeProduct({ stock: 0, costCents: null });
    supplier = makeSupplier({ catalog: [{ productId: p1._id, costCents: 500 }] });
    deps = makeInventoryPurchaseDeps({ products: [p1, p2], suppliers: [supplier] });
    service = new PurchaseService({
      ...deps,
      storeConfig: { currency: 'GTQ', invoiceNumberPrefix: 'FAC' },
      clock: () => NOW,
    });
  });

  const body = (overrides = {}) => ({
    supplierId: supplier._id.toString(),
    items: [
      { productId: p1._id.toString(), quantity: 5, unitCost: 6.25 },
      { productId: p2._id.toString(), quantity: 3, unitCost: 10 },
    ],
    supplierInvoiceNumber: 'A-123',
    ...overrides,
  });

  it('ingresa stock, actualiza costos y genera la compra y la factura de proveedor enlazadas', async () => {
    const { purchase, invoice } = await service.createPurchase(adminActor, dtoFrom(body()), { ip: '127.0.0.1' });

    // Stock y costo actualizados.
    assert.equal(deps.inventoryStockRepository.peek(p1._id).stock, 15);
    assert.equal(deps.inventoryStockRepository.peek(p1._id).costCents, 625);
    assert.equal(deps.inventoryStockRepository.peek(p2._id).stock, 3);
    assert.equal(deps.inventoryStockRepository.peek(p2._id).costCents, 1000);

    // Catalogo del proveedor: costo actualizado y producto nuevo agregado.
    const catalog = deps.supplierRepository.peek(supplier._id).catalog;
    assert.deepEqual(
      catalog.map((entry) => [entry.productId.toString(), entry.costCents]),
      [
        [p1._id.toString(), 625],
        [p2._id.toString(), 1000],
      ],
    );

    // Compra.
    assert.equal(purchase.purchaseNumber, 'PUR-000001');
    assert.equal(purchase.paymentMethod, PAYMENT_METHODS.BANK_TRANSFER);
    assert.equal(purchase.totalCostCents, 3125 + 3000);
    assert.deepEqual(
      purchase.items.map((item) => [item.previousCostCents, item.unitCostCents, item.totalCents]),
      [
        [500, 625, 3125],
        [null, 1000, 3000],
      ],
    );
    assert.deepEqual(purchase.supplier, { supplierCode: supplier.supplierCode, name: supplier.name, nit: supplier.nit });
    assert.equal(purchase.createdBy.toString(), adminActor.id);
    assert.equal(deps.purchaseRepository.all().length, 1);

    // Factura enlazada.
    assert.ok(purchase.invoiceId.equals(invoice._id));
    assert.ok(invoice.purchaseId.equals(purchase._id));
    assert.ok(invoice.supplierId.equals(supplier._id));
    assert.equal(invoice.entityType, INVOICE_ENTITY_TYPES.SUPPLIER);
    assert.equal(invoice.invoiceNumber, 'FAC-00000001');
    assert.equal(invoice.nit, supplier.nit);
    assert.equal(invoice.nitType, 'nit');
    assert.equal(invoice.entityName, supplier.name);
    assert.equal(invoice.email, supplier.email);
    assert.equal(invoice.status, 'paid');
    assert.equal(invoice.currency, 'GTQ');
    assert.equal(invoice.shippingAddress, null);
    assert.equal(invoice.subtotalCents, 6125);
    assert.equal(invoice.grandTotalCents, 6125);
    assert.equal(invoice.taxTotalCents, 0);
    assert.equal(invoice.discountTotalCents, 0);
    assert.equal(
      invoice.items.reduce((sum, item) => sum + item.totalCents, 0),
      invoice.grandTotalCents,
    );
    assert.deepEqual(invoice.items.map((item) => item.unitPriceCents), [625, 1000]);
    assert.equal(invoice.orderId, undefined);
    assert.equal(invoice.userId, undefined);

    // $jsonSchema exactos.
    assert.deepEqual(jsonSchemaErrors(deps.purchaseRepository.peek(purchase._id), PURCHASE_SCHEMA), []);
    const storedInvoice = deps.supplierInvoiceRepository.peek(invoice._id);
    assert.deepEqual(jsonSchemaErrors(storedInvoice, INVOICE_SCHEMA), []);
    assert.ok(matchesSupplierBranch(storedInvoice), 'la factura debe cumplir la rama proveedor del validador');

    // Auditoria tras el commit.
    assert.equal(deps.auditService.changes.length, 1);
    const [change] = deps.auditService.changes;
    assert.equal(change.action, AUDIT_ACTIONS.PURCHASE_CREATED);
    assert.equal(change.targetCollection, 'purchases');
    assert.equal(change.targetId.toString(), purchase._id.toString());
    assert.equal(change.previousState, null);
    assert.equal(change.newState.purchaseNumber, 'PUR-000001');
    assert.equal(change.context.ip, '127.0.0.1');
    assert.equal(change.metadata.invoiceNumber, 'FAC-00000001');
    assert.equal(deps.transactionRunner.stats.committed, 1);

    // DTO de salida en unidades decimales con la factura.
    const dto = PurchaseDTO.from(purchase, invoice);
    assert.equal(dto.totalCost, 61.25);
    assert.equal(dto.items[0].previousCost, 5);
    assert.equal(dto.invoice.grandTotal, 61.25);
    assert.equal(dto.invoice.entityType, 'proveedor');
  });

  it('usa la misma secuencia de facturas que el checkout y numera correlativamente', async () => {
    await deps.sequenceRepository.next('invoice', { session: {} });
    const { invoice, purchase } = await service.createPurchase(adminActor, dtoFrom(body({ paymentMethod: 'card' })));
    assert.equal(invoice.invoiceNumber, 'FAC-00000002');
    assert.equal(invoice.paymentMethod, 'card');
    assert.equal(purchase.paymentMethod, 'card');
  });

  it('factura con email null si el proveedor no tiene correo y cumple el esquema', async () => {
    deps.supplierRepository.peek(supplier._id).email = null;
    const { invoice } = await service.createPurchase(adminActor, dtoFrom(body()));
    assert.equal(invoice.email, null);
    assert.deepEqual(jsonSchemaErrors(deps.supplierInvoiceRepository.peek(invoice._id), INVOICE_SCHEMA), []);
  });

  /** Estado que no debe cambiar tras un rollback. */
  const assertUntouched = () => {
    assert.equal(deps.inventoryStockRepository.peek(p1._id).stock, 10);
    assert.equal(deps.inventoryStockRepository.peek(p1._id).costCents, 500);
    assert.equal(deps.inventoryStockRepository.peek(p2._id).stock, 0);
    assert.equal(deps.inventoryStockRepository.peek(p2._id).costCents, null);
    assert.equal(deps.supplierRepository.peek(supplier._id).catalog.length, 1);
    assert.equal(deps.supplierRepository.peek(supplier._id).catalog[0].costCents, 500);
    assert.equal(deps.purchaseRepository.all().length, 0);
    assert.equal(deps.supplierInvoiceRepository.all().length, 0);
    assert.equal(deps.sequenceRepository.peek('purchase'), 0);
    assert.equal(deps.sequenceRepository.peek('invoice'), 0);
    assert.equal(deps.auditService.changes.length, 0);
  };

  it('revierte todo si un producto no existe (422)', async () => {
    const missing = new ObjectId().toString();
    const items = [...body().items, { productId: missing, quantity: 1, unitCost: 1 }];
    await assert.rejects(service.createPurchase(adminActor, dtoFrom(body({ items }))), (error) => {
      assert.equal(error.status, 422);
      assert.equal(error.code, 'PRODUCT_NOT_FOUND');
      assert.deepEqual(error.details.productIds, [missing]);
      return true;
    });
    assertUntouched();
  });

  it('revierte stock, costos, catalogo y compra si falla la insercion de la factura', async () => {
    deps.supplierInvoiceRepository.failInsert = true;
    await assert.rejects(service.createPurchase(adminActor, dtoFrom(body())), /Fallo simulado/);
    assertUntouched();
    assert.equal(deps.transactionRunner.stats.rolledBack, 1);
  });

  it('rechaza proveedor inexistente (404) o inactivo (409) sin cambios', async () => {
    await assert.rejects(service.createPurchase(adminActor, dtoFrom(body({ supplierId: new ObjectId().toString() }))), {
      status: 404,
      code: 'SUPPLIER_NOT_FOUND',
    });
    deps.supplierRepository.peek(supplier._id).isActive = false;
    await assert.rejects(service.createPurchase(adminActor, dtoFrom(body())), { status: 409, code: 'SUPPLIER_INACTIVE' });
    assertUntouched();
  });

  it('rechaza una fecha de compra futura (422)', async () => {
    await assert.rejects(service.createPurchase(adminActor, dtoFrom(body({ purchasedAt: '2026-07-01T00:00:00Z' }))), {
      status: 422,
      code: 'PURCHASE_DATE_IN_FUTURE',
    });
    assertUntouched();
  });

  it('getPurchase devuelve la compra con su factura y 404 si no existe', async () => {
    const created = await service.createPurchase(adminActor, dtoFrom(body()));
    const { purchase, invoice } = await service.getPurchase(created.purchase._id.toString());
    assert.equal(purchase.purchaseNumber, 'PUR-000001');
    assert.ok(invoice._id.equals(created.invoice._id));
    await assert.rejects(service.getPurchase(new ObjectId().toString()), { status: 404 });
  });
});

describe('createPurchaseSchema', () => {
  const productId = new ObjectId().toString();
  const valid = () => ({ supplierId: new ObjectId().toString(), items: [{ productId, quantity: 2, unitCost: 3.5 }] });

  it('acepta un cuerpo valido', () => {
    assert.deepEqual(validateSchema(createPurchaseSchema, valid()), []);
  });

  it('rechaza productos repetidos, listas vacias, cantidades invalidas y campos desconocidos', () => {
    const fields = (body) => validateSchema(createPurchaseSchema, body).map((error) => error.field);
    assert.ok(fields({ ...valid(), items: [] }).includes('items'));
    assert.ok(fields({ supplierId: new ObjectId().toString() }).includes('items'));
    assert.ok(
      fields({ ...valid(), items: [{ productId, quantity: 1, unitCost: 1 }, { productId, quantity: 2, unitCost: 1 }] }).includes(
        'items[1].productId',
      ),
    );
    assert.ok(fields({ ...valid(), items: [{ productId, quantity: 0, unitCost: 1 }] }).includes('items[0].quantity'));
    assert.ok(fields({ ...valid(), items: [{ productId, quantity: 1, unitCost: 1.234 }] }).includes('items[0].unitCost'));
    assert.ok(fields({ ...valid(), invoiceId: 'x' }).includes('invoiceId'));
    assert.ok(fields({ ...valid(), paymentMethod: 'bitcoin' }).includes('paymentMethod'));
  });

  it('el DTO convierte el costo a centavos y aplica el metodo de pago por defecto', () => {
    const dto = CreatePurchaseDTO.from(valid());
    assert.equal(dto.items[0].unitCostCents, 350);
    assert.equal(dto.paymentMethod, PAYMENT_METHODS.BANK_TRANSFER);
    assert.equal(dto.notes, null);
  });
});
