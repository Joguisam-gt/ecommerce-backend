/**
 * Controlador de facturas: listado y detalle segun los permisos del actor.
 */
import { InvoiceDTO, ListInvoicesQueryDTO } from '../dtos/invoice.dto.js';

export class InvoiceController {
  #invoices;

  /** @param {{ invoiceService: import('../services/invoice.service.js').InvoiceService }} deps */
  constructor({ invoiceService }) {
    this.#invoices = invoiceService;
  }

  /** GET /invoices */
  list = async (req, res) => {
    const { items, total, page, limit } = await this.#invoices.listForActor(req.user, ListInvoicesQueryDTO.from(req.query));
    res.json({
      data: InvoiceDTO.fromMany(items),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  };

  /** GET /invoices/:id */
  getById = async (req, res) => {
    const invoice = await this.#invoices.getForActor(req.user, req.params.id);
    res.json({ data: InvoiceDTO.from(invoice), meta: {} });
  };
}
