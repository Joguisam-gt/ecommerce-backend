/**
 * Rutas (paths) de la especificacion OpenAPI 3.0.3.
 *
 * Documenta TODAS las rutas registradas en src/routes/*.js, agrupadas por modulo.
 * Los parametros y cuerpos reflejan los validadores (src/validators/*) y las
 * respuestas, los controladores y DTOs. La prueba tests/unit/openapi.test.js
 * comprueba que ninguna ruta registrada quede sin documentar (ni al reves).
 * El permiso de cada ruta se calcula desde la matriz RBAC real.
 */
import {
  ALL_INVOICE_ENTITY_TYPES,
  ALL_INVOICE_STATUSES,
  ALL_LOSS_REASONS,
  ALL_PAYMENT_METHODS,
  AVAILABILITY,
} from '../constants/commerce.js';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { ALL_ROLES } from '../constants/roles.js';
import { ALL_PURGEABLE_COLLECTIONS, AUDIT_LOG_MAX_LIMIT, STAFF_ROLES } from '../constants/superuser.js';
import { COLLECTIONS } from '../database/collections.js';
import { INVENTORY_SORT_KEYS } from '../validators/inventory.validator.js';
import { PRODUCT_SORTS } from '../validators/store.validator.js';
import {
  AUTHENTICATED,
  PAGINATION,
  PUBLIC,
  PUBLIC_NOTE,
  SESSION_ONLY,
  access,
  body,
  envelope,
  errors,
  idPath,
  json,
  paged,
  param,
  query,
  queryBool,
  queryDate,
  queryId,
  queryMoney,
  queryText,
  ref,
} from './openapi.helpers.js';
import { EXAMPLE_ID, EXAMPLE_ID_2, checkoutExamples } from './openapi.schemas.js';

/** Etiquetas (tags) del documento. */
export const TAGS = Object.freeze({
  HEALTH: 'Salud',
  AUTH: 'Autenticacion',
  USERS: 'Usuarios',
  AUDIT: 'Auditoria',
  STORE: 'Tienda',
  CART: 'Carrito',
  POS: 'POS',
  INVOICES: 'Facturas',
  ADMIN_ORDERS: 'Admin - Pedidos',
  ADMIN_COUPONS: 'Admin - Cupones',
  ADMIN_INVENTORY: 'Admin - Inventario',
  ADMIN_PURCHASES: 'Admin - Compras',
  ADMIN_SUPPLIERS: 'Admin - Proveedores',
  ADMIN_CUSTOMERS: 'Admin - Clientes',
  ADMIN_INVOICES: 'Admin - Facturas',
  ADMIN_REPORTS: 'Admin - Reportes',
  SUPERUSER: 'Superusuario',
});

/** Cabeceras Set-Cookie de las respuestas de sesion. */
const SESSION_HEADERS = {
  'Set-Cookie': {
    description: 'Cookies httpOnly `access_token` (ruta `/`) y `refresh_token` (limitada a `/api/v1/auth`).',
    schema: { type: 'string' },
  },
};

/** Cabecera Location de las respuestas 201. */
const LOCATION_HEADER = { Location: { description: 'URL del recurso creado.', schema: { type: 'string' } } };

/** Ejemplo de sesion (respuesta de login). */
const SESSION_EXAMPLE = {
  data: {
    user: {
      id: EXAMPLE_ID,
      email: 'root@example.com',
      firstName: 'Super',
      lastName: 'Usuario',
      phone: null,
      role: 'superuser',
      isActive: true,
      lastLoginAt: '2026-11-13T13:32:12.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-11-13T13:32:12.000Z',
      permissions: ['profile:read', 'profile:update', 'catalog:read', 'cart:manage', 'pos:use'],
    },
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    expiresIn: 900,
  },
};

/** Ejemplo de usuario. */
const USER_EXAMPLE = {
  id: EXAMPLE_ID,
  email: 'ana.perez@example.com',
  firstName: 'Ana',
  lastName: 'Perez',
  phone: '+502 5555-1234',
  role: 'user',
  isActive: true,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** Ejemplo de carrito. */
const CART_EXAMPLE = {
  data: {
    currency: 'GTQ',
    items: [
      {
        productId: EXAMPLE_ID,
        sku: 'LAP-0001',
        name: 'Laptop 14 pulgadas',
        imageUrl: 'https://ejemplo.com/img/lap.jpg',
        quantity: 1,
        availableStock: 12,
        unitPrice: 555.56,
        discountPercent: 10,
        unitFinalPrice: 500,
        taxRatePercent: 12,
        subtotal: 555.56,
        discountTotal: 55.56,
        taxTotal: 53.57,
        grandTotal: 500,
      },
    ],
    coupon: null,
    issues: [],
    summary: {
      subtotal: 555.56,
      productDiscountTotal: 55.56,
      couponDiscountTotal: 0,
      discountTotal: 55.56,
      taxTotal: 53.57,
      grandTotal: 500,
      totalItemsCount: 1,
    },
  },
};

/** Ejemplo de factura de cliente. */
const INVOICE_EXAMPLE = {
  id: EXAMPLE_ID_2,
  invoiceNumber: 'FAC-000001',
  orderId: EXAMPLE_ID,
  orderNumber: 'ORD-000001',
  nit: 'CF',
  nitType: 'nit',
  entityName: 'Ana Perez',
  email: 'ana.perez@example.com',
  paymentMethod: 'card',
  shippingAddress: null,
  items: [
    { productId: EXAMPLE_ID, sku: 'LAP-0001', name: 'Laptop 14 pulgadas', quantity: 1, unitPrice: 555.56, discount: 55.56, taxRatePercent: 12, tax: 53.57, total: 500 },
  ],
  currency: 'GTQ',
  subtotal: 555.56,
  discountTotal: 55.56,
  taxTotal: 53.57,
  grandTotal: 500,
  status: 'paid',
  issuedAt: '2026-11-13T13:40:00.000Z',
};

/** Ejemplo de proveedor. */
const SUPPLIER_EXAMPLE = {
  id: EXAMPLE_ID_2,
  supplierCode: 'PRV-000001',
  name: 'Distribuidora Central S.A.',
  nit: '1234567-8',
  address: '3a Calle 5-10, Zona 4',
  phone: '+502 2222-3333',
  email: 'ventas@distribuidora.com',
  contactName: 'Carlos Mendez',
  distributionDescription: 'Distribuye equipo de computo en todo el pais',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  catalog: [{ productId: EXAMPLE_ID, cost: 250 }],
};

/** Ejemplo de cupon. */
const COUPON_EXAMPLE = {
  id: EXAMPLE_ID_2,
  code: 'VERANO20',
  description: '20% de descuento de verano',
  discountType: 'percentage',
  discountPercent: 20,
  discountValue: 20,
  applicableProductIds: [EXAMPLE_ID],
  isGlobal: false,
  isPermanent: false,
  validFrom: '2026-06-01T00:00:00.000Z',
  expiresAt: '2026-12-31T23:59:59.000Z',
  maxUses: 100,
  maxUsesPerUser: 1,
  usedCount: 0,
  isActive: true,
  createdBy: EXAMPLE_ID,
  createdAt: '2026-05-20T10:00:00.000Z',
  updatedAt: '2026-05-20T10:00:00.000Z',
};

/** Construye una operacion con los valores por defecto del proyecto. */
function operation({ tags, summary, description, security = AUTHENTICATED, parameters, requestBody, responses }) {
  return {
    tags,
    summary,
    description,
    ...(security === PUBLIC ? { security: [] } : { security }),
    ...(parameters && parameters.length > 0 ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses,
  };
}

/** Parametro de ruta :id estandar. */
const id = (description) => idPath('id', description);

/** Parametros de fecha de rango de reportes y facturas. */
const rangeParams = () => [
  queryDate('startDate', 'Inicio del rango (inclusive).'),
  queryDate('endDate', 'Fin del rango (inclusive; una fecha sin hora abarca el dia completo). Debe ser igual o posterior a `startDate`.'),
];

/** Rutas documentadas. */
export const paths = {
  // =============================================================== Salud ====
  '/health': {
    get: operation({
      tags: [TAGS.HEALTH],
      summary: 'Estado del servicio',
      description: `Comprueba que el servicio responde y que la base de datos esta disponible.\n\n${PUBLIC_NOTE}`,
      security: PUBLIC,
      responses: {
        200: json('Servicio operativo.', ref('HealthStatus'), { example: { status: 'ok', database: 'up', uptimeSeconds: 3600 } }),
        503: json('Base de datos no disponible (estado degradado).', ref('HealthStatus'), { example: { status: 'degraded', database: 'down', uptimeSeconds: 12 } }),
      },
    }),
  },
  '/docs/openapi.json': {
    get: operation({
      tags: [TAGS.HEALTH],
      summary: 'Especificacion OpenAPI',
      description: `Devuelve esta misma especificacion OpenAPI 3.0.3 en JSON (para cargarla desde Swagger UI u otros clientes).\n\n${PUBLIC_NOTE}`,
      security: PUBLIC,
      responses: { 200: json('Documento OpenAPI.', { type: 'object', description: 'Especificacion OpenAPI 3.0.3.' }) },
    }),
  },

  // =========================================================== Autenticacion ====
  '/auth/register': {
    post: operation({
      tags: [TAGS.AUTH],
      summary: 'Registro de cliente',
      description: `Crea una cuenta con rol \`user\` e inicia sesion (fija las cookies de sesion y devuelve el access token).\n\n${PUBLIC_NOTE}`,
      security: PUBLIC,
      requestBody: body(ref('RegisterRequest'), {
        example: { email: 'ana.perez@example.com', password: 'Secreta123', firstName: 'Ana', lastName: 'Perez', phone: '+502 5555-1234' },
      }),
      responses: {
        201: { ...json('Cuenta creada y sesion iniciada.', envelope(ref('AuthSession')), { example: SESSION_EXAMPLE }), headers: SESSION_HEADERS },
        ...errors(400, 409),
      },
    }),
  },
  '/auth/login': {
    post: operation({
      tags: [TAGS.AUTH],
      summary: 'Inicio de sesion',
      description: `Valida las credenciales y devuelve \`data.accessToken\` en el cuerpo. Ademas fija las cookies httpOnly \`access_token\` (ruta \`/\`) y \`refresh_token\` (solo viaja a \`/api/v1/auth\`).\n\nCopia \`data.accessToken\` y usalo en **Authorize** (\`bearerAuth\`) para probar el resto de rutas. Tras varios intentos fallidos la cuenta se bloquea temporalmente (423).\n\n${PUBLIC_NOTE}`,
      security: PUBLIC,
      requestBody: body(ref('LoginRequest'), { example: { email: 'root@example.com', password: 'CambiaEsto123' } }),
      responses: {
        200: { ...json('Sesion iniciada.', envelope(ref('AuthSession')), { example: SESSION_EXAMPLE }), headers: SESSION_HEADERS },
        ...errors(400, 401, 403, 423),
      },
    }),
  },
  '/auth/refresh': {
    post: operation({
      tags: [TAGS.AUTH],
      summary: 'Renovar la sesion',
      description:
        'Emite un par de tokens nuevo a partir de la cookie httpOnly `refresh_token`, que **solo viaja a `/api/v1/auth`**: por eso el refresco debe llamarse en esa ruta (no en el alias `/api`). No lleva cuerpo. Swagger UI no puede enviar cookies a mano; desde un navegador la cookie se envia sola.\n\n**Acceso:** cookie `refresh_token` valida y no revocada.',
      security: PUBLIC,
      parameters: [{ name: 'refresh_token', in: 'cookie', required: false, description: 'Cookie de refresco fijada por login/registro.', schema: { type: 'string' } }],
      responses: {
        200: { ...json('Sesion renovada.', envelope(ref('AuthSession')), { example: SESSION_EXAMPLE }), headers: SESSION_HEADERS },
        401: errors(401)[401],
      },
    }),
  },
  '/auth/logout': {
    post: operation({
      tags: [TAGS.AUTH],
      summary: 'Cerrar sesion',
      description: `Revoca TODAS las sesiones del usuario (incrementa su \`tokenVersion\`) y borra las cookies.\n\n${SESSION_ONLY}`,
      responses: { 204: { description: 'Sesiones revocadas.' }, ...errors(401) },
    }),
  },
  '/auth/password': {
    patch: operation({
      tags: [TAGS.AUTH],
      summary: 'Cambiar la contrasena',
      description: `Cambia la contrasena verificando la actual. Revoca las demas sesiones y devuelve una sesion nueva (tokens nuevos) para la actual.\n\n${SESSION_ONLY}`,
      requestBody: body(ref('ChangePasswordRequest'), { example: { currentPassword: 'Secreta123', newPassword: 'NuevaClave456' } }),
      responses: {
        200: { ...json('Contrasena cambiada; sesion renovada.', envelope(ref('AuthSession')), { example: SESSION_EXAMPLE }), headers: SESSION_HEADERS },
        ...errors(400, 401),
      },
    }),
  },

  // =============================================================== Usuarios ====
  '/users/me': {
    get: operation({
      tags: [TAGS.USERS],
      summary: 'Perfil propio',
      description: `Devuelve el perfil del usuario autenticado con sus permisos efectivos.\n\n${access([P.PROFILE_READ])}`,
      responses: {
        200: json('Perfil.', envelope(ref('UserWithPermissions')), { example: { data: { ...USER_EXAMPLE, permissions: ['profile:read', 'cart:manage'] } } }),
        ...errors(401, 403),
      },
    }),
    patch: operation({
      tags: [TAGS.USERS],
      summary: 'Actualizar el perfil propio',
      description: `Actualiza nombre, apellido y telefono propios (sin correo, rol ni estado).\n\n${access([P.PROFILE_UPDATE])}`,
      requestBody: body(ref('UpdateProfileRequest'), { example: { firstName: 'Ana', phone: '+502 5555-9999' } }),
      responses: { 200: json('Perfil actualizado.', envelope(ref('User')), { example: { data: USER_EXAMPLE } }), ...errors(400, 401, 403) },
    }),
  },
  '/users': {
    get: operation({
      tags: [TAGS.USERS],
      summary: 'Listar usuarios',
      description: `Lista paginada de usuarios (sin datos sensibles como \`passwordHash\`).\n\n${access([P.USERS_READ])}`,
      parameters: [...PAGINATION, query('role', ref('Role'), 'Filtra por rol.'), queryBool('isActive', 'Filtra por estado.'), queryText('search', 100, 'Busqueda por nombre o correo.')],
      responses: { 200: json('Pagina de usuarios.', paged('User')), ...errors(400, 401, 403) },
    }),
    post: operation({
      tags: [TAGS.USERS],
      summary: 'Crear usuario',
      description: `Crea un usuario con el rol indicado. Un \`admin\` solo puede crear clientes (rol \`user\`); crear \`admin\` o \`superuser\` requiere ser superusuario (\`403 ROLE_NOT_ASSIGNABLE\`).\n\n${access([P.USERS_CREATE])}`,
      requestBody: body(ref('CreateUserRequest'), {
        example: { email: 'luis.gomez@example.com', password: 'Secreta123', firstName: 'Luis', lastName: 'Gomez', role: 'user' },
      }),
      responses: { 201: { ...json('Usuario creado.', envelope(ref('User')), { example: { data: USER_EXAMPLE } }), headers: LOCATION_HEADER }, ...errors(400, 401, 403, 409) },
    }),
  },
  '/users/{id}': {
    get: operation({
      tags: [TAGS.USERS],
      summary: 'Detalle de usuario',
      description: access([P.USERS_READ]),
      parameters: [id('Id del usuario.')],
      responses: { 200: json('Usuario.', envelope(ref('User')), { example: { data: USER_EXAMPLE } }), ...errors(400, 401, 403, 404) },
    }),
    patch: operation({
      tags: [TAGS.USERS],
      summary: 'Editar usuario',
      description: `Edita correo, nombre, apellido o telefono. Un \`admin\` solo puede editar cuentas con rol \`user\` (\`403 INSUFFICIENT_RANK\`).\n\n${access([P.USERS_UPDATE])}`,
      parameters: [id('Id del usuario.')],
      requestBody: body(ref('UpdateUserRequest'), { example: { firstName: 'Luis Alberto' } }),
      responses: { 200: json('Usuario actualizado.', envelope(ref('User')), { example: { data: USER_EXAMPLE } }), ...errors(400, 401, 403, 404, 409) },
    }),
    delete: operation({
      tags: [TAGS.USERS],
      summary: 'Purgar usuario (borrado fisico)',
      description: `Borrado fisico delegado en la purga: la cuenta debe estar desactivada (\`400 NOT_SOFT_DELETED\`) y sin pedidos ni facturas (\`409 FISCAL_INTEGRITY_LOCK\`). No se puede purgar la propia cuenta.\n\n${access([P.USERS_DELETE])}`,
      parameters: [id('Id del usuario.')],
      responses: { 204: { description: 'Usuario purgado.' }, ...errors(400, 401, 403, 404, 409) },
    }),
  },
  '/users/{id}/status': {
    patch: operation({
      tags: [TAGS.USERS],
      summary: 'Activar o desactivar usuario',
      description: `Cambia \`isActive\`; desactivar revoca las sesiones. No se puede cambiar el estado de la propia cuenta (\`403 SELF_MODIFICATION_FORBIDDEN\`) ni dejar el sistema sin superusuarios activos (\`409 LAST_SUPERUSER\`). Un \`admin\` solo gestiona cuentas \`user\`.\n\n${access([P.USERS_DEACTIVATE])}`,
      parameters: [id('Id del usuario.')],
      requestBody: body(ref('ChangeStatusRequest'), { example: { isActive: false } }),
      responses: { 200: json('Estado actualizado.', envelope(ref('User')), { example: { data: { ...USER_EXAMPLE, isActive: false } } }), ...errors(400, 401, 403, 404, 409) },
    }),
  },
  '/users/{id}/role': {
    patch: operation({
      tags: [TAGS.USERS],
      summary: 'Cambiar el rol de un usuario',
      description: `Cambia el rol y revoca las sesiones de la cuenta. No se puede cambiar el propio rol (\`403 SELF_MODIFICATION_FORBIDDEN\`) ni dejar el sistema sin superusuarios activos (\`409 LAST_SUPERUSER\`).\n\n${access([P.ADMINS_MANAGE])}`,
      parameters: [id('Id del usuario.')],
      requestBody: body(ref('ChangeRoleRequest'), { example: { role: 'admin' } }),
      responses: { 200: json('Rol actualizado.', envelope(ref('User')), { example: { data: { ...USER_EXAMPLE, role: 'admin' } } }), ...errors(400, 401, 403, 404, 409) },
    }),
  },

  // ============================================================== Auditoria ====
  '/audit-logs': {
    get: operation({
      tags: [TAGS.AUDIT],
      summary: 'Bitacora de auditoria (Fase 1)',
      description: `Lectura de \`audit_logs\` con filtros. Solo lectura. Para la consulta ampliada del superusuario vease \`GET /superuser/audit-logs\`.\n\n${access([P.AUDIT_READ])}`,
      parameters: [
        param('Page'),
        query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 50 }, 'Elementos por pagina (por defecto 50, maximo 100).'),
        query('action', { type: 'string', maxLength: 80, pattern: '^[a-z_]+(\\.[a-z_]+)?$', example: 'auth.login' }, 'Accion exacta (formato `entidad.accion`).'),
        query('entity', { type: 'string', maxLength: 60, pattern: '^[a-z_]+$', example: 'users' }, 'Entidad afectada.'),
        query('entityId', { type: 'string', maxLength: 64 }, 'Id de la entidad afectada.'),
        queryId('actorId', 'Id del autor de la accion.'),
        query('outcome', { type: 'string', enum: ['success', 'failure'] }, 'Resultado.'),
        queryDate('from', 'Desde (ISO 8601). Debe ser anterior a `to`.'),
        queryDate('to', 'Hasta (ISO 8601).'),
      ],
      responses: { 200: json('Pagina de registros de auditoria.', paged('AuditLog')), ...errors(400, 401, 403) },
    }),
  },

  // ================================================================ Tienda ====
  '/store/products': {
    get: operation({
      tags: [TAGS.STORE],
      summary: 'Catalogo de productos',
      description: `Listado publico de productos activos con filtros y paginacion. Los precios salen en quetzales (decimales). \`meta\` incluye ademas \`currency\`.\n\n${PUBLIC_NOTE}`,
      security: PUBLIC,
      parameters: [
        ...PAGINATION,
        queryText('category', 80, 'Categoria exacta.'),
        queryBool('featured', 'Solo destacados.'),
        queryBool('onSale', 'Solo con descuento.'),
        queryBool('newArrivals', 'Solo novedades.'),
        queryBool('topRated', 'Solo mejor valorados.'),
        queryText('search', 100, 'Busqueda por texto.'),
        queryMoney('minPrice', 'Precio final minimo; no puede superar `maxPrice`'),
        queryMoney('maxPrice', 'Precio final maximo'),
        query('sort', { type: 'string', enum: [...PRODUCT_SORTS] }, 'Orden del resultado.'),
      ],
      responses: {
        200: json('Pagina de productos.', {
          type: 'object',
          required: ['data', 'meta'],
          properties: { data: { type: 'array', items: ref('Product') }, meta: ref('StorePageMeta') },
        }, {
          example: {
            data: [
              {
                id: EXAMPLE_ID,
                sku: 'LAP-0001',
                name: 'Laptop 14 pulgadas',
                description: 'Ultraliviana',
                category: 'computacion',
                imageUrl: 'https://ejemplo.com/img/lap.jpg',
                stock: 12,
                pickupAvailable: true,
                acceptedPaymentMethods: ['cash_on_delivery', 'card', 'bank_transfer'],
                originalPrice: 555.56,
                discountPercent: 10,
                finalPrice: 499,
                hasDiscount: true,
                taxRatePercent: 12,
                isFeatured: true,
                rating: { average: 4.5, count: 18 },
              },
            ],
            meta: { total: 1, page: 1, limit: 20, totalPages: 1, currency: 'GTQ' },
          },
        }),
        ...errors(400),
      },
    }),
  },
  '/store/products/{id}': {
    get: operation({
      tags: [TAGS.STORE],
      summary: 'Detalle de un producto',
      description: `Detalle de un producto activo.\n\n${PUBLIC_NOTE}`,
      security: PUBLIC,
      parameters: [id('Id del producto.')],
      responses: { 200: json('Producto.', envelope(ref('Product'))), ...errors(400, 404) },
    }),
  },
  '/store/config/public': {
    get: operation({
      tags: [TAGS.STORE],
      summary: 'Configuracion publica de la tienda',
      description: `Tasa de IVA por defecto y cuentas bancarias activas de la empresa (para pagar por transferencia). Nunca expone \`maintenanceMode\` ni \`isActive\`. Responde con \`Cache-Control: public, max-age=60\`.\n\n${PUBLIC_NOTE}`,
      security: PUBLIC,
      responses: {
        200: {
          ...json('Configuracion publica.', envelope(ref('PublicStoreConfig')), {
            example: {
              data: {
                defaultTaxRate: 0.12,
                companyBankAccounts: [{ bankName: 'Banco Industrial', accountNumber: '123-456789-0', accountHolder: 'Mi Empresa S.A.', accountType: 'monetaria' }],
              },
            },
          }),
          headers: { 'Cache-Control': { description: '`public, max-age=60`.', schema: { type: 'string' } } },
        },
      },
    }),
  },

  // =============================================================== Carrito ====
  '/cart': {
    get: operation({
      tags: [TAGS.CART],
      summary: 'Ver el carrito',
      description: `Devuelve el carrito del usuario con su caja (precios, descuentos e impuestos). Las lineas con problemas (producto no disponible, stock insuficiente) se informan en \`issues\` sin fallar.\n\n${access([P.CART_MANAGE])}`,
      responses: { 200: json('Carrito.', envelope(ref('Cart')), { example: CART_EXAMPLE }), ...errors(401, 403) },
    }),
  },
  '/cart/items': {
    post: operation({
      tags: [TAGS.CART],
      summary: 'Agregar un producto',
      description: `Agrega un producto (o suma cantidad si ya esta). Maximo 100 lineas distintas y 999 unidades por linea.\n\n${access([P.CART_MANAGE])}`,
      requestBody: body(ref('AddCartItemRequest'), { example: { productId: EXAMPLE_ID, quantity: 1 } }),
      responses: {
        201: json('Carrito actualizado.', envelope(ref('Cart')), { example: CART_EXAMPLE }),
        ...errors(400, 401, 403, 404),
        409: { $ref: '#/components/responses/ConflictStock' },
        ...errors(422),
      },
    }),
  },
  '/cart/items/{productId}': {
    patch: operation({
      tags: [TAGS.CART],
      summary: 'Cambiar la cantidad de una linea',
      description: `Fija la cantidad de un producto que ya esta en el carrito.\n\n${access([P.CART_MANAGE])}`,
      parameters: [idPath('productId', 'Id del producto en el carrito.')],
      requestBody: body(ref('UpdateCartItemRequest'), { example: { quantity: 3 } }),
      responses: {
        200: json('Carrito actualizado.', envelope(ref('Cart')), { example: CART_EXAMPLE }),
        ...errors(400, 401, 403, 404),
        409: { $ref: '#/components/responses/ConflictStock' },
      },
    }),
    delete: operation({
      tags: [TAGS.CART],
      summary: 'Quitar un producto',
      description: `Elimina una linea del carrito.\n\n${access([P.CART_MANAGE])}`,
      parameters: [idPath('productId', 'Id del producto en el carrito.')],
      responses: { 200: json('Carrito actualizado.', envelope(ref('Cart')), { example: CART_EXAMPLE }), ...errors(400, 401, 403, 404) },
    }),
  },
  '/cart/coupon': {
    post: operation({
      tags: [TAGS.CART],
      summary: 'Aplicar un cupon',
      description: `Aplica un cupon al carrito. Responde 422 si el carrito esta vacio (\`CART_EMPTY\`) o si el cupon no es valido (\`COUPON_NOT_FOUND\`, \`COUPON_INACTIVE\`, \`COUPON_NOT_STARTED\`, \`COUPON_EXPIRED\`, \`COUPON_USAGE_LIMIT_REACHED\`, \`COUPON_USER_LIMIT_REACHED\`, \`COUPON_NOT_APPLICABLE\`, \`COUPON_MIN_ORDER_NOT_MET\`).\n\n${access([P.CART_MANAGE])}`,
      requestBody: body(ref('ApplyCouponRequest'), { example: { code: 'VERANO20' } }),
      responses: { 200: json('Carrito con el cupon aplicado.', envelope(ref('Cart'))), ...errors(400, 401, 403, 422) },
    }),
    delete: operation({
      tags: [TAGS.CART],
      summary: 'Quitar el cupon',
      description: `Quita el cupon aplicado al carrito.\n\n${access([P.CART_MANAGE])}`,
      responses: { 200: json('Carrito sin cupon.', envelope(ref('Cart')), { example: CART_EXAMPLE }), ...errors(401, 403) },
    }),
  },

  // ==================================================================== POS ====
  '/pos/checkout': {
    post: operation({
      tags: [TAGS.POS],
      summary: 'Checkout del carrito',
      description: [
        'Convierte el carrito del usuario en un pedido y una factura. El cuerpo depende de `paymentMethod` (`cash_on_delivery`, `card`, `bank_transfer`); consulta `CheckoutRequest` (oneOf + discriminator) y los ejemplos.',
        '',
        '- **Contra entrega:** exige `customerName`, `email`, `phone` y `shippingAddress`; no admite `payment`. Pedido `confirmed`, factura `pending_payment`.',
        '- **Tarjeta (PCI-DSS):** solo `payment` con `paymentToken` (token de la pasarela), `last4`, `cardHolderName` y `cardBrand`. **Nunca** se envia numero completo ni CVV: se rechazan con `400 PCI_DATA_FORBIDDEN`. Pedido `paid`, factura `paid`.',
        '- **Transferencia:** `payment` con los datos del comprobante. Pedido `pending_verification` hasta la conciliacion de un administrador.',
        '',
        '**Idempotencia:** la cabecera opcional `Idempotency-Key` (8 a 100 caracteres `[A-Za-z0-9_-]`) hace seguro el reintento: la primera llamada responde 201; un reintento con la misma clave responde **200** con la cabecera `Idempotent-Replayed: true` y el mismo resultado, sin cobrar de nuevo. Reutilizar la clave con otro metodo de pago produce `409 IDEMPOTENCY_KEY_CONFLICT`.',
        '',
        'Si la tienda esta en mantenimiento responde `503 MAINTENANCE_MODE`. Un stock insuficiente responde 409 con el cuerpo `{ error: "INSUFFICIENT_STOCK", availableStock, productId, message }`.',
        '',
        access([P.POS_USE]),
      ].join('\n'),
      parameters: [
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          description: 'Clave de idempotencia (8 a 100 caracteres `[A-Za-z0-9_-]`).',
          schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,100}$', example: 'checkout-2026-11-13-0001' },
        },
      ],
      requestBody: body(ref('CheckoutRequest'), { examples: checkoutExamples }),
      responses: {
        200: {
          ...json('Reintento idempotente: mismo resultado que la primera llamada.', envelope(ref('CheckoutResult'))),
          headers: { 'Idempotent-Replayed': { description: 'Siempre `true` en esta respuesta.', schema: { type: 'string', enum: ['true'] } } },
        },
        201: json('Pedido y factura creados.', envelope(ref('CheckoutResult')), { example: { data: { order: { id: EXAMPLE_ID, orderNumber: 'ORD-000001', status: 'paid' }, invoice: INVOICE_EXAMPLE } } }),
        ...errors(400, 401, 402, 403),
        409: { $ref: '#/components/responses/ConflictStock' },
        ...errors(422, 502, 503),
      },
    }),
  },

  // ================================================================ Facturas ====
  '/invoices': {
    get: operation({
      tags: [TAGS.INVOICES],
      summary: 'Listar facturas',
      description: `Lista paginada de facturas. Un cliente ve solo las suyas; con \`invoices:manage\` (admin/superuser) ve todas y puede filtrar por \`userId\`.\n\n${SESSION_ONLY}`,
      parameters: [
        ...PAGINATION,
        queryId('userId', 'Filtra por usuario (solo tiene efecto con `invoices:manage`; para el resto se ignora).'),
        query('status', { type: 'string', enum: [...ALL_INVOICE_STATUSES] }, 'Estado de la factura.'),
        query('nit', { type: 'string', maxLength: 40, example: '1234567-8' }, 'NIT, `CF` o codigo de usuario (ObjectId) cuando la factura no tiene NIT.'),
      ],
      responses: { 200: json('Pagina de facturas.', paged('Invoice')), ...errors(400, 401) },
    }),
  },
  '/invoices/{id}': {
    get: operation({
      tags: [TAGS.INVOICES],
      summary: 'Detalle de factura',
      description: `Detalle de una factura. Si pertenece a otro usuario responde 404 (salvo con \`invoices:manage\`).\n\n${SESSION_ONLY}`,
      parameters: [id('Id de la factura.')],
      responses: { 200: json('Factura.', envelope(ref('Invoice')), { example: { data: INVOICE_EXAMPLE } }), ...errors(400, 401, 404) },
    }),
  },

  // ======================================================== Admin: pedidos ====
  '/admin/orders/pending-verification': {
    get: operation({
      tags: [TAGS.ADMIN_ORDERS],
      summary: 'Transferencias pendientes de verificar',
      description: `Cola de pedidos pagados por transferencia bancaria en estado \`pending_verification\`. La cuenta de origen sale enmascarada.\n\n${access([P.ORDERS_MANAGE], { scope: 'admin' })}`,
      parameters: [...PAGINATION],
      responses: { 200: json('Pagina de transferencias pendientes.', paged('PendingTransfer')), ...errors(400, 401, 403) },
    }),
  },
  '/admin/orders/{id}/reconcile': {
    patch: operation({
      tags: [TAGS.ADMIN_ORDERS],
      summary: 'Conciliar una transferencia',
      description: `Aprueba (\`approve\`: pedido \`paid\`, factura \`paid\`) o rechaza (\`reject\`, con \`reason\` obligatorio: pedido \`rejected\`, factura anulada y stock repuesto) una transferencia pendiente. Responde 409 si el pedido ya no esta pendiente (\`ORDER_NOT_PENDING_VERIFICATION\`) o su factura no esta pendiente de pago.\n\n${access([P.ORDERS_MANAGE], { scope: 'admin' })}`,
      parameters: [id('Id del pedido.')],
      requestBody: body(ref('ReconcileRequest'), {
        examples: {
          approve: { summary: 'Aprobar', value: { action: 'approve' } },
          reject: { summary: 'Rechazar', value: { action: 'reject', reason: 'El comprobante no coincide con el monto' } },
        },
      }),
      responses: { 200: json('Resultado de la conciliacion.', envelope(ref('ReconciliationResult'), { meta: true })), ...errors(400, 401, 403, 404, 409) },
    }),
  },

  // ======================================================= Admin: cupones ====
  '/admin/coupons/applicable-products': {
    get: operation({
      tags: [TAGS.ADMIN_COUPONS],
      summary: 'Productos aplicables a un cupon',
      description: `Busca productos para restringir un cupon (filtros por nombre, precio, categoria y disponibilidad).\n\n${access([P.COUPONS_MANAGE], { scope: 'admin' })}`,
      parameters: [
        ...PAGINATION,
        queryText('name', 100, 'Nombre del producto (busqueda parcial).'),
        queryMoney('minPrice', 'Precio minimo; no puede superar `maxPrice`'),
        queryMoney('maxPrice', 'Precio maximo'),
        queryText('category', 80, 'Categoria.'),
        query('availability', { type: 'string', enum: Object.values(AVAILABILITY) }, 'Disponibilidad de stock.'),
      ],
      responses: { 200: json('Pagina de productos.', paged('ApplicableProduct')), ...errors(400, 401, 403) },
    }),
  },
  '/admin/coupons': {
    get: operation({
      tags: [TAGS.ADMIN_COUPONS],
      summary: 'Listar cupones',
      description: access([P.COUPONS_MANAGE], { scope: 'admin' }),
      parameters: [
        ...PAGINATION,
        queryBool('isActive', 'Filtra por estado.'),
        query('code', { type: 'string', minLength: 1, maxLength: 30, pattern: '^[A-Za-z0-9_-]+$' }, 'Codigo del cupon (se normaliza a mayusculas).'),
      ],
      responses: { 200: json('Pagina de cupones.', paged('Coupon')), ...errors(400, 401, 403) },
    }),
    post: operation({
      tags: [TAGS.ADMIN_COUPONS],
      summary: 'Crear un cupon',
      description: `Crea un cupon porcentual. Regla de negocio: \`expiresAt\` XOR \`isPermanent\` (422 \`COUPON_EXPIRATION_REQUIRED\` o \`COUPON_EXPIRATION_CONFLICT\`); \`expiresAt\` debe ser futura y posterior a \`validFrom\`. \`code\` vacio o ausente genera uno automatico.\n\n${access([P.COUPONS_MANAGE], { scope: 'admin' })}`,
      requestBody: body(ref('CreateCouponRequest'), {
        example: {
          code: 'VERANO20',
          description: '20% de descuento de verano',
          discountPercent: 20,
          expiresAt: '2026-12-31T23:59:59Z',
          isPermanent: false,
          maxUses: 100,
          maxUsesPerUser: 1,
          applicableProductIds: [EXAMPLE_ID],
        },
      }),
      responses: {
        201: { ...json('Cupon creado.', envelope(ref('Coupon'), { meta: true }), { example: { data: COUPON_EXAMPLE, meta: {} } }), headers: LOCATION_HEADER },
        ...errors(400, 401, 403, 409, 422),
      },
    }),
  },
  '/admin/coupons/{id}': {
    get: operation({
      tags: [TAGS.ADMIN_COUPONS],
      summary: 'Detalle de cupon',
      description: access([P.COUPONS_MANAGE], { scope: 'admin' }),
      parameters: [id('Id del cupon.')],
      responses: { 200: json('Cupon.', envelope(ref('Coupon'), { meta: true }), { example: { data: COUPON_EXAMPLE, meta: {} } }), ...errors(400, 401, 403, 404) },
    }),
    patch: operation({
      tags: [TAGS.ADMIN_COUPONS],
      summary: 'Editar un cupon',
      description: `Edicion parcial (al menos un campo). Se aplican las mismas reglas de vigencia que en el alta.\n\n${access([P.COUPONS_MANAGE], { scope: 'admin' })}`,
      parameters: [id('Id del cupon.')],
      requestBody: body(ref('UpdateCouponRequest'), { example: { discountPercent: 15, isActive: true } }),
      responses: { 200: json('Cupon actualizado.', envelope(ref('Coupon'), { meta: true })), ...errors(400, 401, 403, 404, 409, 422) },
    }),
  },
  '/admin/coupons/{id}/deactivate': {
    patch: operation({
      tags: [TAGS.ADMIN_COUPONS],
      summary: 'Desactivar un cupon',
      description: `Marca el cupon como inactivo (borrado logico). No lleva cuerpo.\n\n${access([P.COUPONS_MANAGE], { scope: 'admin' })}`,
      parameters: [id('Id del cupon.')],
      responses: { 200: json('Cupon desactivado.', envelope(ref('Coupon'), { meta: true })), ...errors(400, 401, 403, 404) },
    }),
  },

  // ===================================================== Admin: inventario ====
  '/admin/inventory/losses': {
    get: operation({
      tags: [TAGS.ADMIN_INVENTORY],
      summary: 'Listar mermas',
      description: `Mermas de inventario por vencimiento o dano.\n\n${access([P.INVENTORY_MANAGE], { scope: 'admin' })}`,
      parameters: [
        ...PAGINATION,
        queryId('productId', 'Filtra por producto.'),
        query('reason', { type: 'string', enum: [...ALL_LOSS_REASONS] }, 'Motivo de la merma.'),
        queryDate('from', 'Desde (ISO 8601); no puede ser posterior a `to`.'),
        queryDate('to', 'Hasta (ISO 8601; una fecha sin hora abarca el dia completo).'),
      ],
      responses: { 200: json('Pagina de mermas.', paged('InventoryLoss')), ...errors(400, 401, 403) },
    }),
    post: operation({
      tags: [TAGS.ADMIN_INVENTORY],
      summary: 'Registrar una merma',
      description: `Descuenta stock y registra la perdida valorada al costo del producto. La respuesta incluye en \`meta\` el stock previo y el nuevo. Responde 409 si no hay stock suficiente.\n\n${access([P.INVENTORY_MANAGE], { scope: 'admin' })}`,
      requestBody: body(ref('RecordLossRequest'), { example: { productId: EXAMPLE_ID, quantity: 2, reason: 'damaged', notes: 'Danado en bodega' } }),
      responses: {
        201: json(
          'Merma registrada.',
          {
            type: 'object',
            required: ['data', 'meta'],
            properties: {
              data: ref('InventoryLoss'),
              meta: { type: 'object', properties: { previousStock: { type: 'integer', example: 12 }, newStock: { type: 'integer', example: 10 } } },
            },
          },
        ),
        ...errors(400, 401, 403, 404),
        409: { $ref: '#/components/responses/ConflictStock' },
        ...errors(422),
      },
    }),
  },
  '/admin/inventory': {
    get: operation({
      tags: [TAGS.ADMIN_INVENTORY],
      summary: 'Listar existencias',
      description: `Productos con stock, costo, precio de venta y proveedor (filtros dinamicos).\n\n${access([P.INVENTORY_MANAGE], { scope: 'admin' })}`,
      parameters: [
        ...PAGINATION,
        queryText('productName', 100, 'Nombre del producto (busqueda parcial).'),
        queryId('supplierId', 'Filtra por proveedor.'),
        queryText('category', 80, 'Categoria.'),
        queryMoney('minPrice', 'Precio minimo; no puede superar `maxPrice`'),
        queryMoney('maxPrice', 'Precio maximo'),
        queryDate('createdFrom', 'Alta desde; no puede ser posterior a `createdTo`.'),
        queryDate('createdTo', 'Alta hasta.'),
        queryBool('isActive', 'Filtra por estado.'),
        query('sort', { type: 'string', enum: [...INVENTORY_SORT_KEYS] }, 'Orden del resultado.'),
      ],
      responses: { 200: json('Pagina de productos en inventario.', paged('InventoryProduct')), ...errors(400, 401, 403) },
    }),
  },
  '/admin/inventory/{id}': {
    get: operation({
      tags: [TAGS.ADMIN_INVENTORY],
      summary: 'Detalle de producto en inventario',
      description: `Producto con su descripcion y los datos de su proveedor.\n\n${access([P.INVENTORY_MANAGE], { scope: 'admin' })}`,
      parameters: [id('Id del producto.')],
      responses: { 200: json('Producto.', envelope(ref('InventoryProductDetail'), { meta: true })), ...errors(400, 401, 403, 404) },
    }),
  },

  // ======================================================= Admin: compras ====
  '/admin/purchases': {
    post: operation({
      tags: [TAGS.ADMIN_PURCHASES],
      summary: 'Registrar una compra a proveedor',
      description: `Ingresa mercaderia: aumenta el stock, actualiza el costo de los productos y genera una factura de proveedor. \`unitCost\` va en quetzales; sin productos repetidos. Responde 409 si el proveedor esta inactivo (\`SUPPLIER_INACTIVE\`) y 422 si algun producto no existe o la fecha es futura.\n\n${access([P.INVENTORY_MANAGE], { scope: 'admin' })}`,
      requestBody: body(ref('CreatePurchaseRequest'), {
        example: {
          supplierId: EXAMPLE_ID_2,
          paymentMethod: 'bank_transfer',
          supplierInvoiceNumber: 'FAC-0042',
          notes: 'Reposicion mensual',
          items: [{ productId: EXAMPLE_ID, quantity: 20, unitCost: 250 }],
        },
      }),
      responses: { 201: { ...json('Compra registrada.', envelope(ref('Purchase'), { meta: true })), headers: LOCATION_HEADER }, ...errors(400, 401, 403, 404, 409, 422) },
    }),
    get: operation({
      tags: [TAGS.ADMIN_PURCHASES],
      summary: 'Listar compras',
      description: access([P.INVENTORY_MANAGE], { scope: 'admin' }),
      parameters: [
        ...PAGINATION,
        queryId('supplierId', 'Filtra por proveedor.'),
        queryDate('from', 'Desde (ISO 8601); no puede ser posterior a `to`.'),
        queryDate('to', 'Hasta (ISO 8601; una fecha sin hora abarca el dia completo).'),
      ],
      responses: { 200: json('Pagina de compras.', paged('Purchase')), ...errors(400, 401, 403) },
    }),
  },
  '/admin/purchases/{id}': {
    get: operation({
      tags: [TAGS.ADMIN_PURCHASES],
      summary: 'Detalle de compra',
      description: `Compra con su factura de proveedor.\n\n${access([P.INVENTORY_MANAGE], { scope: 'admin' })}`,
      parameters: [id('Id de la compra.')],
      responses: { 200: json('Compra.', envelope(ref('Purchase'), { meta: true })), ...errors(400, 401, 403, 404) },
    }),
  },

  // ==================================================== Admin: proveedores ====
  '/admin/suppliers': {
    post: operation({
      tags: [TAGS.ADMIN_SUPPLIERS],
      summary: 'Crear proveedor',
      description: `Crea un proveedor; el \`supplierCode\` (p. ej. \`PRV-000001\`) lo asigna el sistema. NIT unico (409 \`SUPPLIER_NIT_IN_USE\`).\n\n${access([P.SUPPLIERS_MANAGE], { scope: 'admin' })}`,
      requestBody: body(ref('CreateSupplierRequest'), {
        example: {
          name: 'Distribuidora Central S.A.',
          nit: '1234567-8',
          address: '3a Calle 5-10, Zona 4',
          phone: '+502 2222-3333',
          email: 'ventas@distribuidora.com',
          contactName: 'Carlos Mendez',
          distributionDescription: 'Distribuye equipo de computo en todo el pais',
          catalog: [{ productId: EXAMPLE_ID, cost: 250 }],
        },
      }),
      responses: {
        201: { ...json('Proveedor creado.', envelope(ref('Supplier'), { meta: true }), { example: { data: SUPPLIER_EXAMPLE, meta: {} } }), headers: LOCATION_HEADER },
        ...errors(400, 401, 403, 409, 422),
      },
    }),
    get: operation({
      tags: [TAGS.ADMIN_SUPPLIERS],
      summary: 'Listar proveedores',
      description: access([P.SUPPLIERS_MANAGE], { scope: 'admin' }),
      parameters: [
        ...PAGINATION,
        query('supplierCode', { type: 'string', minLength: 1, maxLength: 20, example: 'PRV-0001' }, 'Codigo o prefijo del codigo (p. ej. `PRV-0001`).'),
        queryText('name', 100, 'Nombre (busqueda parcial).'),
        queryText('address', 100, 'Direccion (busqueda parcial).'),
        queryBool('isActive', 'Filtra por estado.'),
      ],
      responses: { 200: json('Pagina de proveedores.', paged('Supplier')), ...errors(400, 401, 403) },
    }),
  },
  '/admin/suppliers/{id}': {
    get: operation({
      tags: [TAGS.ADMIN_SUPPLIERS],
      summary: 'Detalle de proveedor',
      description: `Proveedor con el catalogo enriquecido con datos del producto.\n\n${access([P.SUPPLIERS_MANAGE], { scope: 'admin' })}`,
      parameters: [id('Id del proveedor.')],
      responses: { 200: json('Proveedor.', envelope(ref('SupplierDetail'), { meta: true })), ...errors(400, 401, 403, 404) },
    }),
    patch: operation({
      tags: [TAGS.ADMIN_SUPPLIERS],
      summary: 'Editar proveedor',
      description: `Edicion parcial (al menos un campo). \`catalog\` reemplaza el catalogo actual.\n\n${access([P.SUPPLIERS_MANAGE], { scope: 'admin' })}`,
      parameters: [id('Id del proveedor.')],
      requestBody: body(ref('UpdateSupplierRequest'), { example: { phone: '+502 2222-4444', isActive: true } }),
      responses: { 200: json('Proveedor actualizado.', envelope(ref('Supplier'), { meta: true })), ...errors(400, 401, 403, 404, 409, 422) },
    }),
    delete: operation({
      tags: [TAGS.ADMIN_SUPPLIERS],
      summary: 'Borrado fisico de proveedor',
      description: `Elimina fisicamente al proveedor. Reservado al superusuario (el servicio lo comprueba de nuevo: \`403 HARD_DELETE_FORBIDDEN\`). Responde 409 si tiene compras registradas (\`SUPPLIER_HAS_PURCHASES\`); en ese caso conviene desactivarlo. Para la purga controlada con comprobaciones fiscales vease \`DELETE /superuser/purge/suppliers/{id}\`.\n\n${access([P.SUPPLIERS_MANAGE, P.RECORDS_HARD_DELETE], { scope: 'admin' })}`,
      parameters: [id('Id del proveedor.')],
      responses: { 204: { description: 'Proveedor eliminado.' }, ...errors(400, 401, 403, 404, 409) },
    }),
  },
  '/admin/suppliers/{id}/deactivate': {
    patch: operation({
      tags: [TAGS.ADMIN_SUPPLIERS],
      summary: 'Desactivar proveedor',
      description: `Borrado logico. No lleva cuerpo.\n\n${access([P.SUPPLIERS_MANAGE], { scope: 'admin' })}`,
      parameters: [id('Id del proveedor.')],
      responses: { 200: json('Proveedor desactivado.', envelope(ref('Supplier'), { meta: true })), ...errors(400, 401, 403, 404) },
    }),
  },

  // ====================================================== Admin: clientes ====
  '/admin/customers': {
    get: operation({
      tags: [TAGS.ADMIN_CUSTOMERS],
      summary: 'Directorio de clientes',
      description: `Cuentas con rol \`user\` con metricas (gasto total, articulos comprados, metodo de pago preferido). Por defecto solo cuentas activas, salvo \`isActive\` o \`includeInactive\`.\n\n${access([P.CUSTOMERS_MANAGE], { scope: 'admin' })}`,
      parameters: [
        ...PAGINATION,
        queryText('userCode', 40, 'Codigo de cliente.'),
        queryText('name', 100, 'Nombre (busqueda parcial).'),
        queryText('email', 254, 'Correo (busqueda parcial).'),
        query('phone', { type: 'string', minLength: 1, maxLength: 20, pattern: '^\\+?[0-9\\s-]+$' }, 'Telefono.'),
        queryBool('isActive', 'Filtra por estado explicito.'),
        queryBool('includeInactive', 'Incluye cuentas desactivadas (por defecto `false`).'),
        query('preferredPaymentMethod', { type: 'string', enum: [...ALL_PAYMENT_METHODS] }, 'Metodo de pago preferido.'),
        queryMoney('minTotalSpent', 'Gasto total minimo; no puede superar `maxTotalSpent`'),
        queryMoney('maxTotalSpent', 'Gasto total maximo'),
        query('minPurchasedItems', { type: 'integer', minimum: 0, maximum: 10000000 }, 'Articulos comprados minimos.'),
      ],
      responses: { 200: json('Pagina de clientes.', paged('Customer')), ...errors(400, 401, 403) },
    }),
  },
  '/admin/customers/{id}': {
    get: operation({
      tags: [TAGS.ADMIN_CUSTOMERS],
      summary: 'Detalle de cliente',
      description: access([P.CUSTOMERS_MANAGE], { scope: 'admin' }),
      parameters: [id('Id del cliente.')],
      responses: { 200: json('Cliente.', envelope(ref('Customer'), { meta: true })), ...errors(400, 401, 403, 404) },
    }),
    patch: operation({
      tags: [TAGS.ADMIN_CUSTOMERS],
      summary: 'Editar cliente',
      description: `Edita nombre, apellido, telefono o codigo de cliente (sin correo, rol ni estado). Solo cuentas con rol \`user\` (\`403 NOT_A_CUSTOMER\`).\n\n${access([P.CUSTOMERS_MANAGE], { scope: 'admin' })}`,
      parameters: [id('Id del cliente.')],
      requestBody: body(ref('UpdateCustomerRequest'), { example: { phone: '+502 5555-0000', userCode: 'CLI-0001' } }),
      responses: { 200: json('Cliente actualizado.', envelope(ref('CustomerAccount'), { meta: true })), ...errors(400, 401, 403, 404, 409) },
    }),
    delete: operation({
      tags: [TAGS.ADMIN_CUSTOMERS],
      summary: 'Borrado fisico de cliente',
      description: `Elimina fisicamente la cuenta del cliente. Reservado al superusuario (\`403 HARD_DELETE_FORBIDDEN\` para admin). Solo gestiona cuentas con rol \`user\` (\`403 NOT_A_CUSTOMER\`). Para la purga controlada con comprobaciones fiscales vease \`DELETE /superuser/purge/users/{id}\`.\n\n${access([P.CUSTOMERS_MANAGE, P.RECORDS_HARD_DELETE], { scope: 'admin' })}`,
      parameters: [id('Id del cliente.')],
      responses: { 204: { description: 'Cliente eliminado.' }, ...errors(400, 401, 403, 404) },
    }),
  },
  '/admin/customers/{id}/deactivate': {
    patch: operation({
      tags: [TAGS.ADMIN_CUSTOMERS],
      summary: 'Desactivar cliente',
      description: `Desactiva la cuenta del cliente y revoca sus sesiones. No lleva cuerpo.\n\n${access([P.CUSTOMERS_MANAGE], { scope: 'admin' })}`,
      parameters: [id('Id del cliente.')],
      responses: { 200: json('Cliente desactivado.', envelope(ref('CustomerAccount'), { meta: true })), ...errors(400, 401, 403, 404) },
    }),
  },

  // ======================================================= Admin: facturas ====
  '/admin/invoices': {
    get: operation({
      tags: [TAGS.ADMIN_INVOICES],
      summary: 'Listar facturas (ventas y compras)',
      description: `Facturas de clientes y de proveedores con filtros. Los textos son busquedas parciales.\n\n${access([P.INVOICES_MANAGE], { scope: 'admin' })}`,
      parameters: [
        ...PAGINATION,
        query('nit', { type: 'string', minLength: 1, maxLength: 40, pattern: '^[A-Za-z0-9-]+$' }, 'NIT.'),
        queryText('entityName', 160, 'Nombre del cliente o proveedor.'),
        query('paymentMethod', { type: 'string', enum: [...ALL_PAYMENT_METHODS] }, 'Metodo de pago.'),
        queryText('shippingAddress', 200, 'Direccion de envio (busqueda parcial).'),
        queryText('email', 254, 'Correo.'),
        query('entityType', { type: 'string', enum: [...ALL_INVOICE_ENTITY_TYPES] }, 'Tipo de entidad: `cliente` (venta) o `proveedor` (compra).'),
        query('status', { type: 'string', enum: [...ALL_INVOICE_STATUSES] }, 'Estado de la factura.'),
        ...rangeParams(),
      ],
      responses: { 200: json('Pagina de facturas.', paged('AdminInvoiceSummary')), ...errors(400, 401, 403) },
    }),
  },
  '/admin/invoices/{id}': {
    get: operation({
      tags: [TAGS.ADMIN_INVOICES],
      summary: 'Detalle de factura',
      description: `Factura con el desglose de productos y totales.\n\n${access([P.INVOICES_MANAGE], { scope: 'admin' })}`,
      parameters: [id('Id de la factura.')],
      responses: { 200: json('Factura.', envelope(ref('AdminInvoiceDetail'), { meta: true })), ...errors(400, 401, 403, 404) },
    }),
  },

  // ======================================================= Admin: reportes ====
  '/admin/reports/general': {
    get: operation({
      tags: [TAGS.ADMIN_REPORTS],
      summary: 'Reporte general',
      description: `Ventas, medios de pago, cupones, productos mas vendidos, mermas y estado del inventario. Los importes salen en quetzales.\n\n${access([P.REPORTS_READ], { scope: 'admin' })}`,
      parameters: [
        ...rangeParams(),
        queryText('category', 80, 'Filtra por categoria.'),
        queryText('productName', 100, 'Filtra por nombre de producto.'),
        query('lowStockThreshold', { type: 'integer', minimum: 0, maximum: 100000, default: 5 }, 'Umbral de stock bajo (por defecto 5).'),
        query('topLimit', { type: 'integer', minimum: 1, maximum: 50, default: 10 }, 'Cantidad de productos en el ranking (por defecto 10).'),
      ],
      responses: { 200: json('Reporte general.', envelope(ref('GeneralReport'), { meta: true })), ...errors(400, 401, 403) },
    }),
  },
  '/admin/reports/products/{id}/supplier-performance': {
    get: operation({
      tags: [TAGS.ADMIN_REPORTS],
      summary: 'Desempeno del proveedor de un producto',
      description: `Ventas, devoluciones, mermas y margen del producto con una recomendacion sobre su proveedor (\`continuar\`, \`evaluar\`, \`cambiar_proveedor\`).\n\n${access([P.REPORTS_READ], { scope: 'admin' })}`,
      parameters: [id('Id del producto.'), ...rangeParams()],
      responses: { 200: json('Desempeno del proveedor.', envelope(ref('SupplierPerformance'), { meta: true })), ...errors(400, 401, 403, 404) },
    }),
  },

  // ================================================== Superusuario ============
  '/superuser/staff': {
    get: operation({
      tags: [TAGS.SUPERUSER],
      summary: 'Listar personal',
      description: `Cuentas de personal (\`admin\` y \`superuser\`), sin datos sensibles.\n\n${access([P.ADMINS_MANAGE], { scope: 'superuser' })}`,
      parameters: [
        ...PAGINATION,
        query('role', { type: 'string', enum: [...STAFF_ROLES] }, 'Filtra por rol de personal.'),
        queryBool('isActive', 'Filtra por estado.'),
        queryText('search', 100, 'Busqueda por nombre o correo.'),
      ],
      responses: { 200: json('Pagina de personal.', paged('User')), ...errors(400, 401, 403) },
    }),
    post: operation({
      tags: [TAGS.SUPERUSER],
      summary: 'Crear personal',
      description: `Alta de un \`admin\` o \`superuser\`.\n\n${access([P.ADMINS_MANAGE], { scope: 'superuser' })}`,
      requestBody: body(ref('CreateStaffRequest'), {
        example: { email: 'marta.lopez@example.com', password: 'Secreta123', firstName: 'Marta', lastName: 'Lopez', role: 'admin' },
      }),
      responses: { 201: { ...json('Personal creado.', envelope(ref('User')), { example: { data: { ...USER_EXAMPLE, role: 'admin' } } }), headers: LOCATION_HEADER }, ...errors(400, 401, 403, 409) },
    }),
  },
  '/superuser/staff/{id}/role': {
    patch: operation({
      tags: [TAGS.SUPERUSER],
      summary: 'Cambiar el rol de personal',
      description: `Cambia el rol a cualquier rol valido (por ejemplo degradar a \`user\`) y revoca las sesiones. No puede degradarse a si mismo (\`409 SELF_LOCKOUT\`) ni dejar el sistema sin superusuarios activos (\`409 LAST_SUPERUSER\`).\n\n${access([P.ADMINS_MANAGE], { scope: 'superuser' })}`,
      parameters: [id('Id de la cuenta.')],
      requestBody: body(ref('ChangeRoleRequest'), { example: { role: 'user' } }),
      responses: { 200: json('Rol actualizado.', envelope(ref('User'))), ...errors(400, 401, 403, 404, 409) },
    }),
  },
  '/superuser/staff/{id}/status': {
    patch: operation({
      tags: [TAGS.SUPERUSER],
      summary: 'Activar o desactivar personal',
      description: `Cambia \`isActive\`; desactivar revoca las sesiones. No puede desactivarse a si mismo (\`409 SELF_LOCKOUT\`) ni dejar el sistema sin superusuarios activos (\`409 LAST_SUPERUSER\`).\n\n${access([P.ADMINS_MANAGE], { scope: 'superuser' })}`,
      parameters: [id('Id de la cuenta.')],
      requestBody: body(ref('ChangeStatusRequest'), { example: { isActive: false } }),
      responses: { 200: json('Estado actualizado.', envelope(ref('User'))), ...errors(400, 401, 403, 404, 409) },
    }),
  },
  '/superuser/settings': {
    get: operation({
      tags: [TAGS.SUPERUSER],
      summary: 'Ver la configuracion global',
      description: `Configuracion completa de la tienda (o los valores por defecto si aun no existe).\n\n${access([P.SETTINGS_MANAGE], { scope: 'superuser' })}`,
      responses: {
        200: json('Configuracion.', envelope(ref('Settings')), {
          example: {
            data: {
              defaultTaxRate: 0.12,
              companyBankAccounts: [{ bankName: 'Banco Industrial', accountNumber: '123-456789-0', accountHolder: 'Mi Empresa S.A.', accountType: 'monetaria', isActive: true }],
              maintenanceMode: false,
              updatedAt: '2026-11-13T13:00:00.000Z',
              updatedBy: EXAMPLE_ID,
            },
          },
        }),
        ...errors(401, 403),
      },
    }),
    patch: operation({
      tags: [TAGS.SUPERUSER],
      summary: 'Actualizar la configuracion global',
      description: `Actualiza \`defaultTaxRate\`, \`companyBankAccounts\` (REEMPLAZA la lista) y/o \`maintenanceMode\` (con \`true\` el checkout responde 503). Al menos un campo.\n\n${access([P.SETTINGS_MANAGE], { scope: 'superuser' })}`,
      requestBody: body(ref('UpdateSettingsRequest'), {
        example: {
          defaultTaxRate: 0.12,
          maintenanceMode: false,
          companyBankAccounts: [{ bankName: 'Banco Industrial', accountNumber: '123-456789-0', accountHolder: 'Mi Empresa S.A.', accountType: 'monetaria', isActive: true }],
        },
      }),
      responses: { 200: json('Configuracion actualizada.', envelope(ref('Settings'))), ...errors(400, 401, 403) },
    }),
  },
  '/superuser/audit-logs': {
    get: operation({
      tags: [TAGS.SUPERUSER],
      summary: 'Bitacora de auditoria del superusuario',
      description: `Consulta de \`audit_logs\` con estado previo/nuevo e instantanea. Solo lectura: no existe ninguna ruta que modifique o borre la bitacora. Una \`endDate\` sin hora abarca el dia completo.\n\n${access([P.AUDIT_READ], { scope: 'superuser' })}`,
      parameters: [
        param('Page'),
        query('limit', { type: 'integer', minimum: 1, maximum: AUDIT_LOG_MAX_LIMIT, default: 20 }, `Elementos por pagina (por defecto 20, maximo ${AUDIT_LOG_MAX_LIMIT}).`),
        queryId('actorId', 'Id del autor de la accion.'),
        query('role', { type: 'string', enum: [...ALL_ROLES] }, 'Rol del autor al momento de la accion.'),
        query('action', { type: 'string', maxLength: 80, pattern: '^[a-z_]+\\.[a-z_]+$', example: 'record.purged' }, 'Accion (formato `entidad.accion`).'),
        query('targetCollection', { type: 'string', enum: Object.values(COLLECTIONS) }, 'Coleccion afectada.'),
        query('startDate', { allOf: [ref('IsoDate')] }, 'Inicio del rango (ISO 8601); debe ser anterior o igual a `endDate`.'),
        query('endDate', { allOf: [ref('IsoDate')] }, 'Fin del rango (ISO 8601).'),
      ],
      responses: { 200: json('Pagina de registros de auditoria.', paged('SuperuserAuditLog')), ...errors(400, 401, 403) },
    }),
  },
  '/superuser/purge/{collection}/{id}': {
    delete: operation({
      tags: [TAGS.SUPERUSER],
      summary: 'Purga (borrado fisico controlado)',
      description: `Elimina fisicamente un registro de la lista blanca de colecciones. El registro debe estar desactivado (\`400 NOT_SOFT_DELETED\`) y sin documentos fiscales que lo referencien (\`409 FISCAL_INTEGRITY_LOCK\`); no se puede purgar la propia cuenta (\`409 SELF_PURGE\`). Se audita como \`record.purged\` con una instantanea redactada.\n\n${access([P.RECORDS_HARD_DELETE], { scope: 'superuser' })}`,
      parameters: [
        { name: 'collection', in: 'path', required: true, description: 'Coleccion de la lista blanca.', schema: { type: 'string', enum: [...ALL_PURGEABLE_COLLECTIONS] } },
        id('Id del registro.'),
      ],
      responses: {
        200: json('Registro purgado.', envelope(ref('PurgeResult')), {
          example: { data: { collection: 'products', id: EXAMPLE_ID, purged: true, auditLogId: EXAMPLE_ID_2 } },
        }),
        ...errors(400, 401, 403, 404, 409),
      },
    }),
  },
};
