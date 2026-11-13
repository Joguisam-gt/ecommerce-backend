# E-commerce Backend - Fase 1

Arquitectura base, base de datos, autenticacion RBAC y gestion de usuarios.

**Stack:** Node.js 22+ (ESM), Express 5, driver nativo de MongoDB (sin Mongoose), bcrypt,
jsonwebtoken, cookie-parser, cors. Pruebas con el runner nativo `node:test` y `fetch` nativo.

## Puesta en marcha

```bash
cp .env.example .env              # completa los secretos JWT
npm install
npm run db:init                   # colecciones, $jsonSchema e indices (idempotente)
npm run db:seed-superuser         # primer superusuario (SUPERUSER_EMAIL / SUPERUSER_PASSWORD)
npm run dev                       # http://localhost:3000/api/v1
npm test                          # pruebas unitarias e integracion HTTP (no requieren MongoDB)
```

Requiere MongoDB 6.0 o superior (indices parciales con `$in`).

## Estructura

```
src/
  config/        env.js (configuracion validada e inmutable), database.js (Singleton MongoClient)
  constants/     roles.js, permissions.js (matriz RBAC)
  database/      collections.js, setup.js (sincroniza validadores e indices), schemas/ (7 colecciones)
  routes/        definicion de endpoints y permiso requerido por ruta
  middlewares/   authenticate, authorize, validate, sanitize-input, security-headers, error-handler
  validators/    motor de validacion declarativo y esquemas de entrada
  dtos/          normalizacion de entrada y forma de salida (lista blanca)
  controllers/   adaptan HTTP <-> servicios, sin reglas de negocio
  services/      reglas de negocio: auth, usuarios, auditoria, tokens, contrasenas, politica de acceso
  repositories/  unico acceso al driver de MongoDB
  utils/         HttpError, ObjectId, logger, cookies, contexto de peticion
  container.js   raiz de composicion (inyeccion de dependencias)
  app.js         construccion de Express (sin abrir puertos)
  server.js      arranque y apagado ordenado
scripts/         init-db.js, seed-superuser.js
tests/           unit/, integration/, helpers/ (repositorios en memoria)
```

Flujo de una peticion: `route -> authenticate -> authorize(permiso) -> validate -> controller (DTO) -> service -> repository`.

## RBAC

| Capacidad                               | superuser | admin           | user |
|-----------------------------------------|-----------|-----------------|------|
| Perfil propio, carrito, POS, catalogo   | si        | si              | si   |
| Listar y ver usuarios                   | si        | si              | no   |
| Crear / editar / desactivar usuarios    | si        | solo clientes   | no   |
| Cambiar roles, gestionar admins         | si        | no              | no   |
| Borrado fisico                          | si        | no              | no   |
| Leer audit_logs                         | si        | no              | no   |
| Configuracion global                    | si        | no              | no   |

Reglas adicionales (en `services/user-access.policy.js` y `UserService`): nadie modifica su propio
rol o estado ni se borra a si mismo, y siempre debe quedar al menos un superusuario activo.

`PATCH /users/:id/role` y `PATCH /users/:id/status` aplican esas reglas dentro de la transaccion
de `StaffService` (centinela `superuser_governance_lock`, ver Fase 4): la regla del ultimo
superusuario (409 `LAST_SUPERUSER`) ya no es vulnerable a *write skew*. Codigos y respuestas no
cambian; la auditoria (`user.role_changed` / `user.status_changed`) se escribe en la misma
transaccion y su `metadata` pasa a `{ before, after, sessionsRevoked }` (antes `{ from, to }` /
`{ isActive }`).

**Cambio de comportamiento de `DELETE /users/:id`** (sigue siendo solo superusuario y responde 204):
delega en la purga de la Fase 4 (`PurgeService.purge(actor, 'users', id)`), igual que
`DELETE /api/superuser/purge/users/:id`. Ahora exige desactivar antes la cuenta
(`PATCH /users/:id/status` con `isActive: false`; si sigue activa, 400 `NOT_SOFT_DELETED`),
responde 409 `FISCAL_INTEGRITY_LOCK` si tiene pedidos o facturas, borra su carrito en cascada y
audita `record.purged` con la instantanea redactada (antes `user.deleted`), todo en una
transaccion. Cuenta inexistente: 404 `USER_NOT_FOUND`; borrarse a si mismo: 403
`SELF_MODIFICATION_FORBIDDEN` (sin cambios).

## Endpoints (`/api/v1`)

| Metodo | Ruta                 | Acceso                 |
|--------|----------------------|------------------------|
| GET    | /health              | publico                |
| POST   | /auth/register       | publico (crea `user`)  |
| POST   | /auth/login          | publico                |
| POST   | /auth/refresh        | cookie refresh_token   |
| POST   | /auth/logout         | autenticado            |
| PATCH  | /auth/password       | autenticado            |
| GET    | /users/me            | profile:read           |
| PATCH  | /users/me            | profile:update         |
| GET    | /users               | users:read             |
| POST   | /users               | users:create           |
| GET    | /users/:id           | users:read             |
| PATCH  | /users/:id           | users:update           |
| PATCH  | /users/:id/status    | users:deactivate       |
| PATCH  | /users/:id/role      | admins:manage          |
| DELETE | /users/:id           | users:delete           |
| GET    | /audit-logs          | audit:read             |

Errores con formato uniforme: `{ "error": { "code", "message", "details?" } }`.

## Decisiones de seguridad

- Access token (15 min) y refresh token (7 dias) en cookies `httpOnly` + `SameSite=Strict`; el refresh
  solo viaja a `/api/v1/auth`. Tambien se acepta `Authorization: Bearer` para POS o apps nativas.
- JWT con algoritmo fijado (HS256), secretos distintos por tipo, `issuer`/`audience` verificados.
- Revocacion por `tokenVersion`: logout, cambio de contrasena, cambio de rol y desactivacion
  invalidan todas las sesiones. `authenticate` lee el rol actual de la base de datos, no del token.
- bcrypt coste 12; politica de contrasena con limite de 72 bytes; comparacion ficticia para
  igualar tiempos cuando el correo no existe.
- Bloqueo temporal tras 5 intentos fallidos (configurable).
- Validacion con lista blanca de campos (bloquea asignacion masiva) y rechazo de claves `$`/`.`
  (bloquea inyeccion de operadores NoSQL). `$jsonSchema` estricto como ultima barrera.
- Importes en centavos enteros para evitar errores de coma flotante.
- `audit_logs` es append-only a nivel de aplicacion.

## Pendiente para fases siguientes

- Endpoints de configuracion global (`settings:manage` ya existe en la matriz).
- Rate limiting por IP (el bloqueo por cuenta no frena ataques distribuidos entre muchas cuentas).
- Politica de retencion (indice TTL) para `audit_logs`.
- Productos, cupones, carrito, POS, pedidos, facturas y proveedores.

## Fase 3: panel de administrador

Todas las rutas viven en `/api/v1/admin` (alias `/api/admin`). `routes/admin.routes.js` aplica
`authenticate` (JWT) + `requireRoles(admin, superuser)` a todo el panel, y cada modulo exige ademas su
permiso con `authorize()`. Toda mutacion se registra en `audit_logs` con `AuditService.recordChange`
(`actorId`, `role`, `action`, `targetCollection`, `targetId`, `previousState`, `newState`, `timestamp`)
despues del commit. Composicion en `src/admin.container.js`.

| Modulo | Endpoints | Permiso |
|---|---|---|
| Conciliacion | `GET /orders/pending-verification`, `PATCH /orders/:id/reconcile` (`approve` / `reject` + `reason`) | `orders:manage` |
| Cupones | `GET /coupons/applicable-products`, `GET/POST /coupons`, `GET/PATCH /coupons/:id`, `PATCH /coupons/:id/deactivate` | `coupons:manage` |
| Inventario | `GET /inventory`, `GET /inventory/:id`, `GET/POST /inventory/losses` | `inventory:manage` |
| Compras | `GET/POST /purchases`, `GET /purchases/:id` | `inventory:manage` |
| Proveedores | `GET/POST /suppliers`, `GET/PATCH/DELETE /suppliers/:id`, `PATCH /suppliers/:id/deactivate` | `suppliers:manage` (+ `records:hard_delete` para DELETE) |
| Clientes | `GET /customers`, `GET/PATCH/DELETE /customers/:id`, `PATCH /customers/:id/deactivate` | `customers:manage` (+ `records:hard_delete` para DELETE) |
| Facturacion | `GET /invoices`, `GET /invoices/:id` (ventas y compras, filtro `entityType`) | `invoices:manage` |
| Reportes | `GET /reports/general`, `GET /reports/products/:id/supplier-performance` | `reports:read` |

Transacciones ACID (requieren replica set):
- **Rechazo de transferencia:** pedido `rejected` + `$inc` del stock de cada linea + factura `voided` + uso de cupon liberado.
- **Compra a proveedor:** `$inc` de stock y nuevo `costCents` por producto + documento en `purchases` + factura `entityType: "proveedor"`.
- **Merma:** descuento condicional de stock (`stock >= cantidad`) + registro en `inventory_losses` con el costo congelado.

Colecciones nuevas: `purchases`, `inventory_losses`. Cambios de esquema: `invoices.entityType`
(`cliente` | `proveedor`), `suppliers` (`supplierCode`, `nit`, `distributionDescription`, `catalog`),
`users.userCode` y los campos de cambio en `audit_logs`. Ejecuta `npm run db:init` tras actualizar.

## Fase 4: Modulo de Superusuario

Modulo exclusivo del rol `superuser` (contrato: superusuario = `ROLES.SUPERUSER`, administrador =
`ROLES.ADMIN`). Vive en `/api/superuser` (alias `/api/v1/superuser`). `routes/superuser.routes.js`
aplica a nivel de router `authenticate` + `requireSuperuser` (`middlewares/require-superuser.js`,
basado en `requireRoles(ROLES.SUPERUSER)`): sin sesion 401, cualquier otro rol (incluido `admin`)
403 `FORBIDDEN`, siempre antes de validar el cuerpo. Cada sub-router exige ademas su permiso fino.
Composicion en `src/superuser.container.js` (`buildSuperuserModule`).

| Metodo | Ruta | Permiso fino | Descripcion |
|---|---|---|---|
| GET | `/api/superuser/staff` | `admins:manage` | Personal (`admin`/`superuser`); `page`, `limit`, `role`, `isActive`, `search`. Sin `passwordHash` |
| POST | `/api/superuser/staff` | `admins:manage` | Alta de `admin` o `superuser` (`email`, `password`, `firstName`, `lastName`, `phone?`, `role`) |
| PATCH | `/api/superuser/staff/:id/role` | `admins:manage` | `{ role }` (cualquier rol); revoca sesiones (`tokenVersion + 1`) |
| PATCH | `/api/superuser/staff/:id/status` | `admins:manage` | `{ isActive }`; desactivar revoca sesiones |
| GET | `/api/superuser/settings` | `settings:manage` | Configuracion global (o valores por defecto) |
| PATCH | `/api/superuser/settings` | `settings:manage` | `defaultTaxRate`, `companyBankAccounts` (reemplaza la lista), `maintenanceMode` |
| GET | `/api/superuser/audit-logs` | `audit:read` | Bitacora: `page`, `limit` (max 100), `actorId`, `role`, `action`, `targetCollection`, `startDate`, `endDate` |
| DELETE | `/api/superuser/purge/:collection/:id` | `records:hard_delete` | Borrado fisico de `users`, `products`, `suppliers` o `coupons` |
| GET | `/api/store/config/public` | publico | `{ data: { defaultTaxRate, companyBankAccounts } }` solo cuentas activas, sin `isActive`; `Cache-Control: public, max-age=60` |

La ruta antigua `GET /api/v1/audit-logs` (Fase 1) sigue intacta. No existe ninguna ruta ni metodo
de repositorio que actualice o borre `audit_logs`.

### Reglas de negocio

**Anti-bloqueo de superusuarios** (`services/staff.service.js`). Si el objetivo es un superusuario
activo y la operacion lo degrada o lo desactiva: si el actor es el propio objetivo, 409
`SELF_LOCKOUT`; si no queda al menos otro superusuario activo, 409 `LAST_SUPERUSER`. Cada cambio de
rol o estado corre en una transaccion que escribe primero en el documento centinela
`counters/_id: "superuser_governance_lock"` (`$inc` con upsert, compatible con el `$jsonSchema` de
`counters`). Dos degradaciones simultaneas chocan en ese documento: MongoDB aborta una con
`WriteConflict` y `withTransaction` la reintenta con un recuento fresco (evita el *write skew*).
Lectura, recuento, actualizacion y auditoria (con `before`/`after` en `metadata`) comparten la
transaccion. Verificado contra MongoDB 8.0: sin el centinela, 20 de 20 rondas de degradacion mutua
dejaban el sistema sin superusuarios; con el centinela, 0 de 20.
Las rutas de la Fase 1 `PATCH /api/v1/users/:id/role` y `/status` reutilizan esta misma ruta
transaccional (`changeRole`/`changeStatus` con la opcion `authorize`, evaluada sobre la lectura
fresca del objetivo dentro de la transaccion), y `DELETE /api/v1/users/:id` delega en la purga.

**Purga** (`services/purge.service.js`, una sola transaccion con `{ session }` en cada operacion):
1. `findOne` por `_id` (404 `RECORD_NOT_FOUND`); un usuario no puede purgarse a si mismo (409 `SELF_PURGE`).
2. Solo registros con borrado logico previo: `isActive !== false` responde 400 `NOT_SOFT_DELETED`.
3. Bloqueo fiscal (409 `FISCAL_INTEGRITY_LOCK`, `details.references` con los conteos):
   - `users`: `orders.userId` e `invoices.userId`.
   - `products`: `orders.items.productId`, `invoices.items.productId` (venta y compra) y `purchases.items.productId`.
   - `suppliers`: `purchases.supplierId` y facturas de proveedor (`invoices.supplierId`, documentos
     fiscales de compra de la Fase 3), mas `orders`/`invoices` con `items.productId` de sus productos.
     Si el proveedor aun tiene productos (`products.supplierId`), 409 `SUPPLIER_HAS_PRODUCTS`.
   - `coupons`: sin bloqueo (cada pedido conserva su copia del cupon aplicado).
4. Cascada de referencias no fiscales: carrito del usuario; entrada del producto en `suppliers.catalog`.
5. `deleteOne` (condicionado a `isActive: false`) y auditoria `record.purged` con `snapshot` del
   documento sin `passwordHash`, `tokenVersion`, `failedLoginAttempts` ni `lockUntil`. Si la auditoria
   falla, la transaccion se revierte y no hay borrado.

Respuesta: `200 { data: { collection, id, purged: true, auditLogId } }`. La lista blanca esta en
`constants/superuser.js`; `PurgeRepository` la traduce a colecciones resueltas en su constructor y
nunca usa el parametro de la URL como nombre de coleccion.

**Configuracion global** (`system_settings`, documento unico `_id: "global_config"`, `$jsonSchema`
estricto): `defaultTaxRate` (fraccion 0..1, por defecto 0.12), `companyBankAccounts` (max 20;
`bankName` en `G&T`, `Banco Industrial`, `Banrural`, `BAC`; `accountNumber` de digitos y guiones,
5-30; `accountHolder` 3-120; `accountType` `monetaria`/`ahorro`; `isActive`), `maintenanceMode`,
`updatedAt`, `updatedBy`. El PATCH valida en la aplicacion y en el `$jsonSchema`, rechaza cuentas
repetidas (mismo banco y numero, ignorando guiones) y hace upsert con `$setOnInsert` de los valores
por defecto que no van en `$set`. Cada cambio se audita (`settings.updated`, `targetCollection:
"system_settings"`) en la misma transaccion. `npm run db:init` crea el documento por defecto si no existe.

**Auditoria** (`AuditService`): todas las entradas llevan `timestamp` (= `createdAt`) y
`targetCollection` (explicito o derivado de `entity`; `null` si no se conoce). `recordInTransaction`
inserta con la sesion y propaga los errores; `record` y `recordChange` mantienen su comportamiento.
Nuevas acciones: `staff.created`, `staff.role_changed`, `staff.status_changed`, `settings.updated`,
`record.purged`. Nuevos indices: `ix_audit_collection_timestamp` (`targetCollection`, `timestamp`) y
`ix_audit_timestamp`. El nombre `ix_audit_target_timestamp` ya lo usa el indice de la Fase 3
(`targetCollection`, `targetId`, `timestamp`) y se conserva. Tras el `collMod`, `db:init` rellena
`timestamp` con `createdAt` en las entradas antiguas que no lo tienen, para que el filtro por fechas
las incluya.

### Codigos de error

| HTTP | Codigo | Cuando |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Cuerpo, query o parametros invalidos (coleccion fuera de la lista blanca, tasa > 1, banco no admitido, `startDate > endDate`, cuerpo vacio) |
| 400 | `NOT_SOFT_DELETED` | Purga de un registro activo |
| 401 | `AUTH_REQUIRED` / `SESSION_REVOKED` | Sin sesion o sesion revocada |
| 403 | `FORBIDDEN` | Rol distinto de `superuser` |
| 404 | `USER_NOT_FOUND` / `RECORD_NOT_FOUND` | Cuenta o registro inexistente |
| 409 | `SELF_LOCKOUT` | Un superusuario intenta degradarse o desactivarse |
| 409 | `LAST_SUPERUSER` | La operacion dejaria el sistema sin superusuarios activos |
| 409 | `EMAIL_IN_USE` | Correo ya registrado |
| 409 | `FISCAL_INTEGRITY_LOCK` | Documentos fiscales referencian el registro |
| 409 | `SUPPLIER_HAS_PRODUCTS` | El proveedor aun tiene productos asociados |
| 409 | `SELF_PURGE` | El superusuario intenta purgar su propia cuenta |
| 503 | `MAINTENANCE_MODE` | Checkout del POS con `maintenanceMode: true` |

### Integracion de `maintenanceMode` e IVA

- `createMaintenanceGuard({ settingsService })` (`middlewares/maintenance-guard.js`) responde 503
  `MAINTENANCE_MODE` si `maintenanceMode` es `true`. Ya esta montado en `POST /api/pos/checkout`
  (despues de `authenticate` y `authorize`, antes de `pciGuard`); `createPosRoutes` lo recibe como
  dependencia opcional, asi que sin el la ruta queda igual que en la Fase 2. Para proteger otra ruta,
  anade `container.middlewares.maintenanceGuard` a su cadena de middlewares.
- El calculo de impuestos del checkout NO cambia: sigue usando `taxRatePercent` (0-100) de cada
  producto (`CartPricingService`, `product.taxRatePercent ?? 0`). `defaultTaxRate` es una fraccion
  (0.12 = 12 %). Integraciones posibles, sin tocar los pedidos ya emitidos: (a) usar
  `Math.round(defaultTaxRate * 100 * 100) / 100` como `taxRatePercent` por defecto al crear productos;
  (b) inyectar `settingsService` en `CartPricingService` y usarlo como respaldo cuando un producto no
  tenga `taxRatePercent`. Los pedidos y facturas guardan la tasa congelada, por lo que un cambio de
  IVA solo afecta a compras futuras.

### Pruebas

`tests/unit/superuser-*.test.js` y `tests/integration/superuser-rbac.http.test.js` usan dobles en
memoria (`tests/helpers/superuser-fakes.js`, con `FakeTransactionRunner` que revierte y reintenta
como `withTransaction`). `tests/integration/superuser.mongo.test.js` se ejecuta contra un replica set
real si se define `MONGODB_TEST_URI` (write skew concurrente, `$jsonSchema`, purga atomica e indices).
Tras actualizar, ejecuta `npm run db:init`.
