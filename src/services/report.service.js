/**
 * Servicio de reportes analiticos (Fase 3).
 *
 * - generalReport: ejecuta en paralelo las facetas de ventas (orders), el
 *   resumen de mermas (inventory_losses) y el estado de inventario (products).
 * - supplierPerformance: metricas del producto y su proveedor, mas la
 *   recomendacion calculada con la funcion pura recommendSupplierAction (se
 *   aplica aqui y no en el pipeline para probar la regla y ajustar umbrales sin MongoDB).
 */
import { HttpError } from '../utils/http-error.js';
import { isValidObjectId, toObjectId } from '../utils/object-id.js';
import { recommendSupplierAction } from '../repositories/pipelines/report.pipeline.js';

/** Error de producto inexistente. */
const productNotFound = () => HttpError.notFound('Producto no encontrado', 'PRODUCT_NOT_FOUND');

export class ReportService {
  #reports;

  /** @param {{ reportRepository: import('../repositories/report.repository.js').ReportRepository }} deps */
  constructor({ reportRepository }) {
    this.#reports = reportRepository;
  }

  /**
   * Reporte general consolidado.
   * @param {object} filters GeneralReportQueryDTO
   * @returns {Promise<{ sales: object, losses: object, inventory: object, filters: object }>}
   */
  async generalReport(filters) {
    if (filters.startDate && filters.endDate && filters.endDate < filters.startDate) {
      throw HttpError.badRequest('endDate debe ser igual o posterior a startDate', 'INVALID_DATE_RANGE');
    }
    const [sales, losses, inventory] = await Promise.all([
      this.#reports.salesFacets(filters),
      this.#reports.lossesSummary(filters),
      this.#reports.inventoryStatus(filters),
    ]);
    return { sales, losses, inventory, filters };
  }

  /**
   * Desempeno del proveedor de un producto con recomendacion; 404 si no existe.
   * @param {string} productId
   * @param {{ startDate?: Date, endDate?: Date }} range SupplierPerformanceQueryDTO
   */
  async supplierPerformance(productId, range) {
    if (!isValidObjectId(productId)) throw productNotFound();
    if (range.startDate && range.endDate && range.endDate < range.startDate) {
      throw HttpError.badRequest('endDate debe ser igual o posterior a startDate', 'INVALID_DATE_RANGE');
    }
    const row = await this.#reports.supplierPerformance(toObjectId(productId), range);
    if (!row) throw productNotFound();

    const { recommendation, reasons } = recommendSupplierAction(row);
    return { ...row, recommendation, recommendationReasons: reasons };
  }
}
