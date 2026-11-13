/**
 * Componentes reutilizables de la especificacion OpenAPI 3.0.3: esquemas de
 * datos (components.schemas), parametros, respuestas de error y esquemas de
 * seguridad.
 *
 * Las enumeraciones se importan de las constantes del dominio para que la
 * documentacion no se desfase. Los esquemas de entrada reflejan los
 * validadores declarativos (src/validators/*): se rechazan los campos no
 * declarados (additionalProperties: false). Los esquemas de salida reflejan los
 * DTOs (src/dtos/*). Los importes salen en quetzales como decimales (por
 * ejemplo 499 o 49.99); internamente se guardan en centavos.
 */
import {
  ALL_COUPON_TYPES,
  ALL_INVOICE_ENTITY_TYPES,
  ALL_INVOICE_STATUSES,
  ALL_LOSS_REASONS,
  ALL_ORDER_CHANNELS,
  ALL_ORDER_STATUSES,
  ALL_PAYMENT_METHODS,
  ALL_PAYMENT_STATUSES,
  BANKS,
  CARD_BRANDS,
  NIT_TYPES,
  PAYMENT_METHODS,
  RECONCILE_ACTIONS,
} from '../constants/commerce.js';
import { ALL_ROLES } from '../constants/roles.js';
import { ALL_BANK_ACCOUNT_TYPES, MAX_COMPANY_BANK_ACCOUNTS } from '../constants/settings.js';
import { ALL_PURGEABLE_COLLECTIONS, STAFF_ROLES } from '../constants/superuser.js';
import { COLLECTIONS } from '../database/collections.js';
import { nullableRef, ref } from './openapi.helpers.js';

/** Ejemplo de ObjectId reutilizado en los ejemplos. */
const ID = '665f1c2e8b3a4d0012345678';
const ID2 = '665f1c2e8b3a4d0012345600';

/** Atajos de tipos primitivos. */
const string = (extra = {}) => ({ type: 'string', ...extra });
const integer = (extra = {}) => ({ type: 'integer', ...extra });
const number = (extra = {}) => ({ type: 'number', ...extra });
const boolean = (extra = {}) => ({ type: 'boolean', ...extra });
const dateTime = (extra = {}) => ({ type: 'string', format: 'date-time', ...extra });
const money = () => ref('Money');
/** Referencia con atributos extra (en 3.0 los hermanos de un $ref se ignoran, por eso se usa allOf). */
const refWith = (name, extra) => ({ allOf: [ref(name)], ...extra });
const arrayOf = (items, extra = {}) => ({ type: 'array', items, ...extra });
const idArray = (extra = {}) => arrayOf(ref('ObjectId'), extra);

/** Patrones de los validadores (common.rules.js y checkout.validator.js). */
const EMAIL_PATTERN = '^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$';
const PHONE_PATTERN = '^\\+?[0-9\\s-]{7,20}$';
const NIT_PATTERN = '^(\\d{1,12}-?[\\dKk]|CF)$';
const SUPPLIER_NIT_PATTERN = '^\\d{2,12}-?[\\dK]$';

/** Reglas de campo de entrada recurrentes. */
const emailField = () => string({ maxLength: 254, pattern: EMAIL_PATTERN, example: 'ana.perez@example.com' });
const passwordField = () =>
  string({
    format: 'password',
    minLength: 8,
    maxLength: 72,
    description: 'Politica: 8 a 72 bytes, al menos una minuscula, una mayuscula y un digito.',
    example: 'Secreta123',
  });
const nameField = (example) =>
  string({
    minLength: 1,
    maxLength: 80,
    description: 'Solo letras (con tildes), espacios, apostrofes, puntos y guiones.',
    example,
  });
const phoneField = () =>
  string({ nullable: true, pattern: PHONE_PATTERN, description: 'Telefono internacional; `null` lo elimina.', example: '+502 5555-1234' });

/** Cuerpo de entrada estricto: rechaza campos no declarados. */
const strict = (properties, required = [], extra = {}) => ({
  type: 'object',
  additionalProperties: false,
  ...(required.length > 0 ? { required } : {}),
  properties,
  ...extra,
});

/** Campos comunes a los tres metodos de checkout (checkout.validator.js, baseFields). */
const checkoutCommonFields = () => ({
  customerName: string({ minLength: 2, maxLength: 160, example: 'Ana Perez' }),
  email: emailField(),
  phone: string({ pattern: PHONE_PATTERN, example: '+502 5555-1234' }),
  shippingAddress: ref('Address'),
  nit: string({ maxLength: 40, pattern: NIT_PATTERN, description: 'NIT guatemalteco (digitos + verificador) o `CF` (consumidor final).', example: '1234567-8' }),
  entityName: string({ minLength: 1, maxLength: 160, description: 'Nombre que se imprime en la factura.', example: 'Ana Perez' }),
  notes: string({ nullable: true, maxLength: 1000 }),
});

/** Esquemas de datos. */
export const schemas = {
  // --- Comunes ---------------------------------------------------------------
  ObjectId: string({ pattern: '^[a-fA-F0-9]{24}$', description: 'Identificador ObjectId de MongoDB (24 caracteres hexadecimales).', example: ID }),
  IsoDate: string({
    maxLength: 40,
    description: 'Fecha ISO 8601: `AAAA-MM-DD` o fecha y hora con zona opcional. Como limite superior de un rango, una fecha sin hora abarca el dia completo (23:59:59.999 UTC).',
    example: '2026-01-31',
  }),
  Money: number({
    format: 'double',
    description: 'Importe en quetzales (GTQ) como decimal con hasta 2 decimales (por ejemplo `499` o `49.99`). Internamente se almacena en centavos.',
    example: 499,
  }),
  Role: string({ enum: [...ALL_ROLES], example: 'user' }),
  StaffRole: string({ enum: [...STAFF_ROLES], example: 'admin' }),
  PaymentMethod: string({ enum: [...ALL_PAYMENT_METHODS], example: 'card' }),
  PaymentStatus: string({ enum: [...ALL_PAYMENT_STATUSES], example: 'captured' }),
  OrderStatus: string({ enum: [...ALL_ORDER_STATUSES], example: 'paid' }),
  InvoiceStatus: string({ enum: [...ALL_INVOICE_STATUSES], example: 'paid' }),
  ErrorDetail: {
    type: 'object',
    required: ['field', 'message'],
    properties: {
      field: string({ description: 'Campo invalido (admite rutas como `payment.last4` o `items[0].quantity`; `_root` para reglas del cuerpo completo).', example: 'email' }),
      message: string({ example: 'Campo obligatorio' }),
    },
  },
  Error: {
    type: 'object',
    required: ['error'],
    description: 'Formato uniforme de error de toda la API.',
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: string({ description: 'Codigo estable para el cliente (por ejemplo `VALIDATION_ERROR`, `AUTH_REQUIRED`, `FORBIDDEN`).', example: 'VALIDATION_ERROR' }),
          message: string({ example: 'Datos de entrada invalidos' }),
          details: {
            description: 'Informacion adicional opcional: lista de `ErrorDetail` en errores de validacion u objeto con datos del conflicto.',
            example: [{ field: 'email', message: 'Campo obligatorio' }],
          },
        },
      },
    },
  },
  InsufficientStockError: {
    type: 'object',
    required: ['error', 'availableStock', 'message'],
    description: 'Cuerpo fijado por contrato para el 409 por stock insuficiente (no usa el sobre `{ error: { ... } }`).',
    properties: {
      error: string({ enum: ['INSUFFICIENT_STOCK'] }),
      availableStock: integer({ minimum: 0, description: 'Unidades disponibles en este momento.', example: 3 }),
      productId: ref('ObjectId'),
      message: string({ example: 'No hay stock suficiente para la cantidad solicitada' }),
    },
  },
  PageMeta: {
    type: 'object',
    required: ['total', 'page', 'limit', 'totalPages'],
    properties: {
      total: integer({ minimum: 0, example: 42 }),
      page: integer({ minimum: 1, example: 1 }),
      limit: integer({ minimum: 1, example: 20 }),
      totalPages: integer({ minimum: 0, example: 3 }),
    },
  },
  StorePageMeta: {
    allOf: [ref('PageMeta'), { type: 'object', required: ['currency'], properties: { currency: string({ description: 'Moneda de la tienda.', example: 'GTQ' }) } }],
  },
  Address: {
    type: 'object',
    required: ['line1', 'city', 'country'],
    description: 'Direccion de envio estructurada.',
    properties: {
      line1: string({ minLength: 1, maxLength: 200, example: '5a Avenida 10-20, Zona 1' }),
      line2: string({ nullable: true, maxLength: 200, example: 'Apto 4B' }),
      city: string({ minLength: 1, maxLength: 100, example: 'Ciudad de Guatemala' }),
      state: string({ nullable: true, maxLength: 100, example: 'Guatemala' }),
      postalCode: string({ nullable: true, maxLength: 20, example: '01001' }),
      country: string({ pattern: '^[A-Za-z]{2}$', description: 'Codigo de pais ISO 3166-1 alfa-2 (se guarda en mayusculas).', example: 'GT' }),
    },
  },
  HealthStatus: {
    type: 'object',
    required: ['status', 'database', 'uptimeSeconds'],
    properties: {
      status: string({ enum: ['ok', 'degraded'], example: 'ok' }),
      database: string({ enum: ['up', 'down'], example: 'up' }),
      uptimeSeconds: integer({ example: 3600 }),
    },
  },

  // --- Autenticacion y usuarios ---------------------------------------------
  RegisterRequest: strict(
    { email: emailField(), password: passwordField(), firstName: nameField('Ana'), lastName: nameField('Perez'), phone: phoneField() },
    ['email', 'password', 'firstName', 'lastName'],
    { description: 'Todo alta publica crea un cliente (rol `user`); no acepta `role`.' },
  ),
  LoginRequest: strict(
    {
      email: string({ maxLength: 254, example: 'root@example.com' }),
      password: string({ format: 'password', maxLength: 200, example: 'CambiaEsto123' }),
    },
    ['email', 'password'],
  ),
  ChangePasswordRequest: strict(
    { currentPassword: string({ format: 'password', maxLength: 200, example: 'Secreta123' }), newPassword: passwordField() },
    ['currentPassword', 'newPassword'],
    { description: '`newPassword` debe ser distinta de `currentPassword`.' },
  ),
  User: {
    type: 'object',
    required: ['id', 'email', 'firstName', 'lastName', 'role', 'isActive'],
    properties: {
      id: ref('ObjectId'),
      email: emailField(),
      firstName: string({ example: 'Ana' }),
      lastName: string({ example: 'Perez' }),
      phone: string({ nullable: true, example: '+502 5555-1234' }),
      role: ref('Role'),
      isActive: boolean({ example: true }),
      lastLoginAt: dateTime({ nullable: true }),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    },
  },
  UserWithPermissions: {
    allOf: [
      ref('User'),
      {
        type: 'object',
        properties: {
          permissions: arrayOf(string(), { description: 'Permisos efectivos del rol (solo informativo para la interfaz; la autorizacion real es del servidor).', example: ['profile:read', 'cart:manage'] }),
        },
      },
    ],
  },
  AuthSession: {
    type: 'object',
    required: ['accessToken', 'expiresIn', 'user'],
    properties: {
      user: ref('UserWithPermissions'),
      accessToken: string({ description: 'JWT de acceso para la cabecera `Authorization: Bearer`.', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }),
      expiresIn: integer({ description: 'Vida del access token en segundos.', example: 900 }),
    },
  },
  UpdateProfileRequest: strict(
    { firstName: nameField('Ana'), lastName: nameField('Perez'), phone: phoneField() },
    [],
    { minProperties: 1, description: 'Al menos un campo. No admite correo, rol ni estado.' },
  ),
  CreateUserRequest: strict(
    { email: emailField(), password: passwordField(), firstName: nameField('Luis'), lastName: nameField('Gomez'), phone: phoneField(), role: ref('Role') },
    ['email', 'password', 'firstName', 'lastName', 'role'],
  ),
  UpdateUserRequest: strict(
    { email: emailField(), firstName: nameField('Luis'), lastName: nameField('Gomez'), phone: phoneField() },
    [],
    { minProperties: 1, description: 'Al menos un campo. El rol y el estado tienen endpoints propios.' },
  ),
  ChangeRoleRequest: strict({ role: ref('Role') }, ['role']),
  ChangeStatusRequest: strict({ isActive: boolean({ description: 'Desactivar revoca las sesiones de la cuenta.', example: false }) }, ['isActive']),
  CreateStaffRequest: strict(
    { email: emailField(), password: passwordField(), firstName: nameField('Marta'), lastName: nameField('Lopez'), phone: phoneField(), role: ref('StaffRole') },
    ['email', 'password', 'firstName', 'lastName', 'role'],
  ),

  // --- Auditoria -------------------------------------------------------------
  AuditLog: {
    type: 'object',
    properties: {
      id: ref('ObjectId'),
      action: string({ example: 'auth.login' }),
      outcome: string({ enum: ['success', 'failure'] }),
      entity: string({ example: 'users' }),
      entityId: string({ nullable: true }),
      actorId: refWith('ObjectId', { nullable: true }),
      actorRole: string({ nullable: true, example: 'superuser' }),
      metadata: { type: 'object', additionalProperties: true },
      ip: string({ nullable: true, example: '127.0.0.1' }),
      userAgent: string({ nullable: true }),
      createdAt: dateTime(),
    },
  },
  SuperuserAuditLog: {
    type: 'object',
    properties: {
      id: ref('ObjectId'),
      action: string({ example: 'record.purged' }),
      outcome: string({ enum: ['success', 'failure'] }),
      entity: string({ example: 'products' }),
      entityId: string({ nullable: true }),
      targetCollection: string({ nullable: true, example: 'products' }),
      targetId: string({ nullable: true }),
      actorId: refWith('ObjectId', { nullable: true }),
      actorRole: string({ nullable: true, example: 'superuser' }),
      metadata: { type: 'object', additionalProperties: true },
      previousState: { type: 'object', nullable: true, additionalProperties: true },
      newState: { type: 'object', nullable: true, additionalProperties: true },
      snapshot: { type: 'object', nullable: true, additionalProperties: true, description: 'Instantanea redactada del registro purgado.' },
      ip: string({ nullable: true }),
      userAgent: string({ nullable: true }),
      timestamp: dateTime(),
      createdAt: dateTime(),
    },
  },

  // --- Tienda y configuracion publica ---------------------------------------
  Product: {
    type: 'object',
    description: 'Producto del catalogo publico. Nunca expone costo ni proveedor.',
    properties: {
      id: ref('ObjectId'),
      sku: string({ example: 'LAP-0001' }),
      name: string({ example: 'Laptop 14 pulgadas' }),
      description: string({ nullable: true }),
      category: string({ example: 'computacion' }),
      imageUrl: string({ nullable: true, example: 'https://ejemplo.com/img/lap.jpg' }),
      stock: integer({ minimum: 0, example: 12 }),
      pickupAvailable: boolean(),
      acceptedPaymentMethods: arrayOf(ref('PaymentMethod')),
      originalPrice: money(),
      discountPercent: number({ minimum: 0, maximum: 100, example: 10 }),
      finalPrice: refWith('Money', { description: 'Precio final con el descuento aplicado, en quetzales.', example: 499 }),
      hasDiscount: boolean(),
      taxRatePercent: number({ example: 12 }),
      isFeatured: boolean(),
      rating: { type: 'object', properties: { average: number({ example: 4.5 }), count: integer({ example: 18 }) } },
    },
  },
  BankAccount: {
    type: 'object',
    required: ['bankName', 'accountNumber', 'accountHolder', 'accountType'],
    properties: {
      bankName: string({ enum: [...BANKS], example: 'Banco Industrial' }),
      accountNumber: string({ pattern: '^[0-9][0-9-]{3,28}[0-9]$', description: 'Solo digitos y guiones (5 a 30 caracteres), empezando y terminando en digito.', example: '123-456789-0' }),
      accountHolder: string({ minLength: 3, maxLength: 120, example: 'Mi Empresa S.A.' }),
      accountType: string({ enum: [...ALL_BANK_ACCOUNT_TYPES], example: 'monetaria' }),
      isActive: boolean({ default: true, description: 'Opcional al guardar (por defecto `true`). La configuracion publica no lo incluye.' }),
    },
  },
  PublicStoreConfig: {
    type: 'object',
    properties: {
      defaultTaxRate: number({ minimum: 0, maximum: 1, description: 'Tasa de IVA por defecto como fraccion (0.12 = 12 %).', example: 0.12 }),
      companyBankAccounts: arrayOf(
        { type: 'object', properties: { bankName: string({ example: 'Banco Industrial' }), accountNumber: string({ example: '123-456789-0' }), accountHolder: string({ example: 'Mi Empresa S.A.' }), accountType: string({ enum: [...ALL_BANK_ACCOUNT_TYPES] }) } },
        { description: 'Solo cuentas activas, sin `isActive`.' },
      ),
    },
  },
  Settings: {
    type: 'object',
    properties: {
      defaultTaxRate: number({ minimum: 0, maximum: 1, example: 0.12 }),
      companyBankAccounts: arrayOf(ref('BankAccount')),
      maintenanceMode: boolean({ example: false }),
      updatedAt: dateTime({ nullable: true }),
      updatedBy: refWith('ObjectId', { nullable: true }),
    },
  },
  UpdateSettingsRequest: strict(
    {
      defaultTaxRate: number({ minimum: 0, maximum: 1, description: 'Fraccion 0..1 con maximo 4 decimales.', example: 0.12 }),
      maintenanceMode: boolean({ description: 'Con `true`, el checkout del POS responde 503 `MAINTENANCE_MODE`.', example: false }),
      companyBankAccounts: arrayOf(ref('BankAccount'), { maxItems: MAX_COMPANY_BANK_ACCOUNTS, description: 'REEMPLAZA la lista actual. No admite banco + numero repetidos (los guiones se ignoran al comparar).' }),
    },
    [],
    { minProperties: 1, description: 'Al menos un campo.' },
  ),

  // --- Carrito ---------------------------------------------------------------
  AddCartItemRequest: strict({ productId: ref('ObjectId'), quantity: integer({ minimum: 1, maximum: 999, example: 2 }) }, ['productId', 'quantity']),
  UpdateCartItemRequest: strict({ quantity: integer({ minimum: 1, maximum: 999, example: 3 }) }, ['quantity']),
  ApplyCouponRequest: strict(
    { code: string({ pattern: '^[A-Za-z0-9_-]{3,30}$', description: 'Se normaliza a mayusculas.', example: 'VERANO20' }) },
    ['code'],
  ),
  CartItem: {
    type: 'object',
    properties: {
      productId: ref('ObjectId'),
      sku: string({ example: 'LAP-0001' }),
      name: string(),
      imageUrl: string({ nullable: true }),
      quantity: integer({ minimum: 1 }),
      availableStock: integer({ minimum: 0 }),
      unitPrice: money(),
      discountPercent: number(),
      unitFinalPrice: money(),
      taxRatePercent: number(),
      subtotal: money(),
      discountTotal: money(),
      taxTotal: money(),
      grandTotal: money(),
    },
  },
  CartCoupon: {
    type: 'object',
    nullable: true,
    description: '`null` si no hay cupon. Si el cupon dejo de ser valido, `applied` es `false` y se informa `reason` y `message`.',
    properties: {
      code: string({ example: 'VERANO20' }),
      applied: boolean(),
      discount: refWith('Money', { description: 'Descuento del cupon (solo si `applied` es `true`).' }),
      reason: string({ example: 'COUPON_EXPIRED' }),
      message: string({ example: 'El cupon ha expirado' }),
    },
  },
  CartIssue: {
    type: 'object',
    description: 'Incidencia de una linea del carrito (nunca produce un error HTTP en el GET).',
    properties: {
      productId: ref('ObjectId'),
      code: string({ enum: ['PRODUCT_UNAVAILABLE', 'INSUFFICIENT_STOCK'] }),
      requested: integer(),
      availableStock: integer(),
    },
  },
  Cart: {
    type: 'object',
    description: 'Carrito con su caja (precios, descuentos e impuestos).',
    properties: {
      currency: string({ example: 'GTQ' }),
      items: arrayOf(ref('CartItem')),
      coupon: ref('CartCoupon'),
      issues: arrayOf(ref('CartIssue')),
      summary: {
        type: 'object',
        properties: {
          subtotal: money(),
          productDiscountTotal: money(),
          couponDiscountTotal: money(),
          discountTotal: money(),
          taxTotal: money(),
          grandTotal: money(),
          totalItemsCount: integer(),
        },
      },
    },
  },

  // --- Checkout (POS) --------------------------------------------------------
  CardPayment: strict(
    {
      paymentToken: string({
        pattern: '^[A-Za-z0-9_-]{8,255}$',
        description: 'Token emitido por la pasarela. Una secuencia de 13 a 19 digitos (forma de PAN) se rechaza.',
        example: 'tok_abc12345',
      }),
      last4: string({ pattern: '^\\d{4}$', example: '4242' }),
      cardHolderName: string({ minLength: 2, maxLength: 120, example: 'Ana Perez' }),
      cardBrand: string({ enum: [...CARD_BRANDS], example: 'Visa' }),
    },
    ['paymentToken', 'last4', 'cardHolderName', 'cardBrand'],
    { description: 'Datos de tarjeta tokenizada (PCI-DSS). Nunca se envia el numero completo ni el CVV: `pciGuard` los rechaza con 400 `PCI_DATA_FORBIDDEN`.' },
  ),
  BankTransferPayment: strict(
    {
      bankName: string({ enum: [...BANKS], example: 'Banco Industrial' }),
      senderAccountNumber: string({ pattern: '^[0-9-]{4,34}$', example: '1234567890' }),
      transferAmount: number({ format: 'double', exclusiveMinimum: true, minimum: 0, maximum: 1000000000, description: 'Monto transferido en quetzales (mayor que 0, maximo 2 decimales).', example: 1250.5 }),
      authorizationNumber: string({ pattern: '^[A-Za-z0-9-]{3,64}$', example: 'AUTH-12345' }),
      receiptUrl: string({ format: 'uri', minLength: 10, maxLength: 2048, description: 'URL https del comprobante.', example: 'https://ejemplo.com/comprobante.png' }),
    },
    ['bankName', 'senderAccountNumber', 'transferAmount', 'authorizationNumber', 'receiptUrl'],
    { description: 'Datos del comprobante de la transferencia.' },
  ),
  CheckoutCashOnDelivery: strict(
    {
      paymentMethod: string({ enum: [PAYMENT_METHODS.CASH_ON_DELIVERY] }),
      ...checkoutCommonFields(),
    },
    ['paymentMethod', 'customerName', 'email', 'phone', 'shippingAddress'],
    { description: 'Pago contra entrega: exige nombre, correo, telefono y direccion. No admite `payment` (campo no permitido). El pedido nace `confirmed` y la factura `pending_payment`.' },
  ),
  CheckoutCard: strict(
    {
      paymentMethod: string({ enum: [PAYMENT_METHODS.CARD] }),
      ...checkoutCommonFields(),
      payment: ref('CardPayment'),
    },
    ['paymentMethod', 'payment'],
    { description: 'Pago con tarjeta tokenizada. El pedido nace `paid` y la factura `paid`. Nunca se envia PAN ni CVV.' },
  ),
  CheckoutBankTransfer: strict(
    {
      paymentMethod: string({ enum: [PAYMENT_METHODS.BANK_TRANSFER] }),
      ...checkoutCommonFields(),
      payment: ref('BankTransferPayment'),
    },
    ['paymentMethod', 'payment'],
    { description: 'Transferencia bancaria. El pedido nace `pending_verification` hasta que un administrador la concilie (`PATCH /admin/orders/{id}/reconcile`).' },
  ),
  CheckoutRequest: {
    description: 'Cuerpo del checkout: depende de `paymentMethod` (discriminador). El carrito del usuario autenticado es el origen de las lineas.',
    oneOf: [ref('CheckoutCashOnDelivery'), ref('CheckoutCard'), ref('CheckoutBankTransfer')],
    discriminator: {
      propertyName: 'paymentMethod',
      mapping: {
        [PAYMENT_METHODS.CASH_ON_DELIVERY]: '#/components/schemas/CheckoutCashOnDelivery',
        [PAYMENT_METHODS.CARD]: '#/components/schemas/CheckoutCard',
        [PAYMENT_METHODS.BANK_TRANSFER]: '#/components/schemas/CheckoutBankTransfer',
      },
    },
  },
  OrderCustomer: {
    type: 'object',
    properties: { name: string({ example: 'Ana Perez' }), email: emailField(), phone: string({ nullable: true }) },
  },
  OrderItem: {
    type: 'object',
    properties: {
      productId: ref('ObjectId'),
      sku: string(),
      name: string(),
      quantity: integer({ minimum: 1 }),
      unitPrice: money(),
      discountPercent: number(),
      unitFinalPrice: money(),
      taxRatePercent: number(),
      subtotal: money(),
      productDiscount: money(),
      couponDiscount: money(),
      discountTotal: money(),
      tax: money(),
      total: money(),
    },
  },
  OrderTotals: {
    type: 'object',
    properties: {
      subtotal: money(),
      productDiscount: money(),
      couponDiscount: money(),
      discountTotal: money(),
      taxTotal: money(),
      grandTotal: money(),
      totalItemsCount: integer(),
    },
  },
  OrderPayment: {
    type: 'object',
    description: 'Datos de pago no sensibles: nunca incluye token, autorizacion de la pasarela ni id de transaccion.',
    properties: {
      method: ref('PaymentMethod'),
      status: ref('PaymentStatus'),
      card: {
        type: 'object',
        nullable: true,
        properties: { brand: string({ example: 'Visa' }), last4: string({ example: '4242' }), holderName: string({ example: 'Ana Perez' }) },
      },
      bankTransfer: {
        type: 'object',
        nullable: true,
        properties: {
          bankName: string(),
          senderAccountNumber: string({ description: 'Enmascarada: `****` + ultimos 4 digitos.', example: '****7890' }),
          transferAmount: money(),
          authorizationNumber: string(),
          receiptUrl: string(),
          verifiedAt: dateTime({ nullable: true }),
        },
      },
    },
  },
  Order: {
    type: 'object',
    properties: {
      id: ref('ObjectId'),
      orderNumber: string({ example: 'ORD-000001' }),
      userId: refWith('ObjectId', { nullable: true }),
      channel: string({ enum: [...ALL_ORDER_CHANNELS], example: 'pos' }),
      status: ref('OrderStatus'),
      currency: string({ example: 'GTQ' }),
      customer: ref('OrderCustomer'),
      shippingAddress: nullableRef('Address'),
      items: arrayOf(ref('OrderItem')),
      coupon: {
        type: 'object',
        nullable: true,
        properties: {
          code: string({ example: 'VERANO20' }),
          discountType: string({ enum: [...ALL_COUPON_TYPES] }),
          discountValue: number({ description: 'Porcentaje tal cual (tipo `percentage`) o monto en quetzales (tipo `fixed`).' }),
          discount: money(),
        },
      },
      totals: ref('OrderTotals'),
      payment: ref('OrderPayment'),
      invoiceId: refWith('ObjectId', { nullable: true }),
      notes: string({ nullable: true }),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    },
  },
  InvoiceItem: {
    type: 'object',
    properties: {
      productId: ref('ObjectId'),
      sku: string(),
      name: string(),
      quantity: integer({ minimum: 1 }),
      unitPrice: money(),
      discount: money(),
      taxRatePercent: number(),
      tax: money(),
      total: money(),
    },
  },
  Invoice: {
    type: 'object',
    description: 'Factura de venta al cliente.',
    properties: {
      id: ref('ObjectId'),
      invoiceNumber: string({ example: 'FAC-000001' }),
      orderId: ref('ObjectId'),
      orderNumber: string({ example: 'ORD-000001' }),
      nit: string({ example: 'CF' }),
      nitType: string({ enum: Object.values(NIT_TYPES), description: '`nit` o `user_code` (cuando la factura no tiene NIT).' }),
      entityName: string({ example: 'Ana Perez' }),
      email: string({ nullable: true }),
      paymentMethod: ref('PaymentMethod'),
      shippingAddress: nullableRef('Address'),
      items: arrayOf(ref('InvoiceItem')),
      currency: string({ example: 'GTQ' }),
      subtotal: money(),
      discountTotal: money(),
      taxTotal: money(),
      grandTotal: money(),
      status: ref('InvoiceStatus'),
      issuedAt: dateTime(),
    },
  },
  CheckoutResult: {
    type: 'object',
    properties: { order: ref('Order'), invoice: ref('Invoice') },
  },

  // --- Admin: pedidos (conciliacion) ----------------------------------------
  PendingTransfer: {
    type: 'object',
    properties: {
      id: ref('ObjectId'),
      orderNumber: string(),
      status: ref('OrderStatus'),
      currency: string({ example: 'GTQ' }),
      customer: ref('OrderCustomer'),
      totals: ref('OrderTotals'),
      payment: {
        type: 'object',
        properties: {
          method: ref('PaymentMethod'),
          status: ref('PaymentStatus'),
          bankTransfer: {
            type: 'object',
            nullable: true,
            properties: {
              authorizationNumber: string(),
              bankName: string(),
              receiptUrl: string(),
              transferAmount: money(),
              senderAccountNumber: string({ description: 'Enmascarada: `****` + ultimos 4 digitos.', example: '****7890' }),
            },
          },
        },
      },
      invoiceId: refWith('ObjectId', { nullable: true }),
      createdAt: dateTime(),
    },
  },
  ReconcileRequest: strict(
    {
      action: string({ enum: Object.values(RECONCILE_ACTIONS), example: 'reject' }),
      reason: string({ minLength: 3, maxLength: 500, description: 'Obligatorio al rechazar (`reject`).', example: 'El comprobante no coincide con el monto' }),
    },
    ['action'],
  ),
  ReconciledInvoice: {
    type: 'object',
    properties: {
      id: ref('ObjectId'),
      invoiceNumber: string(),
      status: ref('InvoiceStatus'),
      grandTotal: money(),
      voidedAt: dateTime({ nullable: true }),
      voidReason: string({ nullable: true }),
      updatedAt: dateTime(),
    },
  },
  ReconciliationResult: {
    type: 'object',
    properties: { order: ref('Order'), invoice: ref('ReconciledInvoice') },
  },

  // --- Admin: cupones ---------------------------------------------------------
  Coupon: {
    type: 'object',
    properties: {
      id: ref('ObjectId'),
      code: string({ example: 'VERANO20' }),
      description: string({ nullable: true }),
      discountType: string({ enum: [...ALL_COUPON_TYPES] }),
      discountPercent: integer({ nullable: true, example: 20, description: 'Porcentaje (solo cupones `percentage`).' }),
      discountValue: number({ description: 'Porcentaje tal cual o monto en quetzales (cupones `fixed`).', example: 20 }),
      applicableProductIds: idArray(),
      isGlobal: boolean({ description: '`true` si no restringe productos.' }),
      isPermanent: boolean(),
      validFrom: dateTime(),
      expiresAt: dateTime({ nullable: true }),
      maxUses: integer({ nullable: true }),
      maxUsesPerUser: integer({ nullable: true }),
      usedCount: integer({ minimum: 0 }),
      isActive: boolean(),
      createdBy: refWith('ObjectId', { nullable: true }),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    },
  },
  CreateCouponRequest: strict(
    {
      code: string({ nullable: true, maxLength: 30, description: 'Vacio o ausente: se genera automaticamente. En mayusculas debe cumplir `^[A-Z0-9_-]{3,30}$`.', example: 'VERANO20' }),
      description: string({ nullable: true, maxLength: 500, example: '20% de descuento de verano' }),
      discountPercent: integer({ minimum: 1, maximum: 100, example: 20 }),
      expiresAt: dateTime({ description: 'Fecha futura. Regla de negocio: `expiresAt` XOR `isPermanent` (422 si faltan ambos o vienen ambos).', example: '2026-12-31T23:59:59Z' }),
      isPermanent: boolean({ example: false }),
      validFrom: dateTime({ example: '2026-06-01T00:00:00Z' }),
      maxUses: integer({ nullable: true, minimum: 1, maximum: 1000000, example: 100 }),
      maxUsesPerUser: integer({ nullable: true, minimum: 1, maximum: 1000000, description: 'No puede superar `maxUses`.', example: 1 }),
      applicableProductIds: idArray({ maxItems: 500, description: 'Vacio o ausente: cupon global. Los productos deben existir (422 si no).' }),
    },
    ['discountPercent'],
  ),
  UpdateCouponRequest: strict(
    {
      description: string({ nullable: true, maxLength: 500 }),
      discountPercent: integer({ minimum: 1, maximum: 100, example: 15 }),
      expiresAt: dateTime({ example: '2027-01-31T23:59:59Z' }),
      isPermanent: boolean(),
      isActive: boolean(),
      applicableProductIds: idArray({ maxItems: 500 }),
    },
    [],
    { minProperties: 1, description: 'Al menos un campo. No admite cambiar el codigo.' },
  ),
  ApplicableProduct: {
    type: 'object',
    properties: {
      id: ref('ObjectId'),
      sku: string(),
      name: string(),
      category: string(),
      price: money(),
      discountPercent: number(),
      stock: integer(),
      isActive: boolean(),
    },
  },

  // --- Admin: inventario ------------------------------------------------------
  InventoryProduct: {
    type: 'object',
    properties: {
      id: ref('ObjectId'),
      sku: string(),
      name: string(),
      category: string(),
      stock: integer({ minimum: 0 }),
      costPrice: refWith('Money', { nullable: true, description: 'Costo unitario (`null` si se desconoce).' }),
      salePrice: money(),
      discountPercent: number(),
      finalPrice: money(),
      imageUrl: string({ nullable: true }),
      isActive: boolean(),
      supplierId: refWith('ObjectId', { nullable: true }),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    },
  },
  InventoryProductDetail: {
    allOf: [
      ref('InventoryProduct'),
      {
        type: 'object',
        properties: {
          description: string({ nullable: true }),
          supplier: {
            type: 'object',
            nullable: true,
            properties: {
              id: ref('ObjectId'),
              supplierCode: string({ example: 'PRV-000001' }),
              name: string(),
              nit: string(),
              phone: string({ nullable: true }),
              address: string({ nullable: true }),
              distributionDescription: string({ nullable: true }),
              isActive: boolean(),
            },
          },
        },
      },
    ],
  },
  RecordLossRequest: strict(
    {
      productId: ref('ObjectId'),
      quantity: integer({ minimum: 1, maximum: 100000, example: 2 }),
      reason: string({ enum: [...ALL_LOSS_REASONS], example: 'damaged' }),
      notes: string({ nullable: true, maxLength: 1000, example: 'Danado en bodega' }),
      occurredAt: dateTime({ description: 'No puede estar en el futuro (422).' }),
    },
    ['productId', 'quantity', 'reason'],
  ),
  InventoryLoss: {
    type: 'object',
    properties: {
      id: ref('ObjectId'),
      productId: ref('ObjectId'),
      sku: string(),
      productName: string(),
      category: string(),
      supplierId: refWith('ObjectId', { nullable: true }),
      quantity: integer({ minimum: 1 }),
      reason: string({ enum: [...ALL_LOSS_REASONS] }),
      unitCost: money(),
      totalLoss: money(),
      notes: string({ nullable: true }),
      recordedBy: refWith('ObjectId', { nullable: true }),
      occurredAt: dateTime(),
      createdAt: dateTime(),
    },
  },

  // --- Admin: compras ---------------------------------------------------------
  PurchaseItemInput: strict(
    {
      productId: ref('ObjectId'),
      quantity: integer({ minimum: 1, maximum: 100000, example: 20 }),
      unitCost: number({ format: 'double', minimum: 0, maximum: 10000000, description: 'Costo unitario en quetzales (maximo 2 decimales).', example: 250 }),
    },
    ['productId', 'quantity', 'unitCost'],
  ),
  CreatePurchaseRequest: strict(
    {
      supplierId: ref('ObjectId'),
      paymentMethod: refWith('PaymentMethod', { description: 'Por defecto `bank_transfer`.' }),
      supplierInvoiceNumber: string({ nullable: true, minLength: 1, maxLength: 60, example: 'FAC-0042' }),
      notes: string({ nullable: true, maxLength: 1000, example: 'Reposicion mensual' }),
      purchasedAt: dateTime({ description: 'No puede estar en el futuro (422).' }),
      items: arrayOf(ref('PurchaseItemInput'), { minItems: 1, maxItems: 200, description: 'Sin productos repetidos.' }),
    },
    ['supplierId', 'items'],
    { description: 'Ingresa mercaderia: aumenta el stock, actualiza el costo y genera una factura de proveedor.' },
  ),
  SupplierInvoice: {
    type: 'object',
    properties: {
      id: ref('ObjectId'),
      invoiceNumber: string(),
      entityType: string({ enum: ['proveedor'] }),
      supplierId: ref('ObjectId'),
      purchaseId: ref('ObjectId'),
      nit: string(),
      nitType: string({ enum: Object.values(NIT_TYPES) }),
      entityName: string(),
      email: string({ nullable: true }),
      paymentMethod: ref('PaymentMethod'),
      items: arrayOf(ref('InvoiceItem')),
      currency: string({ example: 'GTQ' }),
      subtotal: money(),
      discountTotal: money(),
      taxTotal: money(),
      grandTotal: money(),
      status: ref('InvoiceStatus'),
      issuedAt: dateTime(),
    },
  },
  Purchase: {
    type: 'object',
    properties: {
      id: ref('ObjectId'),
      purchaseNumber: string({ example: 'COM-000001' }),
      supplierId: ref('ObjectId'),
      supplier: { type: 'object', properties: { supplierCode: string({ example: 'PRV-000001' }), name: string(), nit: string() } },
      items: arrayOf({
        type: 'object',
        properties: {
          productId: ref('ObjectId'),
          sku: string(),
          name: string(),
          quantity: integer(),
          unitCost: money(),
          previousCost: refWith('Money', { nullable: true }),
          total: money(),
        },
      }),
      totalCost: money(),
      paymentMethod: ref('PaymentMethod'),
      invoiceId: ref('ObjectId'),
      supplierInvoiceNumber: string({ nullable: true }),
      notes: string({ nullable: true }),
      createdBy: refWith('ObjectId', { nullable: true }),
      purchasedAt: dateTime(),
      createdAt: dateTime(),
      invoice: refWith('SupplierInvoice', { nullable: true, description: 'Factura de proveedor (solo en el alta y el detalle).' }),
    },
  },

  // --- Admin: proveedores -----------------------------------------------------
  SupplierCatalogInput: strict(
    {
      productId: ref('ObjectId'),
      cost: number({ format: 'double', minimum: 0, maximum: 10000000, description: 'Costo en quetzales (maximo 2 decimales).', example: 250 }),
    },
    ['productId', 'cost'],
  ),
  CreateSupplierRequest: strict(
    {
      name: string({ minLength: 1, maxLength: 160, example: 'Distribuidora Central S.A.' }),
      nit: string({ maxLength: 40, pattern: SUPPLIER_NIT_PATTERN, example: '1234567-8' }),
      address: string({ minLength: 1, maxLength: 300, example: '3a Calle 5-10, Zona 4' }),
      phone: string({ maxLength: 20, pattern: PHONE_PATTERN, example: '+502 2222-3333' }),
      email: string({ nullable: true, maxLength: 254, pattern: EMAIL_PATTERN, example: 'ventas@distribuidora.com' }),
      contactName: string({ nullable: true, maxLength: 120, example: 'Carlos Mendez' }),
      distributionDescription: string({ minLength: 1, maxLength: 2000, example: 'Distribuye equipo de computo en todo el pais' }),
      catalog: arrayOf(ref('SupplierCatalogInput'), { maxItems: 1000, description: 'Sin productos repetidos; los productos deben existir (422 si no).' }),
    },
    ['name', 'nit', 'address', 'phone', 'distributionDescription'],
    { description: 'El `supplierCode` lo asigna el sistema: enviarlo produce "Campo no permitido".' },
  ),
  UpdateSupplierRequest: strict(
    {
      name: string({ minLength: 1, maxLength: 160 }),
      nit: string({ maxLength: 40, pattern: SUPPLIER_NIT_PATTERN }),
      address: string({ minLength: 1, maxLength: 300 }),
      phone: string({ maxLength: 20, pattern: PHONE_PATTERN }),
      email: string({ nullable: true, maxLength: 254, pattern: EMAIL_PATTERN }),
      contactName: string({ nullable: true, maxLength: 120 }),
      distributionDescription: string({ minLength: 1, maxLength: 2000 }),
      isActive: boolean(),
      catalog: arrayOf(ref('SupplierCatalogInput'), { maxItems: 1000, description: 'REEMPLAZA el catalogo actual.' }),
    },
    [],
    { minProperties: 1, description: 'Al menos un campo. No admite `supplierCode`.' },
  ),
  Supplier: {
    type: 'object',
    properties: {
      id: ref('ObjectId'),
      supplierCode: string({ example: 'PRV-000001' }),
      name: string(),
      nit: string({ example: '1234567-8' }),
      address: string({ nullable: true }),
      phone: string({ nullable: true }),
      email: string({ nullable: true }),
      contactName: string({ nullable: true }),
      distributionDescription: string({ nullable: true }),
      isActive: boolean(),
      createdAt: dateTime(),
      updatedAt: dateTime(),
      catalog: arrayOf({ type: 'object', properties: { productId: ref('ObjectId'), cost: money() } }),
    },
  },
  SupplierDetail: {
    allOf: [
      {
        type: 'object',
        description: 'Proveedor con el catalogo enriquecido con datos del producto.',
        properties: {
          id: ref('ObjectId'),
          supplierCode: string(),
          name: string(),
          nit: string(),
          address: string({ nullable: true }),
          phone: string({ nullable: true }),
          email: string({ nullable: true }),
          contactName: string({ nullable: true }),
          distributionDescription: string({ nullable: true }),
          isActive: boolean(),
          createdAt: dateTime(),
          updatedAt: dateTime(),
          catalog: arrayOf({
            type: 'object',
            properties: {
              productId: ref('ObjectId'),
              cost: money(),
              sku: string({ nullable: true }),
              name: string({ nullable: true }),
              stock: integer({ nullable: true }),
              salePrice: refWith('Money', { nullable: true }),
              finalPrice: refWith('Money', { nullable: true }),
              isActive: boolean({ nullable: true }),
            },
          }),
        },
      },
    ],
  },

  // --- Admin: clientes --------------------------------------------------------
  Customer: {
    type: 'object',
    description: 'Fila del directorio de clientes con metricas calculadas.',
    properties: {
      id: ref('ObjectId'),
      userCode: string({ description: 'Codigo de cliente (por defecto, el id en texto).', example: 'CLI-0001' }),
      name: string({ example: 'Ana Perez' }),
      firstName: string(),
      lastName: string(),
      email: emailField(),
      phone: string({ nullable: true }),
      isActive: boolean(),
      purchasedItems: integer({ minimum: 0 }),
      returnedItems: integer({ minimum: 0 }),
      totalSpent: money(),
      ordersCount: integer({ minimum: 0 }),
      preferredPaymentMethod: refWith('PaymentMethod', { nullable: true }),
      paymentMethods: arrayOf({
        type: 'object',
        properties: { method: ref('PaymentMethod'), orders: integer(), lastOrderAt: dateTime({ nullable: true }) },
      }),
      createdAt: dateTime(),
    },
  },
  CustomerAccount: {
    type: 'object',
    description: 'Cuenta basica del cliente tras una mutacion (sin metricas).',
    properties: {
      id: ref('ObjectId'),
      userCode: string(),
      name: string(),
      firstName: string(),
      lastName: string(),
      email: emailField(),
      phone: string({ nullable: true }),
      isActive: boolean(),
      updatedAt: dateTime(),
    },
  },
  UpdateCustomerRequest: strict(
    {
      firstName: nameField('Ana'),
      lastName: nameField('Perez'),
      phone: phoneField(),
      userCode: string({
        nullable: true,
        pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$',
        description: 'Codigo de cliente (3 a 40 caracteres). No puede tener forma de ObjectId; `null` restablece el codigo por defecto. Se guarda en mayusculas (409 `USER_CODE_IN_USE` si ya existe).',
        example: 'CLI-0001',
      }),
    },
    [],
    { minProperties: 1, description: 'Al menos un campo. No admite correo, rol ni estado.' },
  ),

  // --- Admin: facturas --------------------------------------------------------
  AdminInvoiceSummary: {
    type: 'object',
    description: 'Resumen de factura. Las de cliente incluyen `orderId`, `orderNumber` y `userId`; las de proveedor `supplierId` y `purchaseId`.',
    properties: {
      id: ref('ObjectId'),
      invoiceNumber: string(),
      entityType: string({ enum: [...ALL_INVOICE_ENTITY_TYPES], example: 'cliente' }),
      orderId: refWith('ObjectId', { nullable: true }),
      orderNumber: string({ nullable: true }),
      userId: refWith('ObjectId', { nullable: true }),
      supplierId: refWith('ObjectId', { nullable: true }),
      purchaseId: refWith('ObjectId', { nullable: true }),
      nit: string(),
      nitType: string({ enum: Object.values(NIT_TYPES) }),
      entityName: string(),
      email: string({ nullable: true }),
      paymentMethod: ref('PaymentMethod'),
      shippingAddress: nullableRef('Address'),
      currency: string({ example: 'GTQ' }),
      status: ref('InvoiceStatus'),
      issuedAt: dateTime(),
      itemsCount: integer(),
      grandTotal: money(),
    },
  },
  AdminInvoiceDetail: {
    allOf: [
      ref('AdminInvoiceSummary'),
      {
        type: 'object',
        properties: {
          items: arrayOf({
            type: 'object',
            properties: {
              productId: ref('ObjectId'),
              sku: string(),
              name: string(),
              quantity: integer(),
              unitPrice: money(),
              lineSubtotal: money(),
              discount: money(),
              taxRatePercent: number(),
              tax: money(),
              total: money(),
            },
          }),
          totals: {
            type: 'object',
            properties: { subtotal: money(), discountTotal: money(), taxTotal: money(), grandTotal: money() },
          },
          voidedAt: dateTime({ nullable: true }),
          voidReason: string({ nullable: true }),
        },
      },
    ],
  },

  // --- Admin: reportes --------------------------------------------------------
  GeneralReport: {
    type: 'object',
    properties: {
      salesSummary: {
        type: 'object',
        properties: { revenue: money(), ordersCount: integer(), unitsSold: integer(), averageTicket: money() },
      },
      paymentMethodBreakdown: arrayOf({ type: 'object', properties: { method: ref('PaymentMethod'), ordersCount: integer(), revenue: money() } }),
      couponRanking: arrayOf({ type: 'object', properties: { code: string(), uses: integer(), totalDiscount: money(), revenue: money() } }),
      topProducts: arrayOf({
        type: 'object',
        properties: { productId: refWith('ObjectId', { nullable: true }), sku: string(), name: string(), category: string(), unitsSold: integer(), revenue: money(), ordersCount: integer() },
      }),
      losses: {
        type: 'object',
        properties: {
          totalUnits: integer(),
          totalLoss: money(),
          records: integer(),
          byReason: arrayOf({ type: 'object', properties: { reason: string({ enum: [...ALL_LOSS_REASONS] }), units: integer(), totalLoss: money(), records: integer() } }),
        },
      },
      inventoryStatus: {
        type: 'object',
        properties: {
          lowStockThreshold: integer(),
          totals: {
            type: 'object',
            properties: { products: integer(), units: integer(), inventoryCost: money(), inventoryRetail: money(), lowStockCount: integer() },
          },
          products: arrayOf({
            type: 'object',
            properties: {
              productId: refWith('ObjectId', { nullable: true }),
              sku: string(),
              name: string(),
              category: string(),
              isActive: boolean(),
              stock: integer(),
              costPrice: refWith('Money', { nullable: true }),
              salePrice: refWith('Money', { nullable: true }),
              inventoryCost: money(),
              inventoryRetail: money(),
              lowStock: boolean(),
            },
          }),
        },
      },
      filters: {
        type: 'object',
        properties: {
          startDate: dateTime({ nullable: true }),
          endDate: dateTime({ nullable: true }),
          category: string({ nullable: true }),
          productName: string({ nullable: true }),
          lowStockThreshold: integer(),
          topLimit: integer(),
        },
      },
    },
  },
  SupplierPerformance: {
    type: 'object',
    properties: {
      productId: ref('ObjectId'),
      sku: string(),
      name: string(),
      category: string(),
      isActive: boolean(),
      stock: integer(),
      supplier: {
        type: 'object',
        nullable: true,
        properties: { id: ref('ObjectId'), supplierCode: string(), name: string(), phone: string({ nullable: true }), distributionDescription: string({ nullable: true }) },
      },
      unitsSold: integer(),
      revenue: money(),
      netRevenue: money(),
      returnedUnits: integer(),
      returnRate: number({ description: 'Proporcion de unidades devueltas sobre las despachadas (0 a 1, 4 decimales).', minimum: 0, maximum: 1 }),
      lossUnits: integer(),
      lossCost: money(),
      costPrice: refWith('Money', { nullable: true }),
      salePrice: refWith('Money', { nullable: true }),
      effectivePrice: refWith('Money', { nullable: true }),
      grossMargin: {
        type: 'object',
        properties: { percent: number({ nullable: true }), grossProfit: refWith('Money', { nullable: true }), unitMargin: refWith('Money', { nullable: true }), basis: string({ nullable: true }) },
      },
      recommendation: string({ enum: ['continuar', 'evaluar', 'cambiar_proveedor'], description: 'Recomendacion calculada sobre el proveedor.' }),
      recommendationReasons: arrayOf(string()),
      period: { type: 'object', properties: { startDate: dateTime({ nullable: true }), endDate: dateTime({ nullable: true }) } },
    },
  },

  // --- Superusuario -----------------------------------------------------------
  PurgeResult: {
    type: 'object',
    properties: {
      collection: string({ enum: [...ALL_PURGEABLE_COLLECTIONS], example: 'products' }),
      id: ref('ObjectId'),
      purged: boolean({ example: true }),
      auditLogId: ref('ObjectId'),
    },
  },
};

/** Parametros reutilizables. */
export const parameters = {
  Page: { name: 'page', in: 'query', required: false, description: 'Pagina (por defecto 1).', schema: integer({ minimum: 1, maximum: 100000, default: 1 }) },
  Limit: { name: 'limit', in: 'query', required: false, description: 'Elementos por pagina (por defecto 20, maximo 100).', schema: integer({ minimum: 1, maximum: 100, default: 20 }) },
};

/** Construye una respuesta de error con ejemplos. */
const errorResponse = (description, code, message, details) => ({
  description,
  content: {
    'application/json': {
      schema: ref('Error'),
      example: { error: { code, message, ...(details ? { details } : {}) } },
    },
  },
});

/** Respuestas de error compartidas. */
export const responses = {
  BadRequest: errorResponse('Datos de entrada invalidos (`VALIDATION_ERROR`, `INVALID_JSON`, `FORBIDDEN_KEYS`, `PCI_DATA_FORBIDDEN`, ...).', 'VALIDATION_ERROR', 'Datos de entrada invalidos', [
    { field: 'email', message: 'Campo obligatorio' },
  ]),
  Unauthorized: errorResponse('Sin sesion, token invalido/expirado o sesion revocada (`AUTH_REQUIRED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `SESSION_REVOKED`).', 'AUTH_REQUIRED', 'Autenticacion requerida'),
  PaymentRequired: errorResponse('La pasarela rechazo el pago.', 'PAYMENT_DECLINED', 'El pago fue rechazado'),
  Forbidden: errorResponse('Rol o permiso insuficiente, o regla de negocio que prohibe la accion (`FORBIDDEN`, `INSUFFICIENT_RANK`, `SELF_MODIFICATION_FORBIDDEN`, ...).', 'FORBIDDEN', 'No tienes permisos para esta operacion'),
  NotFound: errorResponse('Recurso inexistente (`*_NOT_FOUND`, `ROUTE_NOT_FOUND`).', 'NOT_FOUND', 'Recurso no encontrado'),
  Conflict: errorResponse('Conflicto con el estado actual (duplicados, reglas de negocio, integridad fiscal).', 'EMAIL_IN_USE', 'El correo ya esta registrado'),
  Unprocessable: errorResponse('Datos validos en forma pero que incumplen una regla de negocio.', 'CART_EMPTY', 'El carrito esta vacio'),
  Locked: errorResponse('Cuenta bloqueada temporalmente por intentos fallidos.', 'ACCOUNT_LOCKED', 'Cuenta bloqueada temporalmente por intentos fallidos'),
  BadGateway: errorResponse('Fallo de un servicio externo (pasarela de pago).', 'PAYMENT_GATEWAY_ERROR', 'La pasarela de pago no respondio'),
  ServiceUnavailable: errorResponse('Tienda en mantenimiento (`MAINTENANCE_MODE`).', 'MAINTENANCE_MODE', 'La tienda esta en mantenimiento; intenta de nuevo mas tarde'),
  ConflictStock: {
    description: 'Stock insuficiente (cuerpo fijado por contrato) u otro conflicto con el estado actual.',
    content: {
      'application/json': {
        schema: { oneOf: [ref('InsufficientStockError'), ref('Error')] },
        examples: {
          stock: { summary: 'Stock insuficiente', value: { error: 'INSUFFICIENT_STOCK', availableStock: 3, productId: ID, message: 'No hay stock suficiente para la cantidad solicitada' } },
          unavailable: { summary: 'Producto no disponible', value: { error: { code: 'PRODUCT_UNAVAILABLE', message: 'Un producto del carrito ya no esta disponible' } } },
        },
      },
    },
  },
};

/** Esquemas de seguridad. */
export const securitySchemes = {
  bearerAuth: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'JWT de acceso devuelto en `data.accessToken` de `POST /auth/login` (o `/auth/register`, `/auth/refresh`). Se envia como `Authorization: Bearer <token>`. Es la forma recomendada para "Try it out" en Swagger UI: pulsa **Authorize** y pega el token.',
  },
  cookieAuth: {
    type: 'apiKey',
    in: 'cookie',
    name: 'access_token',
    description: 'Cookie httpOnly `access_token` fijada por login/registro/refresco (ruta `/`, vida corta). El navegador la envia sola en las mismas peticiones al mismo origen; Swagger UI no puede establecerla a mano. La cookie `refresh_token` solo viaja a `/api/v1/auth` (por eso el refresco debe llamarse en esa ruta).',
  },
};

/** Ejemplos de checkout compartidos con las rutas. */
export const checkoutExamples = {
  cash_on_delivery: {
    summary: 'Contra entrega',
    value: {
      paymentMethod: PAYMENT_METHODS.CASH_ON_DELIVERY,
      customerName: 'Ana Perez',
      email: 'ana.perez@example.com',
      phone: '+502 5555-1234',
      shippingAddress: { line1: '5a Avenida 10-20, Zona 1', line2: 'Apto 4B', city: 'Ciudad de Guatemala', state: 'Guatemala', postalCode: '01001', country: 'GT' },
      nit: '1234567-8',
      entityName: 'Ana Perez',
      notes: 'Entregar por la tarde',
    },
  },
  card: {
    summary: 'Tarjeta tokenizada',
    value: {
      paymentMethod: PAYMENT_METHODS.CARD,
      nit: 'CF',
      payment: { paymentToken: 'tok_abc12345', last4: '4242', cardHolderName: 'Ana Perez', cardBrand: 'Visa' },
    },
  },
  bank_transfer: {
    summary: 'Transferencia bancaria',
    value: {
      paymentMethod: PAYMENT_METHODS.BANK_TRANSFER,
      nit: 'CF',
      payment: {
        bankName: 'Banco Industrial',
        senderAccountNumber: '1234567890',
        transferAmount: 1250.5,
        authorizationNumber: 'AUTH-12345',
        receiptUrl: 'https://ejemplo.com/comprobante.png',
      },
    },
  },
};

/** Exporta tambien el ObjectId de ejemplo para los ejemplos de las rutas. */
export const EXAMPLE_ID = ID;
export const EXAMPLE_ID_2 = ID2;
