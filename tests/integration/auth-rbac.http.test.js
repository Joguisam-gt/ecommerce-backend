/**
 * Prueba de extremo a extremo de la capa HTTP (rutas + middlewares + controladores
 * + servicios) usando fetch nativo contra la app real en un puerto efimero.
 * Los repositorios son dobles en memoria, por lo que no requiere MongoDB.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../../src/app.js';
import { buildContainer } from '../../src/container.js';
import { ROLES } from '../../src/constants/roles.js';
import { silentLogger } from '../../src/utils/logger.js';
import { TEST_PASSWORD, makeUser, testConfig } from '../helpers/fixtures.js';
import { InMemoryAuditLogRepository, InMemoryUserRepository } from '../helpers/in-memory-repositories.js';

describe('API /api/v1 (auth + RBAC)', () => {
  const superuser = makeUser({ role: ROLES.SUPERUSER, email: 'root@example.com' });
  const admin = makeUser({ role: ROLES.ADMIN, email: 'admin@example.com' });
  const customer = makeUser({ role: ROLES.USER, email: 'cliente@example.com' });

  let server;
  let baseUrl;

  before(async () => {
    const container = buildContainer({
      config: testConfig,
      logger: silentLogger,
      repositories: {
        userRepository: new InMemoryUserRepository([superuser, admin, customer]),
        auditLogRepository: new InMemoryAuditLogRepository(),
      },
    });
    const app = createApp({ config: testConfig, container, logger: silentLogger });
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  /**
   * Envia una peticion JSON con fetch nativo.
   * @param {string} path
   * @param {{ method?: string, body?: object, token?: string, cookie?: string }} [options]
   */
  async function call(path, { method = 'GET', body, token, cookie } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  }

  /** Inicia sesion y devuelve el access token. */
  async function loginAs(email) {
    const { body } = await call('/auth/login', { method: 'POST', body: { email, password: TEST_PASSWORD } });
    return body.data.accessToken;
  }

  it('GET /health responde ok', async () => {
    const { status, body } = await call('/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
  });

  it('login establece cookies httpOnly y no expone el hash', async () => {
    const { status, headers, body } = await call('/auth/login', {
      method: 'POST',
      body: { email: 'cliente@example.com', password: TEST_PASSWORD },
    });
    assert.equal(status, 200);
    const cookies = headers.getSetCookie();
    assert.ok(cookies.some((c) => c.startsWith('access_token=') && c.includes('HttpOnly') && c.includes('SameSite=Strict')));
    assert.ok(cookies.some((c) => c.startsWith('refresh_token=') && c.includes('Path=/api/v1/auth')));
    assert.equal(body.data.user.passwordHash, undefined);
    assert.equal(headers.get('x-powered-by'), null);
  });

  it('registro ignora intentos de escalar privilegios', async () => {
    const { status, body } = await call('/auth/register', {
      method: 'POST',
      body: { email: 'hacker@example.com', password: 'Segura123', firstName: 'H', lastName: 'X', role: 'superuser' },
    });
    assert.equal(status, 400);
    assert.equal(body.error.details[0].field, 'role');
  });

  it('bloquea inyeccion de operadores en login', async () => {
    const { status, body } = await call('/auth/login', {
      method: 'POST',
      body: { email: { $ne: null }, password: { $ne: null } },
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'FORBIDDEN_KEYS');
  });

  it('las rutas protegidas exigen autenticacion', async () => {
    const { status } = await call('/users/me');
    assert.equal(status, 401);
  });

  it('el refresh funciona solo con la cookie', async () => {
    const login = await call('/auth/login', { method: 'POST', body: { email: 'admin@example.com', password: TEST_PASSWORD } });
    const refreshCookie = login.headers.getSetCookie().find((c) => c.startsWith('refresh_token=')).split(';')[0];
    const { status, body } = await call('/auth/refresh', { method: 'POST', cookie: refreshCookie });
    assert.equal(status, 200);
    assert.ok(body.data.accessToken);
  });

  describe('matriz de acceso por rol', () => {
    let tokens;

    before(async () => {
      tokens = {
        superuser: await loginAs('root@example.com'),
        admin: await loginAs('admin@example.com'),
        user: await loginAs('cliente@example.com'),
      };
    });

    it('user: perfil si, administracion no', async () => {
      assert.equal((await call('/users/me', { token: tokens.user })).status, 200);
      assert.equal((await call('/users', { token: tokens.user })).status, 403);
      assert.equal((await call('/audit-logs', { token: tokens.user })).status, 403);
    });

    it('admin: lista usuarios pero no lee logs ni borra', async () => {
      const list = await call('/users?limit=10', { token: tokens.admin });
      assert.equal(list.status, 200);
      assert.equal(list.body.meta.total, 3);
      assert.equal((await call('/audit-logs', { token: tokens.admin })).status, 403);
      assert.equal((await call(`/users/${customer._id}`, { method: 'DELETE', token: tokens.admin })).status, 403);
      assert.equal(
        (await call(`/users/${customer._id}/role`, { method: 'PATCH', token: tokens.admin, body: { role: 'admin' } })).status,
        403,
      );
    });

    it('admin: desactiva clientes pero no superusuarios', async () => {
      const own = await call(`/users/${superuser._id}/status`, { method: 'PATCH', token: tokens.admin, body: { isActive: false } });
      assert.equal(own.status, 403);
    });

    it('superuser: lee audit_logs con los eventos registrados', async () => {
      const { status, body } = await call('/audit-logs?action=auth.login', { token: tokens.superuser });
      assert.equal(status, 200);
      assert.ok(body.data.length >= 3);
      assert.ok(body.data.every((log) => log.action === 'auth.login'));
    });

    it('superuser: crea un admin y luego lo elimina fisicamente', async () => {
      const created = await call('/users', {
        method: 'POST',
        token: tokens.superuser,
        body: { email: 'nuevo.admin@example.com', password: 'Segura123', firstName: 'Nuevo', lastName: 'Admin', role: 'admin' },
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.data.role, 'admin');

      const removed = await call(`/users/${created.body.data.id}`, { method: 'DELETE', token: tokens.superuser });
      assert.equal(removed.status, 204);
    });

    it('valida el formato del identificador', async () => {
      const { status, body } = await call('/users/no-es-un-id', { token: tokens.superuser });
      assert.equal(status, 400);
      assert.equal(body.error.code, 'VALIDATION_ERROR');
    });

    it('logout revoca el token en uso', async () => {
      const token = await loginAs('cliente@example.com');
      assert.equal((await call('/auth/logout', { method: 'POST', token })).status, 204);
      const after = await call('/users/me', { token });
      assert.equal(after.status, 401);
      assert.equal(after.body.error.code, 'SESSION_REVOKED');
    });
  });

  it('rutas inexistentes devuelven 404 JSON', async () => {
    const { status, body } = await call('/no-existe');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'ROUTE_NOT_FOUND');
  });
});
