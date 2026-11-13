/**
 * Controlador de reportes analiticos: convierte la query a filtros tipados y
 * la respuesta del servicio a importes decimales.
 */
import { GeneralReportQueryDTO, ReportResponseDTO, SupplierPerformanceQueryDTO } from '../dtos/report.dto.js';

export class ReportController {
  #reports;

  /** @param {{ reportService: import('../services/report.service.js').ReportService }} deps */
  constructor({ reportService }) {
    this.#reports = reportService;
  }

  /** GET /admin/reports/general */
  general = async (req, res) => {
    const report = await this.#reports.generalReport(GeneralReportQueryDTO.from(req.query));
    res.json({ data: ReportResponseDTO.general(report), meta: {} });
  };

  /** GET /admin/reports/products/:id/supplier-performance */
  supplierPerformance = async (req, res) => {
    const range = SupplierPerformanceQueryDTO.from(req.query);
    const row = await this.#reports.supplierPerformance(req.params.id, range);
    res.json({ data: ReportResponseDTO.supplierPerformance(row, range), meta: {} });
  };
}
