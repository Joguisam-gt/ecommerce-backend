/**
 * Repositorio de reportes analiticos (Fase 3).
 *
 * Solo ejecuta los pipelines puros de pipelines/report.pipeline.js sobre la
 * coleccion correspondiente y normaliza resultados vacios. allowDiskUse
 * permite que los $group grandes no fallen por el limite de memoria.
 */
import { COLLECTIONS } from '../database/collections.js';
import {
  buildGeneralReportPipeline,
  buildInventoryStatusPipeline,
  buildLossesReportPipeline,
  buildSupplierPerformancePipeline,
} from './pipelines/report.pipeline.js';

/** Opciones comunes de agregacion de reportes. */
/** maxTimeMS: corta en el servidor una agregacion desbocada (proteccion DoS). */
const AGGREGATE_OPTIONS = Object.freeze({ allowDiskUse: true, maxTimeMS: 15_000 });

/** Resumen de ventas cuando no hay pedidos que cumplan los filtros. */
const EMPTY_SALES_SUMMARY = Object.freeze({ revenueCents: 0, unitsSold: 0, ordersCount: 0, averageTicketCents: 0 });

export class ReportRepository {
  /** @type {import('mongodb').Db} */
  #db;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#db = db;
  }

  /**
   * Ejecuta un pipeline y devuelve el primer documento (resultado de $facet).
   * @param {string} collection
   * @param {object[]} pipeline
   */
  async #first(collection, pipeline) {
    const [result] = await this.#db.collection(collection).aggregate(pipeline, AGGREGATE_OPTIONS).toArray();
    return result ?? null;
  }

  /**
   * Facetas de ventas sobre orders.
   * @param {object} filters
   */
  async salesFacets(filters) {
    const result = await this.#first(COLLECTIONS.ORDERS, buildGeneralReportPipeline(filters));
    return {
      salesSummary: result?.salesSummary?.[0] ?? { ...EMPTY_SALES_SUMMARY },
      paymentMethodBreakdown: result?.paymentMethodBreakdown ?? [],
      couponRanking: result?.couponRanking ?? [],
      topProducts: result?.topProducts ?? [],
    };
  }

  /**
   * Mermas por motivo y total sobre inventory_losses.
   * @param {object} filters
   */
  async lossesSummary(filters) {
    const result = await this.#first(COLLECTIONS.INVENTORY_LOSSES, buildLossesReportPipeline(filters));
    return {
      byReason: result?.byReason ?? [],
      totals: result?.totals?.[0] ?? { units: 0, totalLossCents: 0, records: 0 },
    };
  }

  /**
   * Estado de inventario sobre products.
   * @param {object} filters
   */
  async inventoryStatus(filters) {
    const result = await this.#first(COLLECTIONS.PRODUCTS, buildInventoryStatusPipeline(filters));
    return {
      products: result?.products ?? [],
      totals: result?.totals?.[0] ?? { products: 0, units: 0, inventoryCostCents: 0, inventoryRetailCents: 0, lowStockCount: 0 },
    };
  }

  /**
   * Desempeno del proveedor de un producto; null si el producto no existe.
   * @param {import('mongodb').ObjectId} productId
   * @param {{ startDate?: Date, endDate?: Date }} range
   */
  supplierPerformance(productId, range) {
    return this.#first(COLLECTIONS.PRODUCTS, buildSupplierPerformancePipeline(productId, range));
  }
}
