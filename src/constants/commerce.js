/**
 * Constantes del dominio comercial (Fase 2): metodos de pago, estados de
 * pedido y factura, marcas de tarjeta y bancos admitidos.
 *
 * Son la fuente unica para validadores, $jsonSchema y servicios, de modo que
 * anadir un banco o un estado solo requiere editar este archivo.
 */

/** Metodos de pago aceptados por el POS. */
export const PAYMENT_METHODS = Object.freeze({
  CASH_ON_DELIVERY: 'cash_on_delivery',
  CARD: 'card',
  BANK_TRANSFER: 'bank_transfer',
});

export const ALL_PAYMENT_METHODS = Object.freeze(Object.values(PAYMENT_METHODS));

/** Estados del ciclo de vida de un pedido. */
export const ORDER_STATUSES = Object.freeze({
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PENDING_VERIFICATION: 'pending_verification',
  PAID: 'paid',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  REJECTED: 'rejected',
});

export const ALL_ORDER_STATUSES = Object.freeze(Object.values(ORDER_STATUSES));

/** Estado inicial del pedido segun el metodo de pago (regla de negocio de la Fase 2). */
export const INITIAL_ORDER_STATUS = Object.freeze({
  [PAYMENT_METHODS.CASH_ON_DELIVERY]: ORDER_STATUSES.CONFIRMED,
  [PAYMENT_METHODS.CARD]: ORDER_STATUSES.PAID,
  [PAYMENT_METHODS.BANK_TRANSFER]: ORDER_STATUSES.PENDING_VERIFICATION,
});

/** Estado del pago dentro del pedido. */
export const PAYMENT_STATUSES = Object.freeze({
  CASH_DUE: 'cash_due',
  CAPTURED: 'captured',
  PENDING_VERIFICATION: 'pending_verification',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
});

export const ALL_PAYMENT_STATUSES = Object.freeze(Object.values(PAYMENT_STATUSES));

/** Estado inicial del pago segun el metodo. */
export const INITIAL_PAYMENT_STATUS = Object.freeze({
  [PAYMENT_METHODS.CASH_ON_DELIVERY]: PAYMENT_STATUSES.CASH_DUE,
  [PAYMENT_METHODS.CARD]: PAYMENT_STATUSES.CAPTURED,
  [PAYMENT_METHODS.BANK_TRANSFER]: PAYMENT_STATUSES.PENDING_VERIFICATION,
});

/** Estados de una factura. */
export const INVOICE_STATUSES = Object.freeze({
  PAID: 'paid',
  PENDING_PAYMENT: 'pending_payment',
  VOIDED: 'voided',
});

export const ALL_INVOICE_STATUSES = Object.freeze(Object.values(INVOICE_STATUSES));

/** Estado inicial de la factura segun el metodo de pago. */
export const INITIAL_INVOICE_STATUS = Object.freeze({
  [PAYMENT_METHODS.CASH_ON_DELIVERY]: INVOICE_STATUSES.PENDING_PAYMENT,
  [PAYMENT_METHODS.CARD]: INVOICE_STATUSES.PAID,
  [PAYMENT_METHODS.BANK_TRANSFER]: INVOICE_STATUSES.PENDING_PAYMENT,
});

/** Tipo de identificacion fiscal del receptor de la factura. */
export const NIT_TYPES = Object.freeze({ NIT: 'nit', USER_CODE: 'user_code' });

/** Marcas de tarjeta admitidas. */
export const CARD_BRANDS = Object.freeze(['Visa', 'Mastercard', 'Amex']);

/** Bancos admitidos para transferencias. */
export const BANKS = Object.freeze(['G&T', 'Banco Industrial', 'Banrural', 'BAC']);

/** Canales de venta. */
export const ORDER_CHANNELS = Object.freeze({ ONLINE: 'online', POS: 'pos' });

export const ALL_ORDER_CHANNELS = Object.freeze(Object.values(ORDER_CHANNELS));

/** Tipos de descuento de cupon. */
export const COUPON_TYPES = Object.freeze({ PERCENTAGE: 'percentage', FIXED: 'fixed' });

export const ALL_COUPON_TYPES = Object.freeze(Object.values(COUPON_TYPES));

/** Limites del carrito. */
export const CART_LIMITS = Object.freeze({ MAX_LINES: 100, MAX_QUANTITY_PER_LINE: 999 });

/**
 * Fase 3: estados de pedido que cuentan como venta efectiva en reportes y en
 * el directorio de clientes (pedidos cobrados o comprometidos y no anulados).
 */
export const REVENUE_ORDER_STATUSES = Object.freeze([
  ORDER_STATUSES.CONFIRMED,
  ORDER_STATUSES.PAID,
  ORDER_STATUSES.PROCESSING,
  ORDER_STATUSES.SHIPPED,
  ORDER_STATUSES.DELIVERED,
]);

/** Fase 3: estados de pedido cuyas unidades se consideran devueltas. */
export const RETURNED_ORDER_STATUSES = Object.freeze([ORDER_STATUSES.REFUNDED]);

/** Fase 3: decisiones posibles al conciliar una transferencia bancaria. */
export const RECONCILE_ACTIONS = Object.freeze({ APPROVE: 'approve', REJECT: 'reject' });

/** Fase 3: tipo de entidad contable de una factura (venta a cliente o compra a proveedor). */
export const INVOICE_ENTITY_TYPES = Object.freeze({ CUSTOMER: 'cliente', SUPPLIER: 'proveedor' });

export const ALL_INVOICE_ENTITY_TYPES = Object.freeze(Object.values(INVOICE_ENTITY_TYPES));

/** Fase 3: motivos de merma de inventario. */
export const LOSS_REASONS = Object.freeze({ EXPIRED: 'expired', DAMAGED: 'damaged' });

export const ALL_LOSS_REASONS = Object.freeze(Object.values(LOSS_REASONS));

/** Fase 3: filtro de disponibilidad de productos. */
export const AVAILABILITY = Object.freeze({ IN_STOCK: 'inStock', OUT_OF_STOCK: 'outOfStock' });
