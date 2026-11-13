/**
 * Control de acceso RBAC del panel de administracion (Fase 3), de extremo a extremo.
 *
 * Levanta la app real (rutas + authenticate + requireRoles + authorize) en un
 * puerto efimero y la consulta con fetch nativo. Los repositorios son dobles en
 * memoria; los modulos sin doble quedan "no disponibles", lo que basta para
 * comprobar que las barreras de acceso actuan ANTES de llegar a la logica.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { createApp } from '../../src/app.js';
import { buildContainer } from '../../src/container.js';
import { PERMISSIONS as P, hasPermission } from '../../src/constants/permissions.js';
import { ROLES } from '../../src/constants/roles.js';
import { ADMIN_PANEL_ROLES } from '../../src/routes/admin.routes.js';
import { silentLogger } from '../../src/utils/logger.js';
import { TEST_PASSWORD, makeUser, testConfig } from '../helpers/fixtures.js';
import { InMemoryAuditLogRepository, InMemoryUserRepository } from '../helpers/in-memory-repositories.js';

/** Una ruta representativa por modulo administrativo. */
const ADMIN_ENDPOINTS = Object.freeze([
  ['GET', '/admin/orders/pending-verification'],
  ['PATCH', `/admin/orders/${new ObjectId()}/reconcile`],
  ['GET', '/admin/coupons'],
  ['GET', '/admin/coupons/applicable-products'],
  ['GET', '/admin/inventory'],
  ['POST', '/admin/inventory/losses'],
  ['POST', '/admin/purchases'],
  ['GET', '/admin/suppliers'],
  ['GET', '/admin/customers'],
  ['GET', '/admin/invoices'],
  ['GET', '/admin/reports/general'],
  ['GET', `/admin/reports/products/${new ObjectId()}/supplier-performance`],
]);

describe('Panel /admin: control de acceso RBAC (HTTP)', () => {
  const superuser = makeUser({ role: ROLES.SUPERUSER, email: 'root@example.com' });
  const admin = makeUser({ role: ROLES.ADMIN, email: 'admin@example.com' });
  const customer = makeUser({ role: ROLES.USER, email: 'cliente@example.com' });

  let server;
  let origin;
  const tokens = {};

  /** Doble minimo del repositorio de facturas admin: permite una respuesta 200 real. */
  const adminInvoiceRepository = {
    search: async () => ({ items: [], total: 0 }),
    findById: async () => null,
  };

  before(async () => {
    const container = buildContainer({
      config: testConfig,
      logger: silentLogger,
      repositories: {
        userRepository: new InMemoryUserRepository([superuser, admin, customer]),
        auditLogRepository: new InMemoryAuditLogRepository(),
        adminInvoiceRepository,
      },
    });
    const app = createApp({ config: testConfig, container, logger: silentLogger });
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;

    // Inicia sesion una vez por rol y guarda el access token.
    for (const user of [superuser, admin, customer]) {
      const response = await call('/api/v1/auth/login', { method: 'POST', body: { email: user.email, password: TEST_PASSWORD } });
      tokens[user.role] = response.body.data.accessToken;
    }
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  /**
   * Peticion JSON con fetch nativo.
   * @param {string} path Ruta absoluta (incluye /api o /api/v1).
   * @param {{ method?: string, body?: object, token?: string }} [options]
   */
  async function call(path, { method = 'GET', body, token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${origin}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  it('sin token: 401 en todos los modulos', async () => {
    for (const [method, path] of ADMIN_ENDPOINTS) {
      const { status } = await call(`/api/v1${path}`, { method, body: method === 'GET' ? undefined : {} });
      assert.equal(status, 401, `${method} ${path}`);
    }
  });

  it('token invalido: 401', async () => {
    const { status } = await call('/api/v1/admin/invoices', { token: 'no-es-un-jwt' });
    assert.equal(status, 401);
  });

  it('cliente (rol user): 403 en todos los modulos', async () => {
    for (const [method, path] of ADMIN_ENDPOINTS) {
      const { status, body } = await call(`/api/v1${path}`, {
        method,
        token: tokens[ROLES.USER],
        body: method === 'GET' ? undefined : {},
      });
      assert.equal(status, 403, `${method} ${path}`);
      assert.equal(body.error.code, 'FORBIDDEN');
    }
  });

  it('administrador y superusuario superan el RBAC y llegan al controlador', async () => {
    for (const role of ADMIN_PANEL_ROLES) {
      const { status, body } = await call('/api/v1/admin/invoices', { token: tokens[role] });
      assert.equal(status, 200, role);
      assert.deepEqual(body.data, []);
    }
  });

  it('el contrato /api/admin (sin version) aplica las mismas reglas', async () => {
    assert.equal((await call('/api/admin/invoices')).status, 401);
    assert.equal((await call('/api/admin/invoices', { token: tokens[ROLES.USER] })).status, 403);
    assert.equal((await call('/api/admin/invoices', { token: tokens[ROLES.ADMIN] })).status, 200);
  });

  it('borrado fisico de clientes y proveedores: 403 para administrador', async () => {
    for (const path of ['/admin/customers', '/admin/suppliers']) {
      const { status } = await call(`/api/v1${path}/${new ObjectId()}`, { method: 'DELETE', token: tokens[ROLES.ADMIN] });
      assert.equal(status, 403, path);
    }
  });
});

describe('Matriz de permisos de la Fase 3', () => {
  const PANEL_PERMISSIONS = [
    P.ORDERS_MANAGE,
    P.COUPONS_MANAGE,
    P.INVENTORY_MANAGE,
    P.SUPPLIERS_MANAGE,
    P.CUSTOMERS_MANAGE,
    P.INVOICES_MANAGE,
    P.REPORTS_READ,
  ];

  it('admin y superuser tienen todos los permisos del panel; user ninguno', () => {
    for (const permission of PANEL_PERMISSIONS) {
      assert.ok(hasPermission(ROLES.ADMIN, permission), permission);
      assert.ok(hasPermission(ROLES.SUPERUSER, permission), permission);
      assert.equal(hasPermission(ROLES.USER, permission), false, permission);
    }
  });

  it('el borrado fisico queda reservado al superusuario', () => {
    assert.ok(hasPermission(ROLES.SUPERUSER, P.RECORDS_HARD_DELETE));
    assert.equal(hasPermission(ROLES.ADMIN, P.RECORDS_HARD_DELETE), false);
  });

  it('solo admin y superuser son roles del panel', () => {
    assert.deepEqual([...ADMIN_PANEL_ROLES].sort(), [ROLES.ADMIN, ROLES.SUPERUSER].sort());
  });
});
