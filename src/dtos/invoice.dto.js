/**
 * DTOs de facturas: respuesta (importes en decimales) y parametros de listado.
 */
import { fromCents } from '../utils/money.js';
import { addressOf } from './order.dto.js';

export class InvoiceDTO {
  /**
   * @param {object | null} invoice Documento de invoices.
   * @returns {object | null}
   */
  static from(invoice) {
    if (!invoice) return null;
    return {
      id: invoice._id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      orderId: invoice.orderId.toString(),
      orderNumber: invoice.orderNumber,
      nit: invoice.nit,
      nitType: invoice.nitType,
      entityName: invoice.entityName,
      email: invoice.email,
      paymentMethod: invoice.paymentMethod,
      shippingAddress: addressOf(invoice.shippingAddress),
      items: invoice.items.map((item) => ({
        productId: item.productId.toString(),
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        unitPrice: fromCents(item.unitPriceCents),
        discount: fromCents(item.discountCents),
        taxRatePercent: item.taxRatePercent,
        tax: fromCents(item.taxCents),
        total: fromCents(item.totalCents),
      })),
      currency: invoice.currency,
      subtotal: fromCents(invoice.subtotalCents),
      discountTotal: fromCents(invoice.discountTotalCents),
      taxTotal: fromCents(invoice.taxTotalCents),
      grandTotal: fromCents(invoice.grandTotalCents),
      status: invoice.status,
      issuedAt: invoice.issuedAt,
    };
  }

  /** @param {object[]} invoices */
  static fromMany(invoices) {
    return invoices.map((invoice) => InvoiceDTO.from(invoice));
  }
}

export class ListInvoicesQueryDTO {
  /** @param {Record<string, string>} query Query string validada. */
  static from(query) {
    return Object.freeze({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      userId: query.userId,
      status: query.status,
      nit: query.nit ? query.nit.trim().toUpperCase() : undefined,
    });
  }
}
