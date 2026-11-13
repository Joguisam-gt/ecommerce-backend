/**
 * DTOs de compras a proveedores (Fase 3): entrada del alta (costos decimales
 * convertidos a centavos), salida de la compra y de su factura de proveedor,
 * y parametros de listado.
 */
import { PAYMENT_METHODS } from '../constants/commerce.js';
import { fromCents, toCents } from '../utils/money.js';
import { optionalText, toDate, toEndDate } from './inventory.dto.js';

/** Metodo de pago por defecto de una compra a proveedor. */
export const DEFAULT_PURCHASE_PAYMENT_METHOD = PAYMENT_METHODS.BANK_TRANSFER;

export class CreatePurchaseDTO {
  /** @param {object} body Cuerpo validado. */
  static from(body) {
    return Object.freeze({
      supplierId: body.supplierId,
      items: body.items.map((item) =>
        Object.freeze({ productId: item.productId, quantity: item.quantity, unitCostCents: toCents(item.unitCost) }),
      ),
      paymentMethod: body.paymentMethod ?? DEFAULT_PURCHASE_PAYMENT_METHOD,
      supplierInvoiceNumber: optionalText(body.supplierInvoiceNumber) ?? null,
      notes: optionalText(body.notes) ?? null,
      purchasedAt: toDate(body.purchasedAt),
    });
  }
}

export class SupplierInvoiceDTO {
  /**
   * Factura contable de proveedor (entityType "proveedor").
   * @param {object | null} invoice Documento de invoices.
   * @returns {object | null}
   */
  static from(invoice) {
    if (!invoice) return null;
    return {
      id: invoice._id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      entityType: invoice.entityType,
      supplierId: invoice.supplierId.toString(),
      purchaseId: invoice.purchaseId.toString(),
      nit: invoice.nit,
      nitType: invoice.nitType,
      entityName: invoice.entityName,
      email: invoice.email ?? null,
      paymentMethod: invoice.paymentMethod,
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
}

export class PurchaseDTO {
  /**
   * @param {object | null} purchase Documento de purchases.
   * @param {object | null} [invoice] Factura de proveedor (opcional, se incluye en el detalle).
   * @returns {object | null}
   */
  static from(purchase, invoice = undefined) {
    if (!purchase) return null;
    return {
      id: purchase._id.toString(),
      purchaseNumber: purchase.purchaseNumber,
      supplierId: purchase.supplierId.toString(),
      supplier: {
        supplierCode: purchase.supplier.supplierCode,
        name: purchase.supplier.name,
        nit: purchase.supplier.nit,
      },
      items: purchase.items.map((item) => ({
        productId: item.productId.toString(),
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        unitCost: fromCents(item.unitCostCents),
        previousCost: item.previousCostCents === null ? null : fromCents(item.previousCostCents),
        total: fromCents(item.totalCents),
      })),
      totalCost: fromCents(purchase.totalCostCents),
      paymentMethod: purchase.paymentMethod,
      invoiceId: purchase.invoiceId.toString(),
      supplierInvoiceNumber: purchase.supplierInvoiceNumber ?? null,
      notes: purchase.notes ?? null,
      createdBy: purchase.createdBy ? purchase.createdBy.toString() : null,
      purchasedAt: purchase.purchasedAt,
      createdAt: purchase.createdAt,
      ...(invoice === undefined ? {} : { invoice: SupplierInvoiceDTO.from(invoice) }),
    };
  }

  /** @param {object[]} purchases */
  static fromMany(purchases) {
    return purchases.map((purchase) => PurchaseDTO.from(purchase));
  }
}

export class ListPurchasesQueryDTO {
  /** @param {Record<string, string>} query Query string validada. */
  static from(query) {
    return Object.freeze({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      supplierId: query.supplierId,
      from: toDate(query.from),
      to: toEndDate(query.to),
    });
  }
}
