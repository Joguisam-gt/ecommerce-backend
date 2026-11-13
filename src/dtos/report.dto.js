/**
 * DTOs de reportes: parametros de entrada (fechas y umbrales ya tipados) y
 * respuesta consolidada con importes en unidades decimales.
 */
import { fromCents } from '../utils/money.js';
import { DEFAULT_LOW_STOCK_THRESHOLD, DEFAULT_TOP_LIMIT } from '../repositories/pipelines/report.pipeline.js';

/** Fecha sin hora (AAAA-MM-DD). */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convierte startDate / endDate a Date. Una endDate sin hora incluye el dia
 * completo (23:59:59.999 UTC) para que "hasta el 31" abarque ese dia.
 * @param {{ startDate?: string, endDate?: string }} query
 * @returns {{ startDate?: Date, endDate?: Date }}
 */
export function parseDateRange(query) {
  const range = {};
  if (query.startDate) range.startDate = new Date(query.startDate.trim());
  if (query.endDate) {
    const raw = query.endDate.trim();
    range.endDate = DATE_ONLY.test(raw) ? new Date(`${raw}T23:59:59.999Z`) : new Date(raw);
  }
  return range;
}

/**
 * Convierte centavos a decimales tolerando null (dato desconocido).
 * @param {number | null | undefined} cents
 */
const money = (cents) => (cents === null || cents === undefined ? null : fromCents(cents));

/**
 * Rango aplicado en formato de respuesta.
 * @param {{ startDate?: Date, endDate?: Date }} range
 */
const rangeOf = (range) => ({ startDate: range.startDate ?? null, endDate: range.endDate ?? null });

export class GeneralReportQueryDTO {
  /** @param {Record<string, string>} query Query string validada. */
  static from(query) {
    return Object.freeze({
      ...parseDateRange(query),
      category: query.category?.trim() || undefined,
      productName: query.productName?.trim() || undefined,
      lowStockThreshold: query.lowStockThreshold !== undefined ? Number(query.lowStockThreshold) : DEFAULT_LOW_STOCK_THRESHOLD,
      topLimit: query.topLimit !== undefined ? Number(query.topLimit) : DEFAULT_TOP_LIMIT,
    });
  }
}

export class SupplierPerformanceQueryDTO {
  /** @param {Record<string, string>} query */
  static from(query) {
    return Object.freeze(parseDateRange(query));
  }
}

export class ReportResponseDTO {
  /**
   * Reporte general consolidado.
   * @param {{ sales: object, losses: object, inventory: object, filters: object }} report Resultado de ReportService.
   */
  static general({ sales, losses, inventory, filters }) {
    const summary = sales.salesSummary;
    return {
      salesSummary: {
        revenue: fromCents(summary.revenueCents),
        ordersCount: summary.ordersCount,
        unitsSold: summary.unitsSold,
        averageTicket: fromCents(summary.averageTicketCents),
      },
      paymentMethodBreakdown: sales.paymentMethodBreakdown.map((row) => ({
        method: row.method,
        ordersCount: row.ordersCount,
        revenue: fromCents(row.revenueCents),
      })),
      couponRanking: sales.couponRanking.map((row) => ({
        code: row.code,
        uses: row.uses,
        totalDiscount: fromCents(row.totalDiscountCents),
        revenue: fromCents(row.revenueCents),
      })),
      topProducts: sales.topProducts.map((row) => ({
        productId: row.productId?.toString() ?? null,
        sku: row.sku,
        name: row.name,
        category: row.category,
        unitsSold: row.unitsSold,
        revenue: fromCents(row.revenueCents),
        ordersCount: row.ordersCount,
      })),
      losses: {
        totalUnits: losses.totals.units,
        totalLoss: fromCents(losses.totals.totalLossCents),
        records: losses.totals.records,
        byReason: losses.byReason.map((row) => ({
          reason: row.reason,
          units: row.units,
          totalLoss: fromCents(row.totalLossCents),
          records: row.records,
        })),
      },
      inventoryStatus: {
        lowStockThreshold: filters.lowStockThreshold,
        totals: {
          products: inventory.totals.products,
          units: inventory.totals.units,
          inventoryCost: fromCents(inventory.totals.inventoryCostCents),
          inventoryRetail: fromCents(inventory.totals.inventoryRetailCents),
          lowStockCount: inventory.totals.lowStockCount,
        },
        products: inventory.products.map((row) => ({
          productId: row.productId?.toString() ?? null,
          sku: row.sku,
          name: row.name,
          category: row.category,
          isActive: row.isActive,
          stock: row.stock,
          costPrice: money(row.costCents),
          salePrice: money(row.priceCents),
          inventoryCost: fromCents(row.inventoryCostCents),
          inventoryRetail: fromCents(row.inventoryRetailCents),
          lowStock: row.lowStock,
        })),
      },
      filters: {
        ...rangeOf(filters),
        category: filters.category ?? null,
        productName: filters.productName ?? null,
        lowStockThreshold: filters.lowStockThreshold,
        topLimit: filters.topLimit,
      },
    };
  }

  /**
   * Desempeno del proveedor de un producto.
   * @param {object} row Resultado del pipeline mas recommendation/recommendationReasons.
   * @param {{ startDate?: Date, endDate?: Date }} range
   */
  static supplierPerformance(row, range) {
    const supplier = row.supplier;
    return {
      productId: row.productId.toString(),
      sku: row.sku,
      name: row.name,
      category: row.category,
      isActive: row.isActive,
      stock: row.stock,
      supplier: supplier
        ? {
            id: supplier._id.toString(),
            supplierCode: supplier.supplierCode,
            name: supplier.name,
            phone: supplier.phone ?? null,
            distributionDescription: supplier.distributionDescription ?? null,
          }
        : null,
      unitsSold: row.unitsSold,
      revenue: fromCents(row.revenueCents),
      netRevenue: fromCents(row.netRevenueCents),
      returnedUnits: row.returnedUnits,
      returnRate: row.returnRate,
      lossUnits: row.lossUnits,
      lossCost: fromCents(row.lossCostCents),
      costPrice: money(row.costPriceCents),
      salePrice: money(row.salePriceCents),
      effectivePrice: money(row.effectivePriceCents),
      grossMargin: {
        percent: row.grossMarginPercent ?? null,
        grossProfit: money(row.grossProfitCents),
        unitMargin: money(row.unitMarginCents),
        basis: row.marginBasis ?? null,
      },
      recommendation: row.recommendation,
      recommendationReasons: row.recommendationReasons,
      period: rangeOf(range),
    };
  }
}
