/**
 * Controlador del punto de venta (POS).
 *
 * Adapta HTTP al CheckoutService: construye el DTO a partir del cuerpo ya
 * validado y de la cabecera Idempotency-Key, y responde siempre con DTOs
 * (nunca documentos crudos). Un reintento idempotente responde 200 con la
 * cabecera Idempotent-Replayed: true; una compra nueva, 201.
 */
import { CheckoutDTO } from '../dtos/checkout.dto.js';
import { InvoiceDTO } from '../dtos/invoice.dto.js';
import { OrderDTO } from '../dtos/order.dto.js';
import { requestContext } from '../utils/request-context.js';

export class PosController {
  #checkout;

  /** @param {{ checkoutService: import('../services/checkout.service.js').CheckoutService }} deps */
  constructor({ checkoutService }) {
    this.#checkout = checkoutService;
  }

  /** POST /pos/checkout */
  checkout = async (req, res) => {
    const dto = CheckoutDTO.from(req.body, req.get('Idempotency-Key'));
    const { order, invoice, replayed } = await this.#checkout.checkout(req.user, dto, requestContext(req));

    if (replayed) res.set('Idempotent-Replayed', 'true');
    res.status(replayed ? 200 : 201).json({ data: { order: OrderDTO.from(order), invoice: InvoiceDTO.from(invoice) } });
  };
}
