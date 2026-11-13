/**
 * Servicio de conciliacion de transferencias bancarias (Fase 3, panel de administracion).
 *
 * Un pedido pagado por transferencia nace en pending_verification con su
 * factura en pending_payment. El administrador revisa el comprobante y decide:
 *
 * - approve: transaccion (pedido + factura). Pedido -> paid, pago -> verified
 *   con verifiedAt/verifiedBy, factura -> paid.
 * - reject: transaccion ACID (todo o nada):
 *     1) pedido -> rejected, pago -> rejected y motivo en notes;
 *     2) devolucion atomica ($inc) del stock de CADA linea; si un producto ya
 *        no existe se aborta con 409 y se revierte todo;
 *     3) si el pedido uso cupon, se libera un uso ($inc -1, nunca bajo 0);
 *     4) factura -> voided con voidedAt y voidReason.
 *
 * Doble conciliacion: la transicion del pedido es condicional sobre el estado
 * pending_verification; si otro administrador concilio antes, la actualizacion
 * no encuentra documento y se responde 409 ORDER_NOT_PENDING_VERIFICATION.
 * El callback de la transaccion es idempotente (solo E/S con la sesion, sin
 * llamadas externas) y la auditoria se registra DESPUES del commit.
 */
import {
  INVOICE_STATUSES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  RECONCILE_ACTIONS,
} from '../constants/commerce.js';
import { COLLECTIONS } from '../database/collections.js';
import { HttpError } from '../utils/http-error.js';
import { toObjectId } from '../utils/object-id.js';
import { AUDIT_ACTIONS } from './audit.service.js';

/** Longitud maxima de orders.notes segun orders.schema.js. */
const MAX_NOTES_LENGTH = 1000;

/** Prefijo del motivo de rechazo que se anade a las notas del pedido. */
const REJECTION_NOTE_PREFIX = 'Transferencia rechazada: ';

/** Estados de factura que pueden anularse al rechazar. */
const VOIDABLE_INVOICE_STATUSES = Object.freeze([INVOICE_STATUSES.PENDING_PAYMENT, INVOICE_STATUSES.PAID]);

/** 409 cuando el pedido ya no esta pendiente de verificacion. */
const notPendingVerification = () =>
  HttpError.conflict('El pedido no esta pendiente de verificacion de transferencia', 'ORDER_NOT_PENDING_VERIFICATION');

/**
 * Agrega el motivo de rechazo a las notas existentes sin superar el maximo del esquema.
 * Si no cabe todo, se recortan las notas previas y se conserva el motivo completo.
 * @param {string | null | undefined} existing
 * @param {string} reason
 * @returns {string}
 */
export function appendRejectionNote(existing, reason) {
  const rejection = `${REJECTION_NOTE_PREFIX}${reason}`.slice(0, MAX_NOTES_LENGTH);
  if (!existing) return rejection;
  const room = MAX_NOTES_LENGTH - rejection.length - 1;
  return room > 0 ? `${existing.slice(0, room)}\n${rejection}` : rejection;
}

/**
 * Copia del pedido para auditoria con la cuenta de origen enmascarada (ultimos 4).
 * @param {object | null} order
 * @returns {object | null}
 */
function orderAuditState(order) {
  if (!order) return null;
  const bankTransfer = order.payment?.bankTransfer;
  if (!bankTransfer?.senderAccountNumber) return { ...order };
  const digits = String(bankTransfer.senderAccountNumber).replace(/[^0-9]/g, '');
  return {
    ...order,
    payment: { ...order.payment, bankTransfer: { ...bankTransfer, senderAccountNumber: `****${digits.slice(-4)}` } },
  };
}

export class OrderReconciliationService {
  #orders;
  #stock;
  #coupons;
  #transactions;
  #audit;
  #now;

  /**
   * @param {{ adminOrderRepository: import('../repositories/admin-order.repository.js').AdminOrderRepository,
   *           inventoryStockRepository: import('../repositories/inventory-stock.repository.js').InventoryStockRepository,
   *           adminCouponRepository: import('../repositories/admin-coupon.repository.js').AdminCouponRepository,
   *           transactionRunner: { run: (work: (session: object) => Promise<any>) => Promise<any> },
   *           auditService: import('./audit.service.js').AuditService,
   *           clock?: () => Date }} deps
   */
  constructor({ adminOrderRepository, inventoryStockRepository, adminCouponRepository, transactionRunner, auditService, clock = () => new Date() }) {
    this.#orders = adminOrderRepository;
    this.#stock = inventoryStockRepository;
    this.#coupons = adminCouponRepository;
    this.#transactions = transactionRunner;
    this.#audit = auditService;
    this.#now = clock;
  }

  /**
   * Cola paginada de transferencias pendientes de verificacion.
   * @param {{ page?: number, limit?: number }} query
   * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
   */
  async listPendingVerification(query = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.#orders.listPendingTransfers({ page, limit });
    return { items, total, page, limit };
  }

  /**
   * Concilia la transferencia de un pedido (aprobar o rechazar).
   * @param {{ id: string, role: string }} actor req.user
   * @param {string} orderId
   * @param {{ action: string, reason?: string | null }} dto ReconcileOrderDTO
   * @param {{ ip?: string | null, userAgent?: string | null }} [context]
   * @returns {Promise<{ order: object, invoice: object }>}
   */
  async reconcile(actor, orderId, dto, context = {}) {
    const id = toObjectId(orderId);
    const actorId = toObjectId(actor.id);
    const now = this.#now();
    const approving = dto.action === RECONCILE_ACTIONS.APPROVE;

    const result = await this.#transactions.run((session) =>
      approving
        ? this.#approve(session, { id, actorId, now })
        : this.#reject(session, { id, reason: dto.reason, now }),
    );

    // Auditoria despues del commit (un reintento de la transaccion la duplicaria).
    await this.#audit.recordChange({
      actor,
      action: approving ? AUDIT_ACTIONS.ORDER_PAYMENT_APPROVED : AUDIT_ACTIONS.ORDER_PAYMENT_REJECTED,
      targetCollection: COLLECTIONS.ORDERS,
      targetId: id.toString(),
      previousState: orderAuditState(result.previous),
      newState: orderAuditState(result.order),
      metadata: result.metadata,
      context,
    });

    return { order: result.order, invoice: result.invoice };
  }

  /**
   * Lee el pedido dentro de la transaccion y comprueba que sea una transferencia pendiente.
   * @param {import('mongodb').ClientSession} session
   * @param {import('mongodb').ObjectId} id
   * @returns {Promise<object>}
   */
  async #loadPendingOrder(session, id) {
    const order = await this.#orders.findById(id, { session });
    if (!order) throw HttpError.notFound('Pedido no encontrado', 'ORDER_NOT_FOUND');
    if (order.status !== ORDER_STATUSES.PENDING_VERIFICATION || order.payment?.method !== PAYMENT_METHODS.BANK_TRANSFER) {
      throw notPendingVerification();
    }
    return order;
  }

  /**
   * Callback transaccional de la aprobacion: pedido -> paid y factura -> paid.
   * @param {import('mongodb').ClientSession} session
   * @param {{ id: import('mongodb').ObjectId, actorId: import('mongodb').ObjectId, now: Date }} input
   */
  async #approve(session, { id, actorId, now }) {
    const previous = await this.#loadPendingOrder(session, id);

    const order = await this.#orders.updateIfStatus(
      id,
      ORDER_STATUSES.PENDING_VERIFICATION,
      {
        status: ORDER_STATUSES.PAID,
        'payment.status': PAYMENT_STATUSES.VERIFIED,
        'payment.bankTransfer.verifiedAt': now,
        'payment.bankTransfer.verifiedBy': actorId,
        updatedAt: now,
      },
      { session },
    );
    if (!order) throw notPendingVerification();

    const invoice = await this.#orders.updateInvoiceIfStatus(
      order.invoiceId,
      [INVOICE_STATUSES.PENDING_PAYMENT],
      { status: INVOICE_STATUSES.PAID, updatedAt: now },
      { session },
    );
    if (!invoice) {
      throw HttpError.conflict('La factura del pedido no esta pendiente de pago', 'INVOICE_NOT_PENDING_PAYMENT');
    }

    return {
      previous,
      order,
      invoice,
      metadata: { orderNumber: order.orderNumber, invoiceId: invoice._id.toString(), invoiceStatus: invoice.status },
    };
  }

  /**
   * Callback transaccional del rechazo: pedido, stock, cupon y factura (todo o nada).
   * @param {import('mongodb').ClientSession} session
   * @param {{ id: import('mongodb').ObjectId, reason: string, now: Date }} input
   */
  async #reject(session, { id, reason, now }) {
    const previous = await this.#loadPendingOrder(session, id);

    // 1) Pedido rechazado (condicional: evita la doble conciliacion).
    const order = await this.#orders.updateIfStatus(
      id,
      ORDER_STATUSES.PENDING_VERIFICATION,
      {
        status: ORDER_STATUSES.REJECTED,
        'payment.status': PAYMENT_STATUSES.REJECTED,
        notes: appendRejectionNote(previous.notes, reason),
        updatedAt: now,
      },
      { session },
    );
    if (!order) throw notPendingVerification();

    // 2) Devolucion atomica del stock de cada linea; un producto inexistente aborta todo.
    const returnedLines = [];
    for (const line of order.items) {
      const restocked = await this.#stock.incrementStock(line.productId, line.quantity, { session, now });
      if (!restocked) {
        throw new HttpError(409, 'Un producto del pedido ya no existe: no se puede devolver su stock', 'RESTOCK_PRODUCT_NOT_FOUND', {
          productId: line.productId.toString(),
          sku: line.sku,
        });
      }
      returnedLines.push({ productId: line.productId.toString(), sku: line.sku, quantity: line.quantity });
    }

    // 3) Liberacion de un uso del cupon (nunca por debajo de 0).
    const couponId = order.coupon?.couponId ?? null;
    const couponReleased = couponId ? await this.#coupons.decrementUsage(couponId, { session, now }) : false;

    // 4) Anulacion de la factura.
    const invoice = await this.#orders.updateInvoiceIfStatus(
      order.invoiceId,
      VOIDABLE_INVOICE_STATUSES,
      { status: INVOICE_STATUSES.VOIDED, voidedAt: now, voidReason: reason, updatedAt: now },
      { session },
    );
    if (!invoice) throw HttpError.conflict('La factura del pedido no se puede anular', 'INVOICE_NOT_VOIDABLE');

    return {
      previous,
      order,
      invoice,
      metadata: {
        orderNumber: order.orderNumber,
        reason,
        returnedLines,
        couponId: couponId ? couponId.toString() : null,
        couponReleased,
        invoiceId: invoice._id.toString(),
        invoiceStatus: invoice.status,
      },
    };
  }
}
