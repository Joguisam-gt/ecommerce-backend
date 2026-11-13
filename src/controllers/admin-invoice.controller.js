/**
 * Controlador de la facturacion administrativa: listado con filtros y detalle
 * con desglose completo.
 */
import { AdminInvoiceDTO, ListAdminInvoicesQueryDTO } from '../dtos/admin-invoice.dto.js';

export class AdminInvoiceController {
  #invoices;

  /** @param {{ adminInvoiceService: import('../services/admin-invoice.service.js').AdminInvoiceService }} deps */
  constructor({ adminInvoiceService }) {
    this.#invoices = adminInvoiceService;
  }

  /** GET /admin/invoices */
  list = async (req, res) => {
    const { items, total, page, limit } = await this.#invoices.listInvoices(ListAdminInvoicesQueryDTO.from(req.query));
    res.json({
      data: AdminInvoiceDTO.summaries(items),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  };

  /** GET /admin/invoices/:id */
  getById = async (req, res) => {
    const invoice = await this.#invoices.getInvoice(req.params.id);
    res.json({ data: AdminInvoiceDTO.detail(invoice), meta: {} });
  };
}
