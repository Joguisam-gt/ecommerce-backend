/**
 * Especificacion OpenAPI 3.0.3 de la API (Ecommerce Backend).
 *
 * Es un objeto JavaScript plano y congelado, sin dependencias: se sirve tal cual
 * en GET /api/v1/docs/openapi.json para que Swagger UI (u otro cliente) lo cargue
 * y permita probar las rutas con "Try it out". El codigo es la fuente de verdad:
 * los esquemas de entrada salen de src/validators, los de salida de src/dtos y los
 * permisos de la matriz RBAC (src/constants/permissions.js). La prueba
 * tests/unit/openapi.test.js verifica que todas las rutas registradas esten documentadas.
 *
 * Organizacion: openapi.helpers.js (ayudas), openapi.schemas.js (components) y
 * openapi.paths.js (rutas).
 */
import { deepFreeze } from './openapi.helpers.js';
import { TAGS, paths } from './openapi.paths.js';
import { parameters, responses, schemas, securitySchemes } from './openapi.schemas.js';

/** Descripcion general (en espanol, sin tildes como el resto del proyecto). */
const DESCRIPTION = [
  'API REST del backend de e-commerce: autenticacion con RBAC, tienda, carrito, punto de venta (checkout), facturacion, panel de administracion y modulo exclusivo de superusuario.',
  '',
  '## Autenticacion',
  '1. Llama a `POST /auth/login` y copia `data.accessToken`.',
  '2. Pulsa **Authorize** y pega el token en `bearerAuth` (se envia como `Authorization: Bearer <token>`).',
  '',
  'El login tambien fija cookies httpOnly (`access_token`, que se acepta en lugar del Bearer, y `refresh_token`). La cookie de refresco **solo viaja a `/api/v1/auth`**, por lo que el refresco (`POST /auth/refresh`) debe usar esa ruta.',
  '',
  '## Roles y permisos',
  'Hay tres roles: `superuser`, `admin` y `user` (cliente). Cada operacion indica el permiso RBAC que exige. Las rutas `/admin/*` exigen ademas rol `admin` o `superuser`; las `/superuser/*`, rol `superuser` estricto.',
  '',
  '## Formato de respuestas',
  '- Exito: `{ "data": ... }`. Las listas paginadas anaden `meta` (`total`, `page`, `limit`, `totalPages`); los modulos administrativos devuelven `meta: {}` en recursos individuales.',
  '- Error: `{ "error": { "code", "message", "details"? } }` (esquema `Error`). Excepcion: el 409 por stock insuficiente usa `{ "error": "INSUFFICIENT_STOCK", "availableStock", "productId", "message" }`.',
  '- Importes: decimales en quetzales (GTQ), por ejemplo `finalPrice: 499` o `49.99`.',
  '- Los cuerpos de entrada rechazan campos no declarados (400 `VALIDATION_ERROR`).',
  '',
  '## Rutas base',
  'La ruta canonica es `/api/v1`; `/api` es un alias equivalente.',
].join('\n');

/** Descripcion de cada tag. */
const TAG_DESCRIPTIONS = {
  [TAGS.HEALTH]: 'Estado del servicio y documentacion.',
  [TAGS.AUTH]: 'Registro, inicio y cierre de sesion, refresco y cambio de contrasena.',
  [TAGS.USERS]: 'Perfil propio y gestion de usuarios (RBAC por permiso y rango).',
  [TAGS.AUDIT]: 'Bitacora de auditoria (Fase 1, solo superusuario).',
  [TAGS.STORE]: 'Catalogo publico y configuracion publica de la tienda.',
  [TAGS.CART]: 'Carrito del usuario autenticado (cart:manage).',
  [TAGS.POS]: 'Checkout del punto de venta: contra entrega, tarjeta tokenizada y transferencia.',
  [TAGS.INVOICES]: 'Facturas del usuario autenticado.',
  [TAGS.ADMIN_ORDERS]: 'Panel admin: conciliacion de transferencias bancarias.',
  [TAGS.ADMIN_COUPONS]: 'Panel admin: cupones y productos aplicables.',
  [TAGS.ADMIN_INVENTORY]: 'Panel admin: existencias y mermas.',
  [TAGS.ADMIN_PURCHASES]: 'Panel admin: compras a proveedores.',
  [TAGS.ADMIN_SUPPLIERS]: 'Panel admin: proveedores y su catalogo.',
  [TAGS.ADMIN_CUSTOMERS]: 'Panel admin: directorio de clientes con metricas.',
  [TAGS.ADMIN_INVOICES]: 'Panel admin: facturas de ventas y compras.',
  [TAGS.ADMIN_REPORTS]: 'Panel admin: reportes analiticos.',
  [TAGS.SUPERUSER]: 'Modulo exclusivo de superusuario: personal, configuracion global, bitacora y purga.',
};

/** Especificacion OpenAPI completa (inmutable). */
export const openApiSpec = deepFreeze({
  openapi: '3.0.3',
  info: {
    title: 'Ecommerce Backend API',
    version: '0.1.0',
    description: DESCRIPTION,
  },
  servers: [{ url: 'http://localhost:3000/api/v1', description: 'Desarrollo local (ruta canonica /api/v1)' }],
  tags: Object.values(TAGS).map((name) => ({ name, description: TAG_DESCRIPTIONS[name] })),
  'x-tagGroups': [
    { name: 'General', tags: [TAGS.HEALTH, TAGS.AUTH, TAGS.USERS, TAGS.AUDIT] },
    { name: 'Tienda', tags: [TAGS.STORE, TAGS.CART, TAGS.POS, TAGS.INVOICES] },
    {
      name: 'Admin',
      tags: [
        TAGS.ADMIN_ORDERS,
        TAGS.ADMIN_COUPONS,
        TAGS.ADMIN_INVENTORY,
        TAGS.ADMIN_PURCHASES,
        TAGS.ADMIN_SUPPLIERS,
        TAGS.ADMIN_CUSTOMERS,
        TAGS.ADMIN_INVOICES,
        TAGS.ADMIN_REPORTS,
      ],
    },
    { name: 'Superusuario', tags: [TAGS.SUPERUSER] },
  ],
  paths,
  components: { securitySchemes, parameters, responses, schemas },
});
