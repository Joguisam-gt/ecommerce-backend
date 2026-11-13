# E-commerce Backend

API REST de un comercio electronico (catalogo, carrito, checkout tipo POS, facturacion, panel de administracion y modulo de superusuario) con autenticacion JWT, control de acceso por roles (RBAC) y MongoDB. Fue desarrollada como proyecto academico para ser consumida por la aplicacion web/movil del repositorio `ecommerce-frontend`.

> **Repositorios del proyecto**
>
> | Parte | Repositorio | En local (Docker) |
> |---|---|---|
> | Backend (este) | [Joguisam-gt/ecommerce-backend](https://github.com/Joguisam-gt/ecommerce-backend) | API: <http://localhost:3000/api/v1> |
> | Frontend | [Joguisam-gt/ecommerce-frontend](https://github.com/Joguisam-gt/ecommerce-frontend) | Tienda y panel: <http://localhost:8081> |
> | Documentacion de la API | Swagger UI ([seccion](#documentacion-interactiva-swagger)) | <http://localhost:8082> |

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

---

## Tecnologias utilizadas

Este proyecto fue desarrollado utilizando las siguientes tecnologias:

- *Lenguaje principal:* JavaScript (modulos ESM) sobre Node.js 22 o superior
- *Framework:* Express 5
- *Base de datos:* MongoDB 6.0 o superior (replica set, necesario para transacciones), con el driver nativo `mongodb` (sin Mongoose)
- *Seguridad:* `bcrypt` (hash de contrasenas), `jsonwebtoken` (JWT), `cookie-parser`, `cors`
- *Pruebas:* runner nativo `node:test` y `fetch` nativo
- *Control de versiones:* Git y GitHub
- *Otras herramientas:* Docker (imagen `node:22-slim`)

---

# Como montar el proyecto

## Requisitos previos

Antes de instalar el proyecto, asegurate de tener instaladas las siguientes herramientas:

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) version 22 o superior (`engines.node >= 22.0.0`)
- [MongoDB](https://www.mongodb.com/) 6.0 o superior, ejecutandose como replica set (ver seccion 5), o Docker para la alternativa de la seccion 6
- Un editor de codigo, por ejemplo Visual Studio Code

Puedes comprobar las versiones instaladas con los siguientes comandos:

```bash
git --version
node --version
npm --version
```

## 1. Clonar el repositorio

```bash
git clone https://github.com/Joguisam-gt/ecommerce-backend.git
```

## 2. Entrar a la carpeta del proyecto

```bash
cd ecommerce-backend
```

## 3. Instalar las dependencias

```bash
npm install
```

## 4. Configurar las variables de entorno

Crea un archivo llamado `.env` en la raiz del proyecto tomando como referencia `.env.example`:

```bash
cp .env.example .env
```

Variables disponibles (valores de ejemplo de `.env.example`):

```env
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
# Numero de proxies de confianza delante de la app (0 si no hay ninguno)
TRUST_PROXY=0

# MongoDB 6.0 o superior
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=ecommerce
MONGODB_MAX_POOL_SIZE=20
DB_SYNC_ON_START=true

# Genera cada secreto con: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_ACCESS_SECRET=cambia-esto-por-un-secreto-aleatorio-de-al-menos-32-caracteres
JWT_REFRESH_SECRET=cambia-esto-por-otro-secreto-distinto-de-al-menos-32-caracteres
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=604800
JWT_ISSUER=ecommerce-backend
JWT_AUDIENCE=ecommerce-clients

BCRYPT_SALT_ROUNDS=12

# Origenes del frontend separados por coma
CORS_ORIGINS=http://localhost:5173

# strict | lax | none (none exige COOKIE_SECURE=true)
COOKIE_SAME_SITE=strict
COOKIE_SECURE=false
COOKIE_DOMAIN=

MAX_LOGIN_ATTEMPTS=5
LOCK_TIME_MINUTES=15

# Solo para npm run db:seed-superuser
SUPERUSER_EMAIL=root@example.com
SUPERUSER_PASSWORD=CambiaEsto123
SUPERUSER_FIRST_NAME=Super
SUPERUSER_LAST_NAME=Usuario
```

> No compartas contrasenas, tokens ni claves privadas en GitHub. El archivo `.env` esta en `.gitignore`; cambia los secretos JWT y las credenciales del superusuario por valores propios.

## 5. Configurar la base de datos

El backend necesita **MongoDB 6.0 o superior** (los indices parciales con `$in` lo requieren) ejecutandose como **replica set**, incluso de un solo nodo, porque la compra, la conciliacion de transferencias, las mermas, la purga y los cambios de rol usan transacciones ACID.

Para un MongoDB local, inicia `mongod` con `--replSet rs0` y ejecuta una sola vez `rs.initiate()` en `mongosh`; despues usa en `.env`:

```env
MONGODB_URI=mongodb://localhost:27017/?replicaSet=rs0
```

Con la base de datos disponible ejecuta:

```bash
npm run db:init              # colecciones, $jsonSchema e indices (idempotente)
npm run db:seed-superuser    # primer superusuario (SUPERUSER_EMAIL / SUPERUSER_PASSWORD)
npm run db:seed-catalog      # opcional: 8 productos y 3 cupones de ejemplo (idempotente)
```

`npm run db:init` sincroniza validadores `$jsonSchema` e indices, crea el documento de configuracion global por defecto si no existe y rellena `timestamp` en las entradas antiguas de `audit_logs`. Tambien se ejecuta al arrancar el servidor si `DB_SYNC_ON_START=true`. Ejecutalo de nuevo tras actualizar el codigo.

## 6. Ejecutar el proyecto

Para iniciar el entorno de desarrollo (recarga automatica):

```bash
npm run dev
```

Para iniciar el proyecto en modo produccion:

```bash
npm start
```

La API estara disponible en:

```text
http://localhost:3000/api/v1
```

Comprobacion rapida: `GET http://localhost:3000/api/v1/health`.

### Alternativa: Docker

El repositorio incluye un `Dockerfile` (imagen `node:22-slim`, usuario `node`, `NODE_ENV=production`, puerto 3000 y `HEALTHCHECK` contra `/api/v1/health`) y un `.dockerignore` (excluye `node_modules`, `.env`, `.git`, `tests` y `coverage`). Solo copia `src/` y `scripts/` a la imagen.

El archivo `docker-compose.yml` **no esta dentro de este repositorio**: vive en la carpeta padre que contiene los repositorios `ecommerce-backend` y `ecommerce-frontend` (junto a un `.env` con `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SUPERUSER_EMAIL` y `SUPERUSER_PASSWORD`), y levanta cuatro servicios:

| Servicio | Imagen / origen | Puerto | Notas |
|---|---|---|---|
| `mongo` | `mongo:8.0` | `127.0.0.1:27017` | Replica set de un nodo `rs0` (necesario para transacciones), volumen `mongo-data`, healthcheck que ejecuta `rs.initiate` |
| `backend` | `Dockerfile` de este repositorio | 3000 | `MONGODB_URI=mongodb://mongo:27017/?replicaSet=rs0`, `CORS_ORIGINS=http://localhost:8081,http://localhost:8082` |
| `frontend` | nginx con la app web exportada | 8081 | Repositorio [`ecommerce-frontend`](https://github.com/Joguisam-gt/ecommerce-frontend) |
| `docs` | `swaggerapi/swagger-ui:v5.17.14` | 8082 | Documentacion interactiva; lee `http://localhost:3000/api/v1/docs/openapi.json` |

Desde la carpeta que contiene el `docker-compose.yml`:

```bash
docker compose up -d --build
docker compose exec backend node scripts/seed-superuser.js
docker compose exec backend node scripts/seed-catalog.js   # 8 productos y 3 cupones
```

Dentro del contenedor los scripts se invocan con `node` directamente (no hay archivo `.env` en la imagen; las variables las inyecta el compose).

> **Importante:** con Docker la API usa el MongoDB del contenedor `mongo`, no el `MONGODB_URI` del `.env` de este repositorio. Si ejecutas `npm run db:*` en tu equipo, los datos van a la base del `.env` (por ejemplo Atlas), no a la de Docker. Para la base de Docker usa siempre `docker compose exec backend node scripts/<script>.js`.

Una vez arriba:

| Que | URL |
|---|---|
| Tienda y panel (frontend) | <http://localhost:8081> |
| API | <http://localhost:3000/api/v1> (salud: `/health`) |
| Swagger UI | <http://localhost:8082> |
| Especificacion OpenAPI | <http://localhost:3000/api/v1/docs/openapi.json> |

## 7. Iniciar sesion y hacer una compra

### Cuentas de prueba

| Rol | Como obtenerla |
|---|---|
| Superusuario | Correo y contrasena de `SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD`. Con Docker son los del `.env` de la carpeta padre (consultalos con `docker compose exec backend printenv SUPERUSER_EMAIL SUPERUSER_PASSWORD`); sin Docker, los del `.env` de este repositorio. Se crea con `seed-superuser` (no hace nada si ya existe uno). |
| Administrador | Lo crea el superusuario desde Gobernanza (frontend) o con `POST /superuser/staff`. |
| Cliente | Registro publico: todo alta por `POST /auth/register` es rol `user`. El frontend no tiene pantalla de registro; usa el comando de abajo o Swagger. |

Crear un cliente de prueba (la contrasena necesita 8 caracteres o mas, mayuscula, minuscula y numero):

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"cliente.prueba@test.com","password":"Cliente1234","firstName":"Cliente","lastName":"Prueba"}'
```

### Desde el navegador (recomendado)

1. Abre <http://localhost:8081> e inicia sesion con el cliente.
2. **Ir a la tienda** -> elige un producto -> **Agregar al Carrito** -> **Ir al carrito**.
3. **Proceder al pago**, elige el metodo y pulsa **Confirmar pedido**:
   - *Contra entrega:* nombre, correo, telefono y direccion obligatorios. Pedido `confirmed`, factura `pending_payment`.
   - *Tarjeta:* se tokeniza en el cliente (pasarela simulada; nunca viaja el numero ni el CVV). Pedido y factura `paid`.
   - *Transferencia:* datos del comprobante. Pedido `pending_verification` hasta que un admin lo apruebe en **Resumen y conciliacion**.
4. Cierra sesion, entra como superusuario o admin y abre **Panel Admin -> Resumen y conciliacion** (o **Reportes**): la venta aparece en ventas totales, pedidos, ticket promedio, unidades vendidas y desglose por metodo de pago.

> Las metricas solo cuentan pedidos `confirmed`, `paid`, `processing`, `shipped` y `delivered`. Una transferencia no suma hasta aprobarla.

### Desde la terminal (curl)

```bash
API=http://localhost:3000/api/v1

# 1. Login (guarda las cookies de sesion)
curl -s -c cookies.txt -X POST $API/auth/login -H "Content-Type: application/json" \
  -d '{"email":"cliente.prueba@test.com","password":"Cliente1234"}'

# 2. Catalogo publico: copia el "id" de un producto
curl -s "$API/store/products?limit=5"

# 3. Carrito (opcional: cupon BIENVENIDA10)
curl -s -b cookies.txt -X POST $API/cart/items -H "Content-Type: application/json" \
  -d '{"productId":"<ID_DEL_PRODUCTO>","quantity":1}'
curl -s -b cookies.txt -X POST $API/cart/coupon -H "Content-Type: application/json" -d '{"code":"BIENVENIDA10"}'

# 4. Checkout con tarjeta tokenizada
curl -s -b cookies.txt -X POST $API/pos/checkout \
  -H "Content-Type: application/json" -H "Idempotency-Key: compra-0001" \
  -d '{"paymentMethod":"card","nit":"CF",
       "shippingAddress":{"line1":"5a avenida 10-20","city":"Guatemala","country":"GT"},
       "payment":{"paymentToken":"tok_prueba12345","last4":"4242","cardHolderName":"Cliente Prueba","cardBrand":"Visa"}}'

# 5. Facturas del cliente
curl -s -b cookies.txt $API/invoices
```

En lugar de cookies puedes usar el `data.accessToken` del login como `Authorization: Bearer <token>` (caduca a los 15 minutos por defecto).

### Solucion de problemas

| Sintoma | Causa y solucion |
|---|---|
| En la web: "No hay conexion con el servidor" al confirmar el pedido | El preflight CORS rechazo una cabecera. `app.js` debe permitir `Idempotency-Key` en `allowedHeaders` y el origen debe estar en `CORS_ORIGINS`. Reconstruye el backend: `docker compose up -d --build backend`. |
| `INVALID_CREDENTIALS` con el superusuario | La contrasena no es la de la base que usa la API (Docker vs `.env` local) o el superusuario aun no existe: ejecuta `seed-superuser` en el contenedor. |
| `SHIPPING_ADDRESS_REQUIRED` | Hay productos sin retiro en tienda (`pickupAvailable: false`): envia `shippingAddress`. |
| `INSUFFICIENT_STOCK` | No hay unidades suficientes (los audifonos del catalogo de ejemplo tienen 1). |
| El checkout rechaza el metodo de pago | Cada producto acepta solo algunos metodos (`acceptedPaymentMethods`). |
| `503 MAINTENANCE_MODE` | El superusuario activo el modo mantenimiento en la configuracion global. |
| `CORS_REJECTED` | El origen del navegador no esta en `CORS_ORIGINS` (curl y Postman no envian `Origin`). |

---

# Estructura del proyecto

```text
ecommerce-backend/
├── Dockerfile                 # Imagen de la API (node:22-slim)
├── .dockerignore
├── .env.example               # Ejemplo de variables de entorno
├── .gitignore
├── package.json               # Dependencias y scripts
├── scripts/
│   ├── init-db.js             # Colecciones, $jsonSchema, indices y configuracion por defecto
│   ├── seed-superuser.js      # Primer superusuario
│   └── seed-catalog.js        # Productos y cupones de ejemplo
├── src/
│   ├── server.js              # Arranque y apagado ordenado
│   ├── app.js                 # Construccion de Express (sin abrir puertos)
│   ├── container.js           # Raiz de composicion (inyeccion de dependencias)
│   ├── admin.container.js     # Composicion del panel de administracion
│   ├── superuser.container.js # Composicion del modulo de superusuario
│   ├── config/                # env.js (configuracion validada e inmutable), database.js (Singleton MongoClient)
│   ├── constants/             # roles, permissions (matriz RBAC), commerce, settings, superuser
│   ├── database/              # collections.js, setup.js, transaction-runner.js, schemas/ ($jsonSchema e indices)
│   ├── docs/                  # openapi.js: especificacion OpenAPI 3 (servida en /api/v1/docs/openapi.json)
│   ├── routes/                # Definicion de endpoints y permiso requerido por ruta
│   ├── middlewares/           # authenticate, authorize, require-superuser, validate, validate-checkout,
│   │                          # sanitize-input, security-headers, pci-guard, maintenance-guard, error-handler
│   ├── validators/            # Motor de validacion declarativo y esquemas de entrada
│   ├── dtos/                  # Normalizacion de entrada y forma de salida (lista blanca)
│   ├── controllers/           # Adaptan HTTP <-> servicios, sin reglas de negocio
│   ├── services/              # Reglas de negocio (auth, usuarios, carrito, checkout, compras, purga, ...)
│   │   ├── payments/          # Pasarela de pago
│   │   └── pricing/           # Calculo de precios y politica de cupones
│   ├── repositories/          # Unico acceso al driver de MongoDB
│   │   └── pipelines/         # Pipelines de agregacion (clientes, reportes)
│   └── utils/                 # HttpError, ObjectId, logger, cookies, contexto de peticion, dinero, fechas
├── tests/
│   ├── unit/                  # Pruebas unitarias
│   ├── integration/           # Pruebas HTTP y pruebas contra MongoDB real
│   └── helpers/               # Repositorios en memoria y fixtures
└── README.md
```

## Descripcion de carpetas importantes

| Carpeta | Descripcion |
|---|---|
| `src/routes/` | Rutas y permiso exigido por cada una. |
| `src/middlewares/` | Autenticacion, autorizacion, validacion, sanitizacion, cabeceras de seguridad, guardas PCI y de mantenimiento, manejo de errores. |
| `src/validators/` | Esquemas declarativos de validacion con lista blanca de campos. |
| `src/dtos/` | Normalizacion de entrada y forma de salida (nunca se devuelven documentos crudos). |
| `src/controllers/` | Traducen HTTP a llamadas de servicio. |
| `src/services/` | Reglas de negocio. |
| `src/repositories/` | Unico lugar que habla con MongoDB. |
| `src/database/schemas/` | Un archivo por coleccion: `$jsonSchema` estricto e indices. |
| `scripts/` | Inicializacion de la base de datos y datos semilla. |
| `tests/` | Pruebas unitarias y de integracion (dobles en memoria; MongoDB real opcional). |

Flujo de una peticion: `route -> authenticate -> authorize(permiso) -> validate -> controller (DTO) -> service -> repository`.

---

# Documentacion del proyecto

## Descripcion general

Backend de un comercio electronico que cubre el ciclo completo: registro e inicio de sesion de clientes, catalogo publico, carrito, checkout (contra entrega, tarjeta tokenizada y transferencia bancaria), pedidos y facturas, un panel de administracion (conciliacion de transferencias, cupones, inventario, compras a proveedores, clientes, facturacion y reportes) y un modulo exclusivo de superusuario (personal, configuracion global, auditoria y purga fiscalmente segura). Fue desarrollado en fases: Fase 1 (arquitectura, base de datos, autenticacion RBAC y usuarios), Fase 2 (tienda, carrito, POS y facturas), Fase 3 (panel de administrador) y Fase 4 (superusuario).

## Objetivo general

Proveer una API segura, transaccional y auditable que soporte la operacion de una tienda en linea con tres niveles de privilegio (cliente, administrador y superusuario).

## Objetivos especificos

- Implementar autenticacion con JWT y revocacion de sesiones, con permisos por rol definidos en una unica matriz RBAC.
- Garantizar la integridad de inventario, pedidos y facturas mediante transacciones ACID en MongoDB.
- Registrar en una bitacora (`audit_logs`) toda mutacion administrativa y de gobierno.
- Proteger los datos con validacion de lista blanca, `$jsonSchema` estricto y manejo de importes en centavos enteros.
- Evitar que el sistema quede sin superusuarios y que se borren registros con documentos fiscales asociados.

## Funcionalidades

El sistema permite realizar las siguientes acciones:

- Registro, inicio de sesion, refresco y cierre de sesion; cambio de contrasena; gestion del perfil propio.
- Consulta publica del catalogo con filtros, busqueda, ordenamiento y paginacion, y de la configuracion publica (IVA por defecto y cuentas bancarias de la empresa).
- Carrito por usuario con cupones, y checkout con contra entrega, tarjeta (solo token de pasarela, cumpliendo PCI-DSS) o transferencia bancaria, con clave de idempotencia.
- Pedidos y facturas de cliente; historial de facturas.
- Panel de administracion: conciliacion de transferencias, cupones, inventario y mermas, compras a proveedores, proveedores, clientes, facturacion de ventas y compras, y reportes.
- Modulo de superusuario: alta y gobierno del personal, configuracion global (IVA, cuentas bancarias, modo mantenimiento), consulta de la bitacora de auditoria y purga de registros.
- Gestion de usuarios segun rol (listar, crear, editar, desactivar, cambiar rol, borrado fisico).

## Usuarios del sistema

| Tipo de usuario | Permisos |
|---|---|
| Superusuario (`superuser`) | Todos los permisos: gestiona administradores y personal, configuracion global, bitacora de auditoria y borrado fisico (purga). |
| Administrador (`admin`) | Operacion diaria: usuarios (lectura, alta, edicion y desactivacion solo de clientes), productos, cupones, pedidos, facturas, proveedores, inventario, clientes y reportes. Sin borrado fisico, sin configuracion global y sin bitacora. |
| Usuario (`user`, cliente) | Perfil propio, catalogo, carrito, POS (checkout) y sus pedidos y facturas. |
| Invitado (sin sesion) | Solo rutas publicas: `/health`, registro, inicio de sesion, catalogo `/store/products` y `/store/config/public`. |

Matriz RBAC:

| Capacidad                               | superuser | admin           | user |
|-----------------------------------------|-----------|-----------------|------|
| Perfil propio, carrito, POS, catalogo   | si        | si              | si   |
| Listar y ver usuarios                   | si        | si              | no   |
| Crear / editar / desactivar usuarios    | si        | solo clientes   | no   |
| Cambiar roles, gestionar admins         | si        | no              | no   |
| Borrado fisico                          | si        | no              | no   |
| Leer audit_logs                         | si        | no              | no   |
| Configuracion global                    | si        | no              | no   |

Permisos finos (`src/constants/permissions.js`): `profile:read`, `profile:update`, `catalog:read`, `cart:manage`, `pos:use`, `orders:own` (cliente); `users:read`, `users:create`, `users:update`, `users:deactivate`, `products:manage`, `coupons:manage`, `orders:manage`, `invoices:manage`, `suppliers:manage`, `inventory:manage`, `customers:manage`, `reports:read` (ademas, `admin`); `users:delete`, `admins:manage`, `records:hard_delete`, `settings:manage`, `audit:read` (solo `superuser`).

Reglas adicionales (en `services/user-access.policy.js` y `UserService`): nadie modifica su propio rol o estado ni se borra a si mismo, y siempre debe quedar al menos un superusuario activo.

`PATCH /users/:id/role` y `PATCH /users/:id/status` aplican esas reglas dentro de la transaccion de `StaffService` (centinela `superuser_governance_lock`, ver "Modulo de superusuario"): la regla del ultimo superusuario (409 `LAST_SUPERUSER`) ya no es vulnerable a *write skew*. Codigos y respuestas no cambian; la auditoria (`user.role_changed` / `user.status_changed`) se escribe en la misma transaccion y su `metadata` pasa a `{ before, after, sessionsRevoked }` (antes `{ from, to }` / `{ isActive }`).

**Comportamiento de `DELETE /users/:id`** (solo superusuario, responde 204): delega en la purga (`PurgeService.purge(actor, 'users', id)`), igual que `DELETE /api/superuser/purge/users/:id`. Exige desactivar antes la cuenta (`PATCH /users/:id/status` con `isActive: false`; si sigue activa, 400 `NOT_SOFT_DELETED`), responde 409 `FISCAL_INTEGRITY_LOCK` si tiene pedidos o facturas, borra su carrito en cascada y audita `record.purged` con la instantanea redactada (antes `user.deleted`), todo en una transaccion. Cuenta inexistente: 404 `USER_NOT_FOUND`; borrarse a si mismo: 403 `SELF_MODIFICATION_FORBIDDEN`.

## Flujo principal

1. El cliente se registra (`POST /auth/register`) o inicia sesion (`POST /auth/login`); el servidor valida credenciales y entrega cookies `httpOnly` (y el access token en el cuerpo).
2. Consulta el catalogo publico (`GET /store/products`).
3. Agrega productos al carrito y, opcionalmente, aplica un cupon (`/cart`).
4. Ejecuta el checkout (`POST /pos/checkout`) con contra entrega, tarjeta tokenizada o transferencia; se crean el pedido y la factura en una transaccion.
5. Si pago por transferencia, el pedido queda en `pending_verification`; un administrador la aprueba o rechaza (`PATCH /admin/orders/:id/reconcile`). Al rechazar se restituye stock, se anula la factura y se libera el cupon.
6. El cliente consulta sus facturas (`GET /invoices`) y cierra sesion (`POST /auth/logout`, que revoca todas sus sesiones).

Estado inicial segun el metodo de pago: `cash_on_delivery` -> pedido `confirmed` y factura `pending_payment`; `card` -> pedido `paid` y factura `paid`; `bank_transfer` -> pedido `pending_verification` y factura `pending_payment`.

## Arquitectura

El proyecto es una API REST en capas con inyeccion de dependencias manual (`container.js`, `admin.container.js`, `superuser.container.js`):

- *Rutas y middlewares:* definen el permiso de cada endpoint (`authenticate`, `authorize`, `validate`, guardas de PCI y de mantenimiento).
- *Controladores y DTOs:* adaptan HTTP a servicios; los DTOs normalizan la entrada y dan forma a la salida mediante lista blanca.
- *Servicios:* reglas de negocio (autenticacion, precios, checkout, conciliacion, compras, purga, auditoria, configuracion).
- *Repositorios:* unico acceso al driver de MongoDB; las operaciones criticas usan `withTransaction` (replica set obligatorio).
- *Base de datos:* MongoDB con `$jsonSchema` estricto por coleccion como ultima barrera.
- *Comunicacion con el frontend:* API REST en JSON bajo `/api/v1` (alias `/api`), con CORS restringido a `CORS_ORIGINS`.

### Decisiones de seguridad

- Access token (15 min) y refresh token (7 dias) en cookies `httpOnly` + `SameSite=Strict`; el refresh solo viaja a `/api/v1/auth`. Tambien se acepta `Authorization: Bearer` para POS o apps nativas.
- JWT con algoritmo fijado (HS256), secretos distintos por tipo, `issuer`/`audience` verificados.
- Revocacion por `tokenVersion`: logout, cambio de contrasena, cambio de rol y desactivacion invalidan todas las sesiones. `authenticate` lee el rol actual de la base de datos, no del token.
- bcrypt coste 12; politica de contrasena con limite de 72 bytes; comparacion ficticia para igualar tiempos cuando el correo no existe.
- Bloqueo temporal tras 5 intentos fallidos (configurable con `MAX_LOGIN_ATTEMPTS` y `LOCK_TIME_MINUTES`).
- Validacion con lista blanca de campos (bloquea asignacion masiva) y rechazo de claves `$`/`.` (bloquea inyeccion de operadores NoSQL). `$jsonSchema` estricto como ultima barrera.
- Importes en centavos enteros para evitar errores de coma flotante.
- Tarjetas: solo se acepta token de pasarela, ultimos 4 digitos, titular y marca; `pci-guard` bloquea cualquier dato de tarjeta completo antes de validar.
- `audit_logs` es append-only a nivel de aplicacion: no existe ruta ni metodo de repositorio que lo actualice o borre.

### Panel de administrador (Fase 3)

Todas las rutas viven en `/api/v1/admin` (alias `/api/admin`). `routes/admin.routes.js` aplica `authenticate` (JWT) + `requireRoles(admin, superuser)` a todo el panel, y cada modulo exige ademas su permiso con `authorize()`. Toda mutacion se registra en `audit_logs` con `AuditService.recordChange` (`actorId`, `role`, `action`, `targetCollection`, `targetId`, `previousState`, `newState`, `timestamp`) despues del commit. Composicion en `src/admin.container.js`.

Transacciones ACID (requieren replica set):

- **Rechazo de transferencia:** pedido `rejected` + `$inc` del stock de cada linea + factura `voided` + uso de cupon liberado.
- **Compra a proveedor:** `$inc` de stock y nuevo `costCents` por producto + documento en `purchases` + factura `entityType: "proveedor"`.
- **Merma:** descuento condicional de stock (`stock >= cantidad`) + registro en `inventory_losses` con el costo congelado.

Cambios de esquema de esa fase: `invoices.entityType` (`cliente` | `proveedor`), `suppliers` (`supplierCode`, `nit`, `distributionDescription`, `catalog`), `users.userCode` y los campos de cambio en `audit_logs`. Ejecuta `npm run db:init` tras actualizar.

### Modulo de superusuario (Fase 4)

Modulo exclusivo del rol `superuser` (superusuario = `ROLES.SUPERUSER`, administrador = `ROLES.ADMIN`). Vive en `/api/superuser` (alias `/api/v1/superuser`). `routes/superuser.routes.js` aplica a nivel de router `authenticate` + `requireSuperuser` (`middlewares/require-superuser.js`, basado en `requireRoles(ROLES.SUPERUSER)`): sin sesion 401, cualquier otro rol (incluido `admin`) 403 `FORBIDDEN`, siempre antes de validar el cuerpo. Cada sub-router exige ademas su permiso fino. Composicion en `src/superuser.container.js` (`buildSuperuserModule`). La ruta antigua `GET /api/v1/audit-logs` (Fase 1) sigue intacta.

**Anti-bloqueo de superusuarios** (`services/staff.service.js`). Si el objetivo es un superusuario activo y la operacion lo degrada o lo desactiva: si el actor es el propio objetivo, 409 `SELF_LOCKOUT`; si no queda al menos otro superusuario activo, 409 `LAST_SUPERUSER`. Cada cambio de rol o estado corre en una transaccion que escribe primero en el documento centinela `counters/_id: "superuser_governance_lock"` (`$inc` con upsert, compatible con el `$jsonSchema` de `counters`). Dos degradaciones simultaneas chocan en ese documento: MongoDB aborta una con `WriteConflict` y `withTransaction` la reintenta con un recuento fresco (evita el *write skew*). Lectura, recuento, actualizacion y auditoria (con `before`/`after` en `metadata`) comparten la transaccion. Verificado contra MongoDB 8.0: sin el centinela, 20 de 20 rondas de degradacion mutua dejaban el sistema sin superusuarios; con el centinela, 0 de 20. Las rutas `PATCH /api/v1/users/:id/role` y `/status` reutilizan esta misma ruta transaccional (`changeRole`/`changeStatus` con la opcion `authorize`, evaluada sobre la lectura fresca del objetivo dentro de la transaccion), y `DELETE /api/v1/users/:id` delega en la purga.

**Purga** (`services/purge.service.js`, una sola transaccion con `{ session }` en cada operacion):

1. `findOne` por `_id` (404 `RECORD_NOT_FOUND`); un usuario no puede purgarse a si mismo (409 `SELF_PURGE`).
2. Solo registros con borrado logico previo: `isActive !== false` responde 400 `NOT_SOFT_DELETED`.
3. Bloqueo fiscal (409 `FISCAL_INTEGRITY_LOCK`, `details.references` con los conteos):
   - `users`: `orders.userId` e `invoices.userId`.
   - `products`: `orders.items.productId`, `invoices.items.productId` (venta y compra) y `purchases.items.productId`.
   - `suppliers`: `purchases.supplierId` y facturas de proveedor (`invoices.supplierId`, documentos fiscales de compra de la Fase 3), mas `orders`/`invoices` con `items.productId` de sus productos. Si el proveedor aun tiene productos (`products.supplierId`), 409 `SUPPLIER_HAS_PRODUCTS`.
   - `coupons`: sin bloqueo (cada pedido conserva su copia del cupon aplicado).
4. Cascada de referencias no fiscales: carrito del usuario; entrada del producto en `suppliers.catalog`.
5. `deleteOne` (condicionado a `isActive: false`) y auditoria `record.purged` con `snapshot` del documento sin `passwordHash`, `tokenVersion`, `failedLoginAttempts` ni `lockUntil`. Si la auditoria falla, la transaccion se revierte y no hay borrado.

Respuesta: `200 { data: { collection, id, purged: true, auditLogId } }`. La lista blanca esta en `constants/superuser.js`; `PurgeRepository` la traduce a colecciones resueltas en su constructor y nunca usa el parametro de la URL como nombre de coleccion.

**Configuracion global** (`system_settings`, documento unico `_id: "global_config"`, `$jsonSchema` estricto): `defaultTaxRate` (fraccion 0..1, por defecto 0.12), `companyBankAccounts` (max 20; `bankName` en `G&T`, `Banco Industrial`, `Banrural`, `BAC`; `accountNumber` de digitos y guiones, 5-30; `accountHolder` 3-120; `accountType` `monetaria`/`ahorro`; `isActive`), `maintenanceMode`, `updatedAt`, `updatedBy`. El PATCH valida en la aplicacion y en el `$jsonSchema`, rechaza cuentas repetidas (mismo banco y numero, ignorando guiones) y hace upsert con `$setOnInsert` de los valores por defecto que no van en `$set`. Cada cambio se audita (`settings.updated`, `targetCollection: "system_settings"`) en la misma transaccion. `npm run db:init` crea el documento por defecto si no existe.

**Auditoria** (`AuditService`): todas las entradas llevan `timestamp` (= `createdAt`) y `targetCollection` (explicito o derivado de `entity`; `null` si no se conoce). `recordInTransaction` inserta con la sesion y propaga los errores; `record` y `recordChange` mantienen su comportamiento. Acciones de la Fase 4: `staff.created`, `staff.role_changed`, `staff.status_changed`, `settings.updated`, `record.purged`. Indices: `ix_audit_collection_timestamp` (`targetCollection`, `timestamp`) y `ix_audit_timestamp`. El nombre `ix_audit_target_timestamp` ya lo usa el indice de la Fase 3 (`targetCollection`, `targetId`, `timestamp`) y se conserva. Tras el `collMod`, `db:init` rellena `timestamp` con `createdAt` en las entradas antiguas que no lo tienen, para que el filtro por fechas las incluya.

**Integracion de `maintenanceMode` e IVA**:

- `createMaintenanceGuard({ settingsService })` (`middlewares/maintenance-guard.js`) responde 503 `MAINTENANCE_MODE` si `maintenanceMode` es `true`. Ya esta montado en `POST /api/pos/checkout` (despues de `authenticate` y `authorize`, antes de `pciGuard`); `createPosRoutes` lo recibe como dependencia opcional, asi que sin el la ruta queda igual que en la Fase 2. Para proteger otra ruta, anade `container.middlewares.maintenanceGuard` a su cadena de middlewares.
- El calculo de impuestos del checkout NO cambia: sigue usando `taxRatePercent` (0-100) de cada producto (`CartPricingService`, `product.taxRatePercent ?? 0`). `defaultTaxRate` es una fraccion (0.12 = 12 %). Integraciones posibles, sin tocar los pedidos ya emitidos: (a) usar `Math.round(defaultTaxRate * 100 * 100) / 100` como `taxRatePercent` por defecto al crear productos; (b) inyectar `settingsService` en `CartPricingService` y usarlo como respaldo cuando un producto no tenga `taxRatePercent`. Los pedidos y facturas guardan la tasa congelada, por lo que un cambio de IVA solo afecta a compras futuras.

## Modelo de datos

Base de datos MongoDB (por defecto `ecommerce`). Cada coleccion tiene un `$jsonSchema` estricto (`additionalProperties: false`) en `src/database/schemas/`. Los importes `*Cents` son enteros (centavos). Todas las colecciones con `createdAt`/`updatedAt` los guardan como `date`.

Colecciones: `users`, `products`, `carts`, `orders`, `invoices`, `coupons`, `suppliers`, `purchases`, `inventory_losses`, `audit_logs`, `system_settings` y `counters`.

### Coleccion: `users`

| Campo | Tipo BSON | Descripcion |
|---|---|---|
| `_id` | objectId | Identificador unico. |
| `email` | string | Correo (indice unico `uq_users_email`). |
| `passwordHash` | string (60) | Hash bcrypt. |
| `firstName`, `lastName` | string (1-80) | Nombre y apellido. |
| `phone` | string / null | Telefono. |
| `userCode` | string / null | Codigo de usuario (indice unico parcial). |
| `role` | string | `superuser`, `admin` o `user`. |
| `isActive` | bool | Borrado logico. |
| `tokenVersion` | int | Version para revocar sesiones. |
| `failedLoginAttempts` | int | Intentos fallidos consecutivos. |
| `lockUntil`, `lastLoginAt` | date / null | Bloqueo temporal y ultimo acceso. |
| `createdAt`, `updatedAt` | date | Fechas de auditoria. |

### Coleccion: `products`

| Campo | Tipo BSON | Descripcion |
|---|---|---|
| `_id` | objectId | Identificador unico. |
| `sku` | string | `^[A-Z0-9-]{3,40}$`, unico. |
| `name`, `slug` | string | Nombre y slug (unico). |
| `description` | string / null | Descripcion (max 5000). |
| `priceCents` | int / long | Precio en centavos. |
| `costCents` | int / long / double / null | Costo (se actualiza con las compras). |
| `discountPercent`, `taxRatePercent` | porcentaje | Descuento e IVA (0-100). |
| `stock` | int | Existencias. |
| `category` | string | Categoria. |
| `tags`, `images` | array de string | Etiquetas e imagenes. |
| `isFeatured`, `pickupAvailable`, `isActive` | bool | Destacado, recogida y borrado logico. |
| `acceptedPaymentMethods` | array de string | `cash_on_delivery`, `card`, `bank_transfer`. |
| `ratingAverage`, `ratingCount` | number / int | Valoracion. |
| `supplierId`, `createdBy` | objectId / null | Proveedor y creador. |
| `createdAt`, `updatedAt` | date | Fechas. |

Incluye indice de texto `tx_products_search` (nombre, etiquetas, descripcion; idioma espanol).

### Coleccion: `carts`

| Campo | Tipo BSON | Descripcion |
|---|---|---|
| `_id` | objectId | Identificador. |
| `userId` | objectId | Propietario (unico: un carrito por usuario). |
| `items` | array de objeto | `{ productId: objectId, quantity: int (1-999), addedAt: date }`, maximo 100 lineas. |
| `couponCode` | string / null | Cupon aplicado. |
| `createdAt`, `updatedAt` | date | Fechas. |

### Coleccion: `orders`

| Campo | Tipo BSON | Descripcion |
|---|---|---|
| `_id` | objectId | Identificador. |
| `orderNumber` | string | Numero de pedido. |
| `userId` | objectId | Cliente. |
| `channel` | string | Canal del pedido. |
| `status` | string | `pending`, `confirmed`, `pending_verification`, `paid`, `processing`, `shipped`, `delivered`, `cancelled`, `refunded`, `rejected`. |
| `currency` | string | Codigo ISO de 3 letras. |
| `customer` | objeto | `{ name, email, phone? }`. |
| `shippingAddress` | objeto / null | Direccion estructurada. |
| `items` | array de objeto | Lineas con precios, descuentos, IVA y totales congelados. |
| `totals` | objeto | `subtotalCents`, `productDiscountCents`, `couponDiscountCents`, `discountTotalCents`, `taxTotalCents`, `grandTotalCents`, `totalItemsCount`. |
| `payment` | objeto | `method`, `status`, y segun el metodo `card` (`brand`, `last4`, `holderName`, `authorizationCode`, `gatewayTransactionId`) o `bankTransfer` (`bankName`, `senderAccountNumber`, `transferAmountCents`, `authorizationNumber`, `receiptUrl`, `verifiedAt`, `verifiedBy`). |
| `invoiceId` | objectId | Factura asociada. |
| `createdAt`, `updatedAt` | date | Fechas. |

Ademas guarda la copia del cupon aplicado, la clave de idempotencia y datos de conciliacion definidos en `orders.schema.js`.

### Coleccion: `invoices`

| Campo | Tipo BSON | Descripcion |
|---|---|---|
| `_id` | objectId | Identificador. |
| `invoiceNumber` | string | Numero de factura (unico). |
| `entityType` | string | `cliente` o `proveedor`. |
| `orderId`, `orderNumber`, `userId`, `email` | objectId / string | Obligatorios en facturas de cliente. |
| `supplierId`, `purchaseId` | objectId | Obligatorios en facturas de proveedor. |
| `nit`, `nitType` | string | Identificacion fiscal (`nit` o `user_code`). |
| `entityName` | string | Nombre del receptor. |
| `paymentMethod` | string | Metodo de pago. |
| `shippingAddress` | objeto / null | Direccion. |
| `items` | array de objeto | `{ productId, sku, name, quantity, unitPriceCents, discountCents, taxRatePercent, taxCents, totalCents }`. |
| `currency` | string | Moneda. |
| `subtotalCents`, `discountTotalCents`, `taxTotalCents`, `grandTotalCents` | int / long | Totales. |
| `status` | string | `paid`, `pending_payment`, `voided`. |
| `issuedAt`, `voidedAt` | date / null | Emision y anulacion. |
| `voidReason` | string / null | Motivo de anulacion. |
| `createdAt`, `updatedAt` | date | Fechas. |

### Coleccion: `coupons`

| Campo | Tipo BSON | Descripcion |
|---|---|---|
| `_id` | objectId | Identificador. |
| `code` | string | `^[A-Z0-9_-]{3,30}$`, unico. |
| `description` | string / null | Descripcion. |
| `discountType` | string | `percentage` o `fixed`. |
| `discountValue` | int / long | Valor (si es porcentaje, maximo 100). |
| `minOrderCents` | int / long | Compra minima. |
| `maxUses`, `maxUsesPerUser` | int / null | Limites de uso. |
| `usedCount` | int | Usos acumulados. |
| `isActive`, `isPermanent` | bool | Estado y permanencia (si no es permanente, `validUntil > validFrom`). |
| `applicableProductIds` | array de objectId | Productos aplicables (max 500). |
| `validFrom`, `validUntil` | date / null | Vigencia. |
| `createdBy` | objectId / null | Creador. |
| `createdAt`, `updatedAt` | date | Fechas. |

### Coleccion: `suppliers`

| Campo | Tipo BSON | Descripcion |
|---|---|---|
| `_id` | objectId | Identificador. |
| `supplierCode` | string | `^PRV-[0-9]{6,}$`, unico. |
| `name`, `nit` | string | Nombre y NIT (unico). |
| `address`, `phone`, `email`, `contactName` | string / null | Datos de contacto. |
| `distributionDescription` | string / null | Descripcion de distribucion. |
| `catalog` | array de objeto | `{ productId: objectId, costCents }`. |
| `isActive` | bool | Borrado logico. |
| `createdBy` | objectId / null | Creador. |
| `createdAt`, `updatedAt` | date | Fechas. |

### Coleccion: `purchases`

| Campo | Tipo BSON | Descripcion |
|---|---|---|
| `_id` | objectId | Identificador. |
| `purchaseNumber` | string | Numero de compra (unico). |
| `supplierId` | objectId | Proveedor. |
| `supplier` | objeto | Copia `{ supplierCode, name, nit }`. |
| `items` | array de objeto | `{ productId, sku, name, quantity, unitCostCents, previousCostCents, totalCents }`. |
| `totalCostCents` | int / long | Total de la compra. |
| `paymentMethod` | string | Metodo de pago. |
| `invoiceId` | objectId | Factura de proveedor generada. |
| `supplierInvoiceNumber`, `notes` | string / null | Referencia y notas. |
| `createdBy` | objectId / null | Autor. |
| `purchasedAt` | date | Fecha de la compra. |
| `createdAt`, `updatedAt` | date | Fechas. |

### Coleccion: `inventory_losses`

| Campo | Tipo BSON | Descripcion |
|---|---|---|
| `_id` | objectId | Identificador. |
| `productId`, `sku`, `productName`, `category` | objectId / string | Producto afectado (copia). |
| `supplierId` | objectId / null | Proveedor. |
| `quantity` | int / long | Unidades perdidas. |
| `reason` | string | `expired` o `damaged`. |
| `unitCostCents`, `totalLossCents` | int / long | Costo congelado y perdida total. |
| `notes` | string / null | Notas. |
| `recordedBy` | objectId / null | Autor. |
| `occurredAt`, `createdAt` | date | Fechas. |

### Coleccion: `audit_logs`

| Campo | Tipo BSON | Descripcion |
|---|---|---|
| `_id` | objectId | Identificador. |
| `action` | string | Accion, formato `modulo.accion`. |
| `entity`, `entityId` | string / null | Entidad afectada. |
| `outcome` | string | `success` o `failure`. |
| `actorId`, `actorRole`, `role` | objectId / string / null | Quien ejecuto la accion. |
| `targetCollection`, `targetId` | string / null | Coleccion y registro afectados. |
| `previousState`, `newState`, `snapshot` | objeto / null | Estados antes y despues; instantanea en purgas. |
| `metadata` | objeto | Datos adicionales. |
| `ip`, `userAgent` | string / null | Origen. |
| `timestamp` | date / null | Igual a `createdAt` (usado en filtros). |
| `createdAt` | date | Fecha de registro. |

### Coleccion: `system_settings`

Documento unico `_id: "global_config"`.

| Campo | Tipo BSON | Descripcion |
|---|---|---|
| `_id` | string | `global_config`. |
| `defaultTaxRate` | double / int | Fraccion 0..1 (por defecto 0.12). |
| `companyBankAccounts` | array de objeto | `{ bankName, accountNumber, accountHolder, accountType, isActive }`, max 20. |
| `maintenanceMode` | bool | Modo mantenimiento. |
| `updatedAt` | date | Ultima actualizacion. |
| `updatedBy` | objectId / null | Autor. |

### Coleccion: `counters`

| Campo | Tipo BSON | Descripcion |
|---|---|---|
| `_id` | string | Nombre del contador (p. ej. `superuser_governance_lock`). |
| `seq` | int | Valor secuencial. |

## Documentacion de la API

### Documentacion interactiva (Swagger)

La especificacion OpenAPI 3 vive en `src/docs/openapi.js` y la API la publica sin autenticacion en `GET /api/v1/docs/openapi.json`. Una prueba automatica comprueba que cada ruta registrada en Express este documentada, asi que la especificacion no puede quedarse atras del codigo.

Con Docker, el servicio `docs` (Swagger UI) la muestra en **<http://localhost:8082>**. Para probar endpoints protegidos:

1. Abre `Autenticacion -> POST /auth/login`, pulsa **Try it out** y envia el correo y la contrasena.
2. Copia `data.accessToken` de la respuesta, pulsa **Authorize** (arriba a la derecha) y pegalo en `bearerAuth`.
3. Usa **Try it out** en cualquier endpoint; la autorizacion se conserva al recargar la pagina.

Las peticiones salen del navegador hacia `http://localhost:3000`, por eso `http://localhost:8082` esta en `CORS_ORIGINS`. Sin Docker puedes cargar la misma URL de la especificacion en cualquier Swagger UI o importarla en Postman.

### Referencia

Base: `/api/v1` (alias `/api`; la cookie de refresco solo viaja a `/api/v1/auth`). Las respuestas exitosas usan `{ "data": ... }` y las listas paginadas añaden `meta` (`total`, `page`, `limit`, `totalPages`; el catalogo tambien incluye `currency`). Los errores tienen formato uniforme:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Datos de entrada invalidos", "details": [ { "field": "email", "message": "Campo obligatorio" } ] } }
```

La columna "Permiso" indica el permiso RBAC o la condicion de acceso. Las rutas `/admin/*` exigen ademas rol `admin` o `superuser`; las `/superuser/*`, rol `superuser`.

### Salud y autenticacion

| Metodo | Ruta | Permiso | Descripcion |
|---|---|---|---|
| GET | `/health` | publico | Estado del servicio. |
| POST | `/auth/register` | publico | Registro de cliente (crea `user`). |
| POST | `/auth/login` | publico | Inicio de sesion; fija cookies. |
| POST | `/auth/refresh` | cookie `refresh_token` | Renueva la sesion. |
| POST | `/auth/logout` | autenticado | Revoca todas las sesiones (204). |
| PATCH | `/auth/password` | autenticado | Cambia la contrasena (`currentPassword`, `newPassword`) y revoca sesiones. |

Ejemplo de login:

```http
POST /api/v1/auth/login
```

```json
{ "email": "root@example.com", "password": "CambiaEsto123" }
```

Respuesta (ademas, cookies `httpOnly` de acceso y refresco):

```json
{
  "data": {
    "user": {
      "id": "...", "email": "root@example.com", "firstName": "Super", "lastName": "Usuario",
      "phone": null, "role": "superuser", "isActive": true, "lastLoginAt": "2026-11-13T13:32:12.000Z",
      "createdAt": "...", "updatedAt": "...", "permissions": ["profile:read", "..."]
    },
    "accessToken": "<jwt>",
    "expiresIn": 900
  }
}
```

### Usuarios (Fase 1)

| Metodo | Ruta | Permiso | Descripcion |
|---|---|---|---|
| GET | `/users/me` | `profile:read` | Perfil propio. |
| PATCH | `/users/me` | `profile:update` | Actualiza el perfil propio. |
| GET | `/users` | `users:read` | Lista usuarios (paginada). |
| POST | `/users` | `users:create` | Crea un usuario (admin: solo clientes). |
| GET | `/users/:id` | `users:read` | Detalle. |
| PATCH | `/users/:id` | `users:update` | Edita un usuario. |
| PATCH | `/users/:id/status` | `users:deactivate` | Activa o desactiva (`isActive`); desactivar revoca sesiones. |
| PATCH | `/users/:id/role` | `admins:manage` | Cambia el rol; revoca sesiones. |
| DELETE | `/users/:id` | `users:delete` | Purga (requiere desactivacion previa; 204). |
| GET | `/audit-logs` | `audit:read` | Bitacora (ruta de la Fase 1). |

### Tienda, carrito, POS y facturas (Fase 2)

| Metodo | Ruta | Permiso | Descripcion |
|---|---|---|---|
| GET | `/store/products` | publico | Catalogo. Filtros: `page`, `limit`, `category`, `featured`, `onSale`, `newArrivals`, `topRated`, `search`, `minPrice`, `maxPrice`, `sort` (`newest`, `top_rated`, `price_asc`, `price_desc`, `discount_desc`). |
| GET | `/store/products/:id` | publico | Detalle de un producto activo. |
| GET | `/store/config/public` | publico | `{ data: { defaultTaxRate, companyBankAccounts } }` solo cuentas activas, sin `isActive`; `Cache-Control: public, max-age=60`. |
| GET | `/cart` | `cart:manage` | Ver carrito y totales de caja. |
| POST | `/cart/items` | `cart:manage` | Agregar producto (`productId`, `quantity` 1-999). |
| PATCH | `/cart/items/:productId` | `cart:manage` | Cambiar cantidad (`quantity`). |
| DELETE | `/cart/items/:productId` | `cart:manage` | Quitar producto. |
| POST | `/cart/coupon` | `cart:manage` | Aplicar cupon (`code`). |
| DELETE | `/cart/coupon` | `cart:manage` | Quitar cupon. |
| POST | `/pos/checkout` | `pos:use` | Checkout. Cabecera opcional `Idempotency-Key` (8-100 caracteres `[A-Za-z0-9_-]`). 201 con pedido y factura; un reintento idempotente responde 200 con `Idempotent-Replayed: true`. 503 `MAINTENANCE_MODE` si esta activo el mantenimiento. |
| GET | `/invoices` | autenticado | Lista de facturas (filtros `status`, `nit`; `userId` solo con `invoices:manage`). |
| GET | `/invoices/:id` | autenticado | Detalle de una factura. |

El cuerpo del checkout depende de `paymentMethod`. Contra entrega exige `customerName`, `email`, `phone` y `shippingAddress`; tarjeta y transferencia exigen `payment`. Campos comunes opcionales: `nit` (p. ej. `1234567-8` o `CF`), `entityName`, `notes`. Ejemplo con transferencia:

```json
{
  "paymentMethod": "bank_transfer",
  "nit": "CF",
  "payment": {
    "bankName": "Banco Industrial",
    "senderAccountNumber": "1234567890",
    "transferAmount": 1250.5,
    "authorizationNumber": "AUTH-12345",
    "receiptUrl": "https://ejemplo.com/comprobante.png"
  }
}
```

Ejemplo con tarjeta tokenizada (nunca se envia el numero ni el CVV):

```json
{
  "paymentMethod": "card",
  "payment": { "paymentToken": "tok_abc12345", "last4": "4242", "cardHolderName": "Ana Perez", "cardBrand": "Visa" }
}
```

### Panel de administrador (`/admin`)

| Modulo | Metodo y ruta | Permiso | Descripcion |
|---|---|---|---|
| Conciliacion | GET `/admin/orders/pending-verification` | `orders:manage` | Transferencias pendientes de verificar. |
| Conciliacion | PATCH `/admin/orders/:id/reconcile` | `orders:manage` | `approve` o `reject` (con `reason`). |
| Cupones | GET `/admin/coupons/applicable-products` | `coupons:manage` | Productos a los que se puede aplicar un cupon. |
| Cupones | GET `/admin/coupons` | `coupons:manage` | Lista (filtros `isActive`, `code`). |
| Cupones | POST `/admin/coupons` | `coupons:manage` | Crea un cupon. |
| Cupones | GET `/admin/coupons/:id` | `coupons:manage` | Detalle. |
| Cupones | PATCH `/admin/coupons/:id` | `coupons:manage` | Edita. |
| Cupones | PATCH `/admin/coupons/:id/deactivate` | `coupons:manage` | Desactiva. |
| Inventario | GET `/admin/inventory` | `inventory:manage` | Existencias. |
| Inventario | GET `/admin/inventory/:id` | `inventory:manage` | Detalle de producto en inventario. |
| Inventario | GET `/admin/inventory/losses` | `inventory:manage` | Mermas (filtros `productId`, `reason`, fechas). |
| Inventario | POST `/admin/inventory/losses` | `inventory:manage` | Registra una merma. |
| Compras | GET `/admin/purchases` | `inventory:manage` | Lista (filtros `supplierId`, `from`, `to`). |
| Compras | POST `/admin/purchases` | `inventory:manage` | Compra a un proveedor. |
| Compras | GET `/admin/purchases/:id` | `inventory:manage` | Detalle. |
| Proveedores | GET, POST `/admin/suppliers` | `suppliers:manage` | Lista y alta. |
| Proveedores | GET, PATCH `/admin/suppliers/:id` | `suppliers:manage` | Detalle y edicion. |
| Proveedores | PATCH `/admin/suppliers/:id/deactivate` | `suppliers:manage` | Desactiva. |
| Proveedores | DELETE `/admin/suppliers/:id` | `suppliers:manage` + `records:hard_delete` | Borrado fisico. |
| Clientes | GET `/admin/customers` | `customers:manage` | Lista. |
| Clientes | GET, PATCH `/admin/customers/:id` | `customers:manage` | Detalle y edicion. |
| Clientes | PATCH `/admin/customers/:id/deactivate` | `customers:manage` | Desactiva. |
| Clientes | DELETE `/admin/customers/:id` | `customers:manage` + `records:hard_delete` | Borrado fisico. |
| Facturacion | GET `/admin/invoices`, `/admin/invoices/:id` | `invoices:manage` | Ventas y compras (filtro `entityType`). |
| Reportes | GET `/admin/reports/general` | `reports:read` | Reporte general. |
| Reportes | GET `/admin/reports/products/:id/supplier-performance` | `reports:read` | Desempeno de proveedores de un producto. |

Conciliar una transferencia (`PATCH /api/v1/admin/orders/:id/reconcile`):

```json
{ "action": "reject", "reason": "El comprobante no coincide con el monto" }
```

```json
{ "action": "approve" }
```

Crear un cupon (`POST /api/v1/admin/coupons`). Si `isPermanent` es `false` se requiere `expiresAt` futura (regla `expiresAt` XOR `isPermanent`, 422 en caso contrario); `code` vacio o ausente genera uno automatico:

```json
{
  "code": "VERANO20",
  "description": "20% de descuento de verano",
  "discountPercent": 20,
  "expiresAt": "2026-12-31T23:59:59Z",
  "isPermanent": false,
  "maxUses": 100,
  "maxUsesPerUser": 1,
  "applicableProductIds": ["665f1c2e8b3a4d0012345678"]
}
```

Registrar una compra a proveedor (`POST /api/v1/admin/purchases`); `unitCost` en unidades monetarias, sin productos repetidos:

```json
{
  "supplierId": "665f1c2e8b3a4d0012345600",
  "paymentMethod": "bank_transfer",
  "supplierInvoiceNumber": "FAC-0042",
  "notes": "Reposicion mensual",
  "items": [
    { "productId": "665f1c2e8b3a4d0012345678", "quantity": 20, "unitCost": 250.0 }
  ]
}
```

Registrar una merma (`POST /api/v1/admin/inventory/losses`):

```json
{ "productId": "665f1c2e8b3a4d0012345678", "quantity": 2, "reason": "damaged", "notes": "Danado en bodega" }
```

### Modulo de superusuario

| Metodo | Ruta | Permiso fino | Descripcion |
|---|---|---|---|
| GET | `/api/superuser/staff` | `admins:manage` | Personal (`admin`/`superuser`); `page`, `limit`, `role`, `isActive`, `search`. Sin `passwordHash`. |
| POST | `/api/superuser/staff` | `admins:manage` | Alta de `admin` o `superuser` (`email`, `password`, `firstName`, `lastName`, `phone?`, `role`). |
| PATCH | `/api/superuser/staff/:id/role` | `admins:manage` | `{ role }` (cualquier rol); revoca sesiones (`tokenVersion + 1`). |
| PATCH | `/api/superuser/staff/:id/status` | `admins:manage` | `{ isActive }`; desactivar revoca sesiones. |
| GET | `/api/superuser/settings` | `settings:manage` | Configuracion global (o valores por defecto). |
| PATCH | `/api/superuser/settings` | `settings:manage` | `defaultTaxRate`, `companyBankAccounts` (reemplaza la lista), `maintenanceMode`. |
| GET | `/api/superuser/audit-logs` | `audit:read` | Bitacora: `page`, `limit` (max 100), `actorId`, `role`, `action`, `targetCollection`, `startDate`, `endDate`. |
| DELETE | `/api/superuser/purge/:collection/:id` | `records:hard_delete` | Borrado fisico de `users`, `products`, `suppliers` o `coupons`. |

Actualizar la configuracion global (`PATCH /api/superuser/settings`):

```json
{
  "defaultTaxRate": 0.12,
  "maintenanceMode": false,
  "companyBankAccounts": [
    { "bankName": "Banco Industrial", "accountNumber": "123-456789-0", "accountHolder": "Mi Empresa S.A.", "accountType": "monetaria", "isActive": true }
  ]
}
```

Respuesta de una purga exitosa:

```json
{ "data": { "collection": "products", "id": "665f1c2e8b3a4d0012345678", "purged": true, "auditLogId": "..." } }
```

### Codigos de error

| HTTP | Codigo | Cuando |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Cuerpo, query o parametros invalidos (coleccion fuera de la lista blanca, tasa > 1, banco no admitido, `startDate > endDate`, cuerpo vacio) |
| 400 | `NOT_SOFT_DELETED` | Purga de un registro activo |
| 401 | `AUTH_REQUIRED` / `SESSION_REVOKED` | Sin sesion o sesion revocada |
| 403 | `FORBIDDEN` | Rol o permiso insuficiente (p. ej. rol distinto de `superuser` en `/superuser`) |
| 403 | `SELF_MODIFICATION_FORBIDDEN` | Intento de modificar o borrar la propia cuenta |
| 404 | `USER_NOT_FOUND` / `RECORD_NOT_FOUND` | Cuenta o registro inexistente |
| 409 | `SELF_LOCKOUT` | Un superusuario intenta degradarse o desactivarse |
| 409 | `LAST_SUPERUSER` | La operacion dejaria el sistema sin superusuarios activos |
| 409 | `EMAIL_IN_USE` | Correo ya registrado |
| 409 | `FISCAL_INTEGRITY_LOCK` | Documentos fiscales referencian el registro |
| 409 | `SUPPLIER_HAS_PRODUCTS` | El proveedor aun tiene productos asociados |
| 409 | `SELF_PURGE` | El superusuario intenta purgar su propia cuenta |
| 503 | `MAINTENANCE_MODE` | Checkout del POS con `maintenanceMode: true` |

## Comandos disponibles

| Comando | Descripcion |
|---|---|
| `npm install` | Instala las dependencias. |
| `npm run dev` | Inicia el servidor en desarrollo con `node --watch` y carga `.env`. |
| `npm start` | Inicia el servidor (`node src/server.js`) y carga `.env` si existe. |
| `npm run db:init` | Crea colecciones, `$jsonSchema`, indices y la configuracion global por defecto (idempotente). |
| `npm run db:seed-superuser` | Crea el primer superusuario con las variables `SUPERUSER_*`. |
| `npm run db:seed-catalog` | Carga 8 productos y 3 cupones de ejemplo (idempotente). |
| `npm test` | Ejecuta todas las pruebas (`node --test`, reporter `spec`). |
| `npm run test:coverage` | Ejecuta las pruebas con reporte de cobertura experimental. |

## Pruebas

Para ejecutar las pruebas automatizadas (unitarias e integracion HTTP; no requieren MongoDB):

```bash
npm test
```

Para generar un reporte de cobertura:

```bash
npm run test:coverage
```

Las pruebas usan dobles en memoria (`tests/helpers/`, incluidos `superuser-fakes.js` con un `FakeTransactionRunner` que revierte y reintenta como `withTransaction`). Las pruebas `tests/integration/superuser.mongo.test.js` y `tests/integration/checkout.mongo.test.js` se ejecutan contra un replica set real si se define `MONGODB_TEST_URI` (write skew concurrente, `$jsonSchema`, purga atomica, indices y checkout transaccional).

Las pruebas verifican:

- El funcionamiento de las rutas y el RBAC (`auth-rbac`, `admin-rbac`, `superuser-rbac`).
- Las validaciones de datos y DTOs.
- Los casos exitosos y de error (carrito, checkout, pagos, conciliacion, compras, purga, configuracion).
- Los permisos de los usuarios y la guarda de superusuario.

## Convenciones de codigo

- Nombres de variables y funciones en `camelCase`; clases en `PascalCase`; constantes en `MAYUSCULAS_CON_GUION_BAJO`.
- Modulos ESM; los controladores no contienen reglas de negocio y solo los repositorios acceden a MongoDB.
- Los importes se manejan en centavos enteros (`*Cents`).
- Las rutas piden permisos (`authorize(P.X)`), nunca comprueban roles directamente, salvo las guardas de router `requireRoles`/`requireSuperuser`.
- Toda salida pasa por DTOs de lista blanca; toda entrada, por esquemas de validacion.
- Documenta unicamente la logica que no sea evidente y mantén las funciones pequenas con una sola responsabilidad.

## Convencion de commits

Se usa el formato `tipo(<modulo>): descripcion`:

```text
feat(<modulo>): descripcion de una nueva funcionalidad
fix(<modulo>): descripcion de una correccion
merge(dev): integra feature/<nombre>
release: integra <cambios> en main
```

Ejemplos reales del historial: `feat(docker): contenedor del frontend para docker compose`, `merge(dev): integra feature/docker`, `release: integra docker en main`.

Flujo de ramas: cada funcionalidad se desarrolla en `feature/*`, se integra en `dev` y de `dev` se lleva a `main`, siempre con `--no-ff` para conservar el historial. Ramas existentes: `main`, `dev`, `feature/auth-rbac`, `feature/store-pos-checkout`, `feature/superuser-governance` y `feature/docker`.

## Capturas de pantalla

Este repositorio es solo el backend y no tiene interfaz grafica. Las capturas de la aplicacion estan en el repositorio del frontend: <https://github.com/Joguisam-gt/ecommerce-frontend>. Los ejemplos de peticiones y respuestas JSON de la seccion "Documentacion de la API" muestran el comportamiento real de los endpoints.

## Despliegue

El proyecto no esta desplegado publicamente; se ejecuta en local o con Docker.

- *Repositorio:* <https://github.com/Joguisam-gt/ecommerce-backend>
- *API (local):* `http://localhost:3000/api/v1`
- *Frontend relacionado:* <https://github.com/Joguisam-gt/ecommerce-frontend>

## Problemas conocidos

- No hay limitacion de peticiones por IP (rate limiting): el bloqueo por cuenta no frena ataques distribuidos entre muchas cuentas.
- `audit_logs` no tiene politica de retencion (indice TTL) y crece indefinidamente.
- `GET /admin/invoices` no admite el filtro `userId`; por ello el frontend filtra el historial de facturas de un cliente por correo parcial.
- El calculo de impuestos del checkout usa `taxRatePercent` de cada producto; `defaultTaxRate` de la configuracion global aun no se aplica como valor de respaldo (ver "Integracion de `maintenanceMode` e IVA").
- Las transacciones exigen MongoDB como replica set; con una instancia independiente las operaciones transaccionales fallan.

## Mejoras futuras

- Rate limiting por IP.
- Indice TTL (politica de retencion) para `audit_logs`.
- Filtro `userId` en `GET /admin/invoices`.
- Aplicar `defaultTaxRate` como IVA por defecto de productos o como respaldo en `CartPricingService`.
- Proteger con `maintenanceGuard` otras rutas ademas del checkout.

## Como contribuir

1. Crea un fork del repositorio.
2. Crea una nueva rama desde `dev`:

```bash
git checkout -b feature/nombre-funcionalidad
```

3. Realiza los cambios y ejecuta `npm test`.
4. Guarda los cambios con la convencion de commits:

```bash
git add .
git commit -m "feat(<modulo>): agregar nueva funcionalidad"
```

5. Envia la rama a GitHub:

```bash
git push origin feature/nombre-funcionalidad
```

6. Crea un Pull Request hacia `dev`.

## Autor

- *Nombre:* [Nombre completo]
- *Carne:* [Carné]
- *Curso:* [Curso]
- *Seccion:* [Sección]
- *Correo:* [Correo]
- *GitHub:* <https://github.com/Joguisam-gt>

## Licencia

El repositorio no incluye un archivo `LICENSE`. Este proyecto fue desarrollado con fines educativos.

---

## Lista de verificacion antes de entregar

- [x] El nombre y la descripcion del proyecto estan completos.
- [x] Las tecnologias utilizadas estan actualizadas.
- [x] Las instrucciones de instalacion funcionan.
- [x] Las variables de entorno estan documentadas.
- [x] La estructura corresponde al proyecto real.
- [x] Las funcionalidades estan descritas.
- [x] La base de datos esta documentada.
- [x] Los endpoints de la API estan documentados.
- [x] Las pruebas se pueden ejecutar.
- [ ] Las capturas de pantalla se visualizan (el backend no tiene UI; no aplica salvo que se agreguen).
- [x] Los enlaces funcionan.
- [x] No se incluyeron contrasenas, tokens ni datos privados.
- [ ] Los datos del autor estan completos (faltan nombre, carne, curso, seccion y correo).
