/**
 * Servicio de facturacion administrativa (Fase 3).
 *
 * Consulta global de facturas de cliente y de proveedor; el acceso lo limita
 * la ruta (invoices:manage), por lo que aqui no se filtra por propietario.
 */
import { HttpError } from '../utils/http-error.js';
import { isValidObjectId, toObjectId } from '../utils/object-id.js';

/** Error unico de factura inexistente. */
const notFound = () => HttpError.notFound('Factura no encontrada', 'INVOICE_NOT_FOUND');

export class AdminInvoiceService {
  #invoices;

  /** @param {{ adminInvoiceRepository: import('../repositories/admin-invoice.repository.js').AdminInvoiceRepository }} deps */
  constructor({ adminInvoiceRepository }) {
    this.#invoices = adminInvoiceRepository;
  }

  /**
   * Listado paginado con filtros administrativos.
   * @param {object} query ListAdminInvoicesQueryDTO
   * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
   */
  async listInvoices(query) {
    const { items, total } = await this.#invoices.search(query);
    return { items, total, page: query.page, limit: query.limit };
  }

  /**
   * Detalle de una factura o 404.
   * @param {string} id
   */
  async getInvoice(id) {
    if (!isValidObjectId(id)) throw notFound();
    const invoice = await this.#invoices.findById(toObjectId(id));
    if (!invoice) throw notFound();
    return invoice;
  }
}
