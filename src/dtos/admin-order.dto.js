/**
 * DTOs de la conciliacion de transferencias del panel de administracion.
 *
 * Salida en lista blanca y en unidades decimales. La cuenta de origen de la
 * transferencia siempre sale enmascarada ("****" + ultimos 4 digitos).
 */
import { fromCents } from '../utils/money.js';
import { normalizeText } from './normalizers.js';
import { maskAccount, OrderDTO } from './order.dto.js';

/** Elemento de la cola GET /admin/orders/pending-verification. */
export class PendingTransferDTO {
  /**
   * @param {object | null} order Documento de orders (proyeccion de la cola).
   * @returns {object | null}
   */
  static from(order) {
    if (!order) return null;
    const transfer = order.payment?.bankTransfer ?? null;
    return {
      id: order._id.toString(),
      orderNumber: order.orderNumber,
      status: order.status,
      currency: order.currency,
      customer: {
        name: order.customer.name,
        email: order.customer.email,
        phone: order.customer.phone ?? null,
      },
      totals: {
        subtotal: fromCents(order.totals.subtotalCents),
        discountTotal: fromCents(order.totals.discountTotalCents),
        taxTotal: fromCents(order.totals.taxTotalCents),
        grandTotal: fromCents(order.totals.grandTotalCents),
        totalItemsCount: order.totals.totalItemsCount,
      },
      payment: {
        method: order.payment.method,
        status: order.payment.status,
        bankTransfer: transfer
          ? {
              authorizationNumber: transfer.authorizationNumber,
              bankName: transfer.bankName,
              receiptUrl: transfer.receiptUrl,
              transferAmount: fromCents(transfer.transferAmountCents),
              senderAccountNumber: maskAccount(transfer.senderAccountNumber),
            }
          : null,
      },
      invoiceId: order.invoiceId ? order.invoiceId.toString() : null,
      createdAt: order.createdAt,
    };
  }

  /** @param {object[]} orders */
  static fromMany(orders) {
    return orders.map((order) => PendingTransferDTO.from(order));
  }
}

/** Resumen de la factura afectada por la conciliacion. */
export class ReconciledInvoiceDTO {
  /**
   * @param {object | null} invoice Documento de invoices.
   * @returns {object | null}
   */
  static from(invoice) {
    if (!invoice) return null;
    return {
      id: invoice._id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      grandTotal: fromCents(invoice.grandTotalCents),
      voidedAt: invoice.voidedAt ?? null,
      voidReason: invoice.voidReason ?? null,
      updatedAt: invoice.updatedAt,
    };
  }
}

/** Respuesta de PATCH /admin/orders/:id/reconcile. */
export class ReconciliationResultDTO {
  /**
   * @param {{ order: object, invoice: object }} result
   * @returns {{ order: object, invoice: object }}
   */
  static from({ order, invoice }) {
    return { order: OrderDTO.from(order), invoice: ReconciledInvoiceDTO.from(invoice) };
  }
}

/** Entrada de la conciliacion ya validada. */
export class ReconcileOrderDTO {
  /** @param {{ action: string, reason?: string | null }} body */
  static from(body) {
    return Object.freeze({
      action: body.action,
      reason: typeof body.reason === 'string' ? normalizeText(body.reason) : null,
    });
  }
}

/** Paginacion de la cola con valores por defecto. */
export class ListPendingVerificationQueryDTO {
  /** @param {Record<string, string>} query */
  static from(query) {
    return Object.freeze({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
  }
}
