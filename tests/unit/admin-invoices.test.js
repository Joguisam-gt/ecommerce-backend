/**
 * Pruebas de la facturacion administrativa (Fase 3, PARTE C2): filtro de
 * busqueda, validador, DTOs de cliente y proveedor, servicio y rutas.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { ROLES } from '../../src/constants/roles.js';
import { AdminInvoiceController } from '../../src/controllers/admin-invoice.controller.js';
import { AdminInvoiceDTO, ListAdminInvoicesQueryDTO } from '../../src/dtos/admin-invoice.dto.js';
import { buildAdminInvoiceFilter } from '../../src/repositories/admin-invoice.repository.js';
import { createAdminInvoiceRoutes } from '../../src/routes/admin-invoice.routes.js';
import { AdminInvoiceService } from '../../src/services/admin-invoice.service.js';
import { listAdminInvoicesQuerySchema } from '../../src/validators/admin-invoice.validator.js';
import { validateSchema } from '../../src/validators/schema-validator.js';
import { adminActor } from '../helpers/admin-fakes.js';
import { InMemoryAdminInvoiceRepository, startRouterApp } from '../helpers/customer-report-fakes.js';

/**
 * Factura valida con dos lineas.
 * @param {Partial<object>} overrides
 */
function makeInvoice(overrides = {}) {
  return {
    _id: new ObjectId(),
    invoiceNumber: 'FAC-000001',
    entityType: 'cliente',
    orderId: new ObjectId(),
    orderNumber: 'ORD-000001',
    userId: new ObjectId(),
    nit: '1234567-8',
    nitType: 'nit',
    entityName: 'Ana Perez',
    email: 'ana@example.com',
    paymentMethod: 'card',
    shippingAddress: { line1: '5a avenida 10-20', city: 'Guatemala', state: 'Guatemala', country: 'GT' },
    items: [
      { productId: new ObjectId(), sku: 'SKU-1', name: 'Teclado', quantity: 2, unitPriceCents: 10000, discountCents: 1000, taxRatePercent: 12, taxCents: 2280, totalCents: 21280 },
      { productId: new ObjectId(), sku: 'SKU-2', name: 'Raton', quantity: 1, unitPriceCents: 5000, discountCents: 0, taxRatePercent: 12, taxCents: 600, totalCents: 5600 },
    ],
    currency: 'GTQ',
    subtotalCents: 25000,
    discountTotalCents: 1000,
    taxTotalCents: 2880,
    grandTotalCents: 26880,
    status: 'paid',
    issuedAt: new Date('2026-02-01T10:00:00Z'),
    ...overrides,
  };
}

describe('buildAdminInvoiceFilter', () => {
  it('combina filtros exactos, regex escapadas, direccion y rango de issuedAt', () => {
    const criteria = ListAdminInvoicesQueryDTO.from({
      nit: '1234567-8',
      entityName: 'Perez (SA)',
      paymentMethod: 'card',
      shippingAddress: 'zona 10',
      email: 'ana@',
      entityType: 'proveedor',
      status: 'paid',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    const filter = buildAdminInvoiceFilter(criteria);
    assert.equal(filter.nit, '1234567-8');
    assert.deepEqual(filter.entityName, { $regex: 'Perez \\(SA\\)', $options: 'i' });
    assert.equal(filter.paymentMethod, 'card');
    assert.deepEqual(filter.email, { $regex: 'ana@', $options: 'i' });
    assert.equal(filter.entityType, 'proveedor');
    assert.equal(filter.status, 'paid');
    assert.deepEqual(
      filter.$or.map((condition) => Object.keys(condition)[0]),
      ['shippingAddress.line1', 'shippingAddress.city', 'shippingAddress.state'],
    );
    assert.deepEqual(filter.issuedAt, { $gte: new Date('2026-01-01T00:00:00.000Z'), $lte: new Date('2026-01-31T23:59:59.999Z') });
  });

  it("entityType 'cliente' incluye facturas antiguas sin entityType; sin filtros el filtro esta vacio", () => {
    assert.deepEqual(buildAdminInvoiceFilter({ entityType: 'cliente' }).entityType, { $in: ['cliente', null] });
    assert.deepEqual(buildAdminInvoiceFilter(ListAdminInvoicesQueryDTO.from({})), {});
  });
});

describe('Validador del listado admin de facturas', () => {
  it('rechaza endDate anterior a startDate, fechas invalidas y valores fuera de catalogo', () => {
    assert.equal(validateSchema(listAdminInvoicesQuerySchema, { startDate: '2026-02-01', endDate: '2026-01-01' })[0].field, 'endDate');
    assert.equal(validateSchema(listAdminInvoicesQuerySchema, { startDate: '2026-13-45' })[0].field, 'startDate');
    assert.equal(validateSchema(listAdminInvoicesQuerySchema, { entityType: 'otro' })[0].field, 'entityType');
    assert.deepEqual(validateSchema(listAdminInvoicesQuerySchema, { startDate: '2026-01-01', endDate: '2026-01-01', entityType: 'cliente' }), []);
  });
});

describe('AdminInvoiceDTO', () => {
  it('detalle de cliente: desglose de lineas, totales en unidades y orderNumber', () => {
    const dto = AdminInvoiceDTO.detail(makeInvoice());
    assert.equal(dto.entityType, 'cliente');
    assert.equal(dto.orderNumber, 'ORD-000001');
    assert.equal(dto.supplierId, undefined);
    assert.deepEqual(
      { ...dto.items[0], productId: undefined },
      { productId: undefined, sku: 'SKU-1', name: 'Teclado', quantity: 2, unitPrice: 100, lineSubtotal: 200, discount: 10, taxRatePercent: 12, tax: 22.8, total: 212.8 },
    );
    assert.deepEqual(dto.totals, { subtotal: 250, discountTotal: 10, taxTotal: 28.8, grandTotal: 268.8 });
  });

  it('detalle de proveedor: supplierId y purchaseId en lugar de pedido', () => {
    const supplierId = new ObjectId();
    const purchaseId = new ObjectId();
    const invoice = makeInvoice({ entityType: 'proveedor', supplierId, purchaseId, orderId: undefined, orderNumber: undefined, userId: undefined, email: null });
    const dto = AdminInvoiceDTO.detail(invoice);
    assert.equal(dto.supplierId, supplierId.toString());
    assert.equal(dto.purchaseId, purchaseId.toString());
    assert.equal(dto.orderNumber, undefined);
  });

  it('factura antigua sin entityType se presenta como de cliente; el resumen no incluye lineas', () => {
    const { entityType: _omit, ...legacy } = makeInvoice();
    const summary = AdminInvoiceDTO.summary(legacy);
    assert.equal(summary.entityType, 'cliente');
    assert.equal(summary.itemsCount, 2);
    assert.equal(summary.items, undefined);
    assert.equal(summary.grandTotal, 268.8);
  });
});

describe('AdminInvoiceService y rutas', () => {
  const invoice = makeInvoice();
  let app;

  before(async () => {
    const adminInvoiceService = new AdminInvoiceService({ adminInvoiceRepository: new InMemoryAdminInvoiceRepository([invoice]) });
    const router = createAdminInvoiceRoutes({ adminInvoiceController: new AdminInvoiceController({ adminInvoiceService }) });
    app = await startRouterApp(router, { admin: adminActor, user: { id: new ObjectId().toString(), role: ROLES.USER } });
  });

  after(() => app.close());

  it('servicio: 404 para id inexistente o mal formado', async () => {
    const service = new AdminInvoiceService({ adminInvoiceRepository: new InMemoryAdminInvoiceRepository() });
    await assert.rejects(service.getInvoice(new ObjectId().toString()), { status: 404, code: 'INVOICE_NOT_FOUND' });
    await assert.rejects(service.getInvoice('x'), { status: 404 });
  });

  it('GET / y GET /:id para admin', async () => {
    const list = await app.call('/?entityType=cliente&page=1&limit=10', { role: 'admin' });
    assert.equal(list.status, 200);
    assert.equal(list.body.meta.total, 1);
    const detail = await app.call(`/${invoice._id}`, { role: 'admin' });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.items.length, 2);
  });

  it('sin invoices:manage responde 403; query invalida responde 400', async () => {
    assert.equal((await app.call('/', { role: 'user' })).status, 403);
    assert.equal((await app.call('/?startDate=2026-02-01&endDate=2026-01-01', { role: 'admin' })).status, 400);
  });
});
