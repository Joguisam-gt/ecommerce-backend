/**
 * Servicio de consulta de facturas.
 *
 * Reglas de acceso:
 * - Con invoices:manage (admin, superusuario) se ven todas, filtrables por
 *   usuario, estado y NIT.
 * - Sin ese permiso, solo las propias: el filtro userId se fuerza al actor.
 * Una factura ajena responde 404 (igual que una inexistente) para no revelar
 * su existencia.
 */
import { PERMISSIONS, hasPermission } from '../constants/permissions.js';
import { HttpError } from '../utils/http-error.js';
import { isValidObjectId, toObjectId } from '../utils/object-id.js';

/** Error unico para factura inexistente o ajena. */
const notFound = () => HttpError.notFound('Factura no encontrada', 'INVOICE_NOT_FOUND');

export class InvoiceService {
  #invoices;

  /** @param {{ invoiceRepository: import('../repositories/invoice.repository.js').InvoiceRepository }} deps */
  constructor({ invoiceRepository }) {
    this.#invoices = invoiceRepository;
  }

  /**
   * Listado paginado segun los permisos del actor.
   * @param {{ id: string, role: string }} actor
   * @param {{ page: number, limit: number, userId?: string, status?: string, nit?: string }} query
   * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
   */
  async listForActor(actor, query) {
    const canManage = hasPermission(actor.role, PERMISSIONS.INVOICES_MANAGE);
    const criteria = {
      page: query.page,
      limit: query.limit,
      status: query.status,
      nit: query.nit,
      userId: canManage ? (query.userId ? toObjectId(query.userId) : undefined) : toObjectId(actor.id),
    };
    const { items, total } = await this.#invoices.list(criteria);
    return { items, total, page: query.page, limit: query.limit };
  }

  /**
   * Detalle de una factura; 404 si no existe o si es ajena sin invoices:manage.
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   */
  async getForActor(actor, id) {
    if (!isValidObjectId(id)) throw notFound();
    const invoice = await this.#invoices.findById(toObjectId(id));
    if (!invoice) throw notFound();
    const isOwner = invoice.userId?.toString() === actor.id;
    if (!isOwner && !hasPermission(actor.role, PERMISSIONS.INVOICES_MANAGE)) throw notFound();
    return invoice;
  }
}
