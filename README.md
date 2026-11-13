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
