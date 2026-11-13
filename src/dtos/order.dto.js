/**
 * DTO de salida de pedidos.
 *
 * Construye la respuesta campo a campo (lista blanca) y convierte los
 * centavos internos a importes decimales. Datos de pago expuestos:
 * - tarjeta: solo marca, ultimos 4 y titular (nunca token, codigo de
 *   autorizacion ni id de transaccion de la pasarela);
 * - transferencia: cuenta de origen enmascarada ("****" + ultimos 4).
 */
import { COUPON_TYPES } from '../constants/commerce.js';
import { fromCents } from '../utils/money.js';

/**
 * Enmascara un numero de cuenta dejando visibles los ultimos 4 digitos.
 * @param {string} account
 */
export const maskAccount = (account) => `****${String(account).replace(/[^0-9]/g, '').slice(-4)}`;

/**
 * Identificador como cadena o null.
 * @param {unknown} id
 */
const idOf = (id) => (id ? id.toString() : null);

/**
 * Direccion de envio (copia) o null.
 * @param {object | null | undefined} address
 */
export const addressOf = (address) =>
  address
    ? {
        line1: address.line1,
        line2: address.line2 ?? null,
        city: address.city,
        state: address.state ?? null,
        postalCode: address.postalCode ?? null,
        country: address.country,
      }
    : null;

export class OrderDTO {
  /**
   * @param {object | null} order Documento de orders.
   * @returns {object | null}
   */
  static from(order) {
    if (!order) return null;
    return {
      id: order._id.toString(),
      orderNumber: order.orderNumber,
      userId: idOf(order.userId),
      channel: order.channel,
      status: order.status,
      currency: order.currency,
      customer: {
        name: order.customer.name,
        email: order.customer.email,
        phone: order.customer.phone ?? null,
      },
      shippingAddress: addressOf(order.shippingAddress),
      items: order.items.map((item) => ({
        productId: idOf(item.productId),
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        unitPrice: fromCents(item.unitPriceCents),
        discountPercent: item.discountPercent,
        unitFinalPrice: fromCents(item.unitFinalPriceCents),
        taxRatePercent: item.taxRatePercent,
        subtotal: fromCents(item.subtotalCents),
        productDiscount: fromCents(item.productDiscountCents),
        couponDiscount: fromCents(item.couponDiscountCents),
        discountTotal: fromCents(item.discountTotalCents),
        tax: fromCents(item.taxCents),
        total: fromCents(item.grandTotalCents),
      })),
      coupon: order.coupon
        ? {
            code: order.coupon.code,
            discountType: order.coupon.discountType,
            // Porcentaje tal cual; monto fijo de centavos a decimales.
            discountValue:
              order.coupon.discountType === COUPON_TYPES.FIXED ? fromCents(order.coupon.discountValue) : order.coupon.discountValue,
            discount: fromCents(order.coupon.discountCents),
          }
        : null,
      totals: {
        subtotal: fromCents(order.totals.subtotalCents),
        productDiscount: fromCents(order.totals.productDiscountCents),
        couponDiscount: fromCents(order.totals.couponDiscountCents),
        discountTotal: fromCents(order.totals.discountTotalCents),
        taxTotal: fromCents(order.totals.taxTotalCents),
        grandTotal: fromCents(order.totals.grandTotalCents),
        totalItemsCount: order.totals.totalItemsCount,
      },
      payment: OrderDTO.#paymentOf(order.payment),
      invoiceId: idOf(order.invoiceId),
      notes: order.notes ?? null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  /** @param {object[]} orders */
  static fromMany(orders) {
    return orders.map((order) => OrderDTO.from(order));
  }

  /**
   * Datos de pago no sensibles.
   * @param {object} payment
   */
  static #paymentOf(payment) {
    const { card, bankTransfer } = payment;
    return {
      method: payment.method,
      status: payment.status,
      card: card ? { brand: card.brand, last4: card.last4, holderName: card.holderName } : null,
      bankTransfer: bankTransfer
        ? {
            bankName: bankTransfer.bankName,
            senderAccountNumber: maskAccount(bankTransfer.senderAccountNumber),
            transferAmount: fromCents(bankTransfer.transferAmountCents),
            authorizationNumber: bankTransfer.authorizationNumber,
            receiptUrl: bankTransfer.receiptUrl,
            verifiedAt: bankTransfer.verifiedAt ?? null,
          }
        : null,
    };
  }
}
