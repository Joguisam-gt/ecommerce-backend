/**
 * Controlador de conciliacion de transferencias del panel de administracion.
 * Solo adapta HTTP al servicio: sin reglas de negocio.
 */
import {
  ListPendingVerificationQueryDTO,
  PendingTransferDTO,
  ReconcileOrderDTO,
  ReconciliationResultDTO,
} from '../dtos/admin-order.dto.js';
import { requestContext } from '../utils/request-context.js';

export class AdminOrderController {
  #reconciliation;

  /** @param {{ orderReconciliationService: import('../services/order-reconciliation.service.js').OrderReconciliationService }} deps */
  constructor({ orderReconciliationService }) {
    this.#reconciliation = orderReconciliationService;
  }

  /** GET /admin/orders/pending-verification */
  listPendingVerification = async (req, res) => {
    const { items, total, page, limit } = await this.#reconciliation.listPendingVerification(
      ListPendingVerificationQueryDTO.from(req.query),
    );
    res.json({
      data: PendingTransferDTO.fromMany(items),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  };

  /** PATCH /admin/orders/:id/reconcile */
  reconcile = async (req, res) => {
    const result = await this.#reconciliation.reconcile(
      req.user,
      req.params.id,
      ReconcileOrderDTO.from(req.body),
      requestContext(req),
    );
    res.json({ data: ReconciliationResultDTO.from(result), meta: {} });
  };
}
