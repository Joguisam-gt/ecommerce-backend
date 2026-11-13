/**
 * DTOs de la facturacion administrativa: parametros de listado y respuesta
 * (resumen para el listado y detalle completo con desglose de productos).
 *
 * Las facturas anteriores a la Fase 3 no tienen entityType: se tratan como
 * facturas de cliente.
 */
import { INVOICE_ENTITY_TYPES } from '../constants/commerce.js';
import { fromCents } from '../utils/money.js';
import { addressOf } from './order.dto.js';
import { parseDateRange } from './report.dto.js';

/**
 * Identificador como cadena o null.
 * @param {unknown} id
 */
const idOf = (id) => (id ? id.toString() : null);

export class ListAdminInvoicesQueryDTO {
  /** @param {Record<string, string>} query Query string validada. */
  static from(query) {
    return Object.freeze({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      nit: query.nit ? query.nit.trim().toUpperCase() : undefined,
      entityName: query.entityName?.trim() || undefined,
      paymentMethod: query.paymentMethod,
      shippingAddress: query.shippingAddress?.trim() || undefined,
      email: query.email?.trim() || undefined,
      entityType: query.entityType,
      status: query.status,
      ...parseDateRange(query),
    });
  }
}

export class AdminInvoiceDTO {
  /**
   * Datos comunes del listado y del detalle, con las referencias segun el tipo de entidad.
   * @param {object} invoice Documento de invoices.
   */
  static #base(invoice) {
    const entityType = invoice.entityType ?? INVOICE_ENTITY_TYPES.CUSTOMER;
    const references =
      entityType === INVOICE_ENTITY_TYPES.SUPPLIER
        ? { supplierId: idOf(invoice.supplierId), purchaseId: idOf(invoice.purchaseId) }
        : { orderId: idOf(invoice.orderId), orderNumber: invoice.orderNumber ?? null, userId: idOf(invoice.userId) };
    return {
      id: invoice._id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      entityType,
      ...references,
      nit: invoice.nit,
      nitType: invoice.nitType,
      entityName: invoice.entityName,
      email: invoice.email ?? null,
      paymentMethod: invoice.paymentMethod,
      shippingAddress: addressOf(invoice.shippingAddress),
      currency: invoice.currency,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
    };
  }

  /**
   * Totales en unidades decimales.
   * @param {object} invoice
   */
  static #totals(invoice) {
    return {
      subtotal: fromCents(invoice.subtotalCents),
      discountTotal: fromCents(invoice.discountTotalCents),
      taxTotal: fromCents(invoice.taxTotalCents),
      grandTotal: fromCents(invoice.grandTotalCents),
    };
  }

  /**
   * Resumen para el listado (sin lineas).
   * @param {object} invoice
   */
  static summary(invoice) {
    return {
      ...AdminInvoiceDTO.#base(invoice),
      itemsCount: invoice.items?.length ?? 0,
      grandTotal: fromCents(invoice.grandTotalCents),
    };
  }

  /** @param {object[]} invoices */
  static summaries(invoices) {
    return invoices.map((invoice) => AdminInvoiceDTO.summary(invoice));
  }

  /**
   * Detalle con desglose completo de productos y totales.
   * @param {object | null} invoice
   */
  static detail(invoice) {
    if (!invoice) return null;
    return {
      ...AdminInvoiceDTO.#base(invoice),
      items: invoice.items.map((item) => ({
        productId: idOf(item.productId),
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        unitPrice: fromCents(item.unitPriceCents),
        lineSubtotal: fromCents(item.unitPriceCents * item.quantity),
        discount: fromCents(item.discountCents),
        taxRatePercent: item.taxRatePercent,
        tax: fromCents(item.taxCents),
        total: fromCents(item.totalCents),
      })),
      totals: AdminInvoiceDTO.#totals(invoice),
      voidedAt: invoice.voidedAt ?? null,
      voidReason: invoice.voidReason ?? null,
    };
  }
}
