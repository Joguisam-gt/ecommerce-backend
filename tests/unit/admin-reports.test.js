/**
 * Pruebas de los reportes analiticos (Fase 3, PARTE C3): estructura del
 * pipeline general ($facet y filtros), mermas, inventario, desempeno de
 * proveedor, recomendacion por umbrales, servicio, DTOs y rutas.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { REVENUE_ORDER_STATUSES } from '../../src/constants/commerce.js';
import { ROLES } from '../../src/constants/roles.js';
import { ReportController } from '../../src/controllers/report.controller.js';
import { GeneralReportQueryDTO, ReportResponseDTO, parseDateRange } from '../../src/dtos/report.dto.js';
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  SUPPLIER_RECOMMENDATIONS as R,
  buildGeneralReportPipeline,
  buildInventoryStatusPipeline,
  buildLossesReportPipeline,
  buildSupplierPerformancePipeline,
  recommendSupplierAction,
} from '../../src/repositories/pipelines/report.pipeline.js';
import { createReportRoutes } from '../../src/routes/report.routes.js';
import { ReportService } from '../../src/services/report.service.js';
import { generalReportQuerySchema } from '../../src/validators/report.validator.js';
import { validateSchema } from '../../src/validators/schema-validator.js';
import { adminActor } from '../helpers/admin-fakes.js';
import { FakeReportRepository, startRouterApp } from '../helpers/customer-report-fakes.js';

/** Indice de la primera etapa de nivel superior con el operador. */
const indexOf = (pipeline, operator) => pipeline.findIndex((stage) => Object.hasOwn(stage, operator));

const start = new Date('2026-01-01T00:00:00Z');
const end = new Date('2026-01-31T23:59:59.999Z');

describe('Pipeline del reporte general', () => {
  it('un unico $facet con las cuatro facetas requeridas', () => {
    const pipeline = buildGeneralReportPipeline({});
    const facets = pipeline.filter((stage) => stage.$facet);
    assert.equal(facets.length, 1);
    assert.deepEqual(Object.keys(facets[0].$facet).sort(), ['couponRanking', 'paymentMethodBreakdown', 'salesSummary', 'topProducts']);
    assert.equal(indexOf(pipeline, '$facet'), pipeline.length - 1);
  });

  it('filtra fechas y ventas efectivas a nivel pedido, en la primera etapa', () => {
    const pipeline = buildGeneralReportPipeline({ startDate: start, endDate: end });
    assert.deepEqual(pipeline[0], {
      $match: { status: { $in: [...REVENUE_ORDER_STATUSES] }, createdAt: { $gte: start, $lte: end } },
    });
  });

  it('categoria y nombre se filtran por linea: tras $unwind de items y $lookup a products', () => {
    const pipeline = buildGeneralReportPipeline({ category: 'Perifericos', productName: 'tecla+do' });
    const unwind = indexOf(pipeline, '$unwind');
    const lookup = indexOf(pipeline, '$lookup');
    const lineMatch = pipeline.findIndex((stage, index) => index > 0 && stage.$match);
    assert.deepEqual(pipeline[unwind], { $unwind: '$items' });
    assert.equal(pipeline[lookup].$lookup.from, 'products');
    assert.ok(unwind < lookup && lookup < lineMatch && lineMatch < indexOf(pipeline, '$facet'));
    assert.deepEqual(pipeline[lineMatch].$match, {
      'line.category': { $regex: '^Perifericos$', $options: 'i' },
      'items.name': { $regex: 'tecla\\+do', $options: 'i' },
    });
    // Sin filtros de linea no hay $match intermedio.
    assert.equal(buildGeneralReportPipeline({}).filter((stage) => stage.$match).length, 1);
  });

  it('facetas: ticket promedio, metodo de pago, ranking de cupones y top de productos con limite', () => {
    const { $facet: facet } = buildGeneralReportPipeline({ topLimit: 3 }).at(-1);
    assert.ok(facet.salesSummary.at(-1).$project.averageTicketCents);
    assert.deepEqual(facet.paymentMethodBreakdown[1].$group._id, '$method');
    assert.deepEqual(facet.couponRanking[0], { $match: { 'coupon.code': { $type: 'string' } } });
    assert.deepEqual(facet.couponRanking.at(-1), { $limit: 3 });
    assert.ok(facet.topProducts.some((stage) => stage.$limit === 3));
  });
});

describe('Pipelines de mermas e inventario', () => {
  it('mermas: mismos filtros (occurredAt, categoria, nombre) y desglose por motivo', () => {
    const pipeline = buildLossesReportPipeline({ startDate: start, endDate: end, category: 'Lacteos', productName: 'leche' });
    assert.deepEqual(pipeline[0].$match, {
      occurredAt: { $gte: start, $lte: end },
      category: { $regex: '^Lacteos$', $options: 'i' },
      productName: { $regex: 'leche', $options: 'i' },
    });
    assert.equal(pipeline[1].$facet.byReason[0].$group._id, '$reason');
    assert.ok(pipeline[1].$facet.totals);
  });

  it('inventario: umbral de stock bajo configurable (por defecto 5) y valor de inventario', () => {
    const byDefault = buildInventoryStatusPipeline({});
    assert.deepEqual(byDefault[1].$project.lowStock, { $lte: ['$stock', DEFAULT_LOW_STOCK_THRESHOLD] });
    const custom = buildInventoryStatusPipeline({ lowStockThreshold: 12, category: 'X' });
    assert.deepEqual(custom[1].$project.lowStock, { $lte: ['$stock', 12] });
    assert.deepEqual(custom[0].$match.category, { $regex: '^X$', $options: 'i' });
    assert.ok(custom[1].$project.inventoryCostCents.$multiply);
  });
});

describe('Pipeline de desempeno de proveedor', () => {
  it('producto por _id con $lookup a suppliers, orders e inventory_losses y rango de fechas', () => {
    const productId = new ObjectId();
    const pipeline = buildSupplierPerformancePipeline(productId, { startDate: start, endDate: end });
    assert.deepEqual(pipeline[0], { $match: { _id: productId } });
    const lookups = pipeline.filter((stage) => stage.$lookup).map((stage) => stage.$lookup);
    assert.deepEqual(lookups.map((lookup) => lookup.from), ['suppliers', 'orders', 'inventory_losses']);
    assert.deepEqual(Object.keys(lookups[0].pipeline[1].$project).sort(), ['_id', 'distributionDescription', 'name', 'phone', 'supplierCode']);
    assert.deepEqual(lookups[1].pipeline[0].$match.createdAt, { $gte: start, $lte: end });
    assert.ok(lookups[1].pipeline[0].$match.status.$in.includes('refunded'));
    assert.deepEqual(lookups[2].pipeline[0].$match, { productId, occurredAt: { $gte: start, $lte: end } });
    const fields = Object.assign({}, ...pipeline.filter((stage) => stage.$project || stage.$set).map((stage) => stage.$project ?? stage.$set));
    for (const field of ['unitsSold', 'revenueCents', 'returnedUnits', 'returnRate', 'lossUnits', 'lossCostCents', 'costPriceCents', 'salePriceCents', 'grossMarginPercent']) {
      assert.ok(Object.hasOwn(fields, field), `falta ${field}`);
    }
  });
});

describe('recommendSupplierAction (umbrales)', () => {
  it("'continuar' con devoluciones bajas y buen margen", () => {
    assert.equal(recommendSupplierAction({ returnRate: 0.02, grossMarginPercent: 35 }).recommendation, R.CONTINUE);
  });

  it("'evaluar' con devolucion >= 10 %, margen < 20 % o margen desconocido", () => {
    assert.equal(recommendSupplierAction({ returnRate: 0.1, grossMarginPercent: 35 }).recommendation, R.EVALUATE);
    assert.equal(recommendSupplierAction({ returnRate: 0, grossMarginPercent: 19.99 }).recommendation, R.EVALUATE);
    assert.equal(recommendSupplierAction({ returnRate: 0, grossMarginPercent: null }).recommendation, R.EVALUATE);
  });

  it("'cambiar_proveedor' con devolucion >= 20 % o margen < 5 % (prevalece sobre evaluar)", () => {
    assert.equal(recommendSupplierAction({ returnRate: 0.2, grossMarginPercent: 50 }).recommendation, R.CHANGE);
    assert.equal(recommendSupplierAction({ returnRate: 0, grossMarginPercent: 4.9 }).recommendation, R.CHANGE);
    const both = recommendSupplierAction({ returnRate: 0.5, grossMarginPercent: -10 });
    assert.equal(both.recommendation, R.CHANGE);
    assert.equal(both.reasons.length, 2);
  });

  it('acepta umbrales personalizados', () => {
    const strict = { returnRate: { evaluate: 0.01, change: 0.05 }, marginPercent: { evaluate: 40, change: 30 } };
    assert.equal(recommendSupplierAction({ returnRate: 0.02, grossMarginPercent: 35 }, strict).recommendation, R.EVALUATE);
  });
});

describe('ReportService', () => {
  it('reporte general: ejecuta ventas, mermas e inventario con los mismos filtros', async () => {
    const repository = new FakeReportRepository();
    const service = new ReportService({ reportRepository: repository });
    const filters = GeneralReportQueryDTO.from({ startDate: '2026-01-01', endDate: '2026-01-31', category: 'X' });
    const report = await service.generalReport(filters);
    assert.deepEqual(repository.calls.map((call) => call.method).sort(), ['inventoryStatus', 'lossesSummary', 'salesFacets']);
    assert.ok(repository.calls.every((call) => call.args[0] === filters));

    const dto = ReportResponseDTO.general(report);
    assert.deepEqual(Object.keys(dto).sort(), ['couponRanking', 'filters', 'inventoryStatus', 'losses', 'paymentMethodBreakdown', 'salesSummary', 'topProducts']);
    assert.deepEqual(dto.salesSummary, { revenue: 1234.5, ordersCount: 3, unitsSold: 7, averageTicket: 411.5 });
    assert.equal(dto.losses.totalLoss, 20);
    assert.equal(dto.filters.lowStockThreshold, DEFAULT_LOW_STOCK_THRESHOLD);
    assert.deepEqual(dto.filters.endDate, end);
  });

  it('rechaza endDate anterior a startDate', async () => {
    const service = new ReportService({ reportRepository: new FakeReportRepository() });
    await assert.rejects(service.generalReport({ startDate: end, endDate: start }), { status: 400, code: 'INVALID_DATE_RANGE' });
  });

  it('supplier-performance: 404 si el producto no existe y anade la recomendacion', async () => {
    const repository = new FakeReportRepository();
    const service = new ReportService({ reportRepository: repository });
    await assert.rejects(service.supplierPerformance(new ObjectId().toString(), {}), { status: 404, code: 'PRODUCT_NOT_FOUND' });

    repository.performanceRow = { productId: new ObjectId(), returnRate: 0.25, grossMarginPercent: 30, unitsSold: 30, revenueCents: 1000 };
    const row = await service.supplierPerformance(new ObjectId().toString(), {});
    assert.equal(row.recommendation, R.CHANGE);
    assert.deepEqual(row.recommendationReasons, ['tasa de devolucion muy alta']);
  });
});

describe('Validacion y rutas de reportes', () => {
  let app;
  let repository;

  before(async () => {
    repository = new FakeReportRepository();
    const reportService = new ReportService({ reportRepository: repository });
    const router = createReportRoutes({ reportController: new ReportController({ reportService }) });
    app = await startRouterApp(router, { admin: adminActor, user: { id: new ObjectId().toString(), role: ROLES.USER } });
  });

  after(() => app.close());

  it('validador: endDate >= startDate y endDate sin hora abarca el dia completo', () => {
    assert.equal(validateSchema(generalReportQuerySchema, { startDate: '2026-02-01', endDate: '2026-01-31' })[0].field, 'endDate');
    assert.deepEqual(validateSchema(generalReportQuerySchema, { startDate: '2026-01-31', endDate: '2026-01-31' }), []);
    assert.deepEqual(parseDateRange({ startDate: '2026-01-31', endDate: '2026-01-31' }), {
      startDate: new Date('2026-01-31T00:00:00.000Z'),
      endDate: new Date('2026-01-31T23:59:59.999Z'),
    });
  });

  it('GET /general responde la estructura consolidada; 400 con rango invalido; 403 sin reports:read', async () => {
    const ok = await app.call('/general?startDate=2026-01-01&endDate=2026-01-31&lowStockThreshold=3', { role: 'admin' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.inventoryStatus.lowStockThreshold, 3);
    assert.equal((await app.call('/general?startDate=2026-02-01&endDate=2026-01-01', { role: 'admin' })).status, 400);
    assert.equal((await app.call('/general', { role: 'user' })).status, 403);
  });

  it('GET /products/:id/supplier-performance: 404 sin producto y 200 con recomendacion', async () => {
    repository.performanceRow = null;
    assert.equal((await app.call(`/products/${new ObjectId()}/supplier-performance`, { role: 'admin' })).status, 404);

    const supplierId = new ObjectId();
    repository.performanceRow = {
      productId: new ObjectId(),
      sku: 'SKU-1',
      name: 'Teclado',
      category: 'Perifericos',
      isActive: true,
      stock: 4,
      supplier: { _id: supplierId, supplierCode: 'PRV-000001', name: 'Distribuidora', phone: null, distributionDescription: 'Nacional' },
      costPriceCents: 6000,
      salePriceCents: 10000,
      effectivePriceCents: 10000,
      unitsSold: 10,
      revenueCents: 112000,
      netRevenueCents: 100000,
      returnedUnits: 0,
      returnRate: 0,
      lossUnits: 1,
      lossCostCents: 6000,
      grossProfitCents: 40000,
      unitMarginCents: 4000,
      grossMarginPercent: 40,
      marginBasis: 'ventas',
    };
    const ok = await app.call(`/products/${new ObjectId()}/supplier-performance?startDate=2026-01-01`, { role: 'admin' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.recommendation, R.CONTINUE);
    assert.equal(ok.body.data.supplier.id, supplierId.toString());
    assert.deepEqual(ok.body.data.grossMargin, { percent: 40, grossProfit: 400, unitMargin: 40, basis: 'ventas' });
    assert.equal(ok.body.data.costPrice, 60);
    assert.equal(ok.body.data.lossCost, 60);
  });
});
