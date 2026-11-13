/**
 * Modulo de superusuario (Fase 4) de extremo a extremo por HTTP.
 *
 * Levanta la app real (rutas + authenticate + requireSuperuser + authorize +
 * validadores + controladores + servicios) en un puerto efimero y la consulta
 * con fetch nativo. Repositorios y transacciones son dobles en memoria
 * (tests/helpers/superuser-fakes.js), por lo que no requiere MongoDB.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { createApp } from '../../src/app.js';
import { buildContainer } from '../../src/container.js';
import { ROLES } from '../../src/constants/roles.js';
import { silentLogger } from '../../src/utils/logger.js';
import { InMemorySequenceRepository } from '../helpers/checkout-fakes.js';
import { TEST_PASSWORD, makeUser, testConfig } from '../helpers/fixtures.js';
import {
  FakeTransactionRunner,
  InMemoryFiscalReferenceRepository,
  InMemoryPurgeDatabase,
  InMemoryPurgeRepository,
  InMemorySystemSettingsRepository,
  TransactionalAuditLogRepository,
  TransactionalUserRepository,
} from '../helpers/superuser-fakes.js';

/** Una ruta representativa por operacion del modulo. */
const SUPERUSER_ENDPOINTS = Object.freeze([
  ['GET', '/superuser/staff'],
  ['POST', '/superuser/staff'],
  ['PATCH', `/superuser/staff/${new ObjectId()}/role`],
  ['PATCH', `/superuser/staff/${new ObjectId()}/status`],
  ['GET', '/superuser/settings'],
  ['PATCH', '/superuser/settings'],
  ['GET', '/superuser/audit-logs'],
  ['DELETE', `/superuser/purge/users/${new ObjectId()}`],
]);

describe('Modulo /api/superuser (HTTP)', () => {
  const rootA = makeUser({ role: ROLES.SUPERUSER, email: 'root.a@example.com' });
  const rootB = makeUser({ role: ROLES.SUPERUSER, email: 'root.b@example.com' });
  const admin = makeUser({ role: ROLES.ADMIN, email: 'admin@example.com' });
  const customer = makeUser({ role: ROLES.USER, email: 'cliente@example.com' });

  // Datos de la purga: cliente desactivado con factura, cliente desactivado limpio y cliente activo.
  const lockedCustomer = makeUser({ role: ROLES.USER, isActive: false, email: 'con.facturas@example.com' });
  const cleanCustomer = makeUser({ role: ROLES.USER, isActive: false, email: 'sin.facturas@example.com' });
  const activeCustomer = makeUser({ role: ROLES.USER, email: 'activo@example.com' });

  let server;
  let origin;
  let auditLogRepository;
  let userRepository;
  const tokens = {};

  before(async () => {
    userRepository = new TransactionalUserRepository([rootA, rootB, admin, customer]);
    auditLogRepository = new TransactionalAuditLogRepository();
    const sequenceRepository = new InMemorySequenceRepository();
    const systemSettingsRepository = new InMemorySystemSettingsRepository();
    const purgeDatabase = new InMemoryPurgeDatabase()
      .insert('users', lockedCustomer, cleanCustomer, activeCustomer)
      .insert('invoices', { _id: new ObjectId(), userId: lockedCustomer._id, entityType: 'cliente', items: [] });

    const container = buildContainer({
      config: testConfig,
      logger: silentLogger,
      repositories: {
        userRepository,
        auditLogRepository,
        sequenceRepository,
        systemSettingsRepository,
        purgeRepository: new InMemoryPurgeRepository(purgeDatabase),
        fiscalReferenceRepository: new InMemoryFiscalReferenceRepository(purgeDatabase),
      },
      transactionRunner: new FakeTransactionRunner([userRepository, auditLogRepository, sequenceRepository, systemSettingsRepository, purgeDatabase]),
    });
    const app = createApp({ config: testConfig, container, logger: silentLogger });
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;

    for (const [key, user] of Object.entries({ rootA, rootB, admin, customer })) {
      const response = await call('/api/v1/auth/login', { method: 'POST', body: { email: user.email, password: TEST_PASSWORD } });
      tokens[key] = response.body.data.accessToken;
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
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  }

  /** Cuerpo de prueba segun el metodo. */
  const bodyFor = (method) => (method === 'GET' || method === 'DELETE' ? undefined : {});

  describe('perimetro RBAC', () => {
    it('sin token: 401 en todas las rutas', async () => {
      for (const [method, path] of SUPERUSER_ENDPOINTS) {
        const { status, body } = await call(`/api${path}`, { method, body: bodyFor(method) });
        assert.equal(status, 401, `${method} ${path}`);
        assert.equal(body.error.code, 'AUTH_REQUIRED');
      }
    });

    it('token invalido: 401', async () => {
      assert.equal((await call('/api/superuser/settings', { token: 'no-es-un-jwt' })).status, 401);
    });

    it('administrador: 403 FORBIDDEN en todas las rutas (antes de validar el cuerpo)', async () => {
      for (const [method, path] of SUPERUSER_ENDPOINTS) {
        const { status, body } = await call(`/api${path}`, { method, token: tokens.admin, body: bodyFor(method) });
        assert.equal(status, 403, `${method} ${path}`);
        assert.equal(body.error.code, 'FORBIDDEN');
      }
    });

    it('cliente (rol user): 403 FORBIDDEN en todas las rutas', async () => {
      for (const [method, path] of SUPERUSER_ENDPOINTS) {
        const { status, body } = await call(`/api${path}`, { method, token: tokens.customer, body: bodyFor(method) });
        assert.equal(status, 403, `${method} ${path}`);
        assert.equal(body.error.code, 'FORBIDDEN');
      }
    });

    it('superusuario: 200 en las consultas de los cuatro modulos (y alias /api/v1)', async () => {
      for (const path of ['/superuser/staff', '/superuser/settings', '/superuser/audit-logs']) {
        assert.equal((await call(`/api${path}`, { token: tokens.rootA })).status, 200, path);
        assert.equal((await call(`/api/v1${path}`, { token: tokens.rootA })).status, 200, `v1 ${path}`);
      }
      const purge = await call(`/api/superuser/purge/users/${new ObjectId()}`, { method: 'DELETE', token: tokens.rootA });
      assert.equal(purge.status, 404, 'la purga llega al servicio');
      assert.equal(purge.body.error.code, 'RECORD_NOT_FOUND');
    });

    it('la ruta antigua /audit-logs sigue intacta', async () => {
      assert.equal((await call('/api/v1/audit-logs', { token: tokens.rootA })).status, 200);
      assert.equal((await call('/api/v1/audit-logs', { token: tokens.admin })).status, 403);
    });
  });

  describe('configuracion global y endpoint publico', () => {
    const accounts = [
      { bankName: 'Banco Industrial', accountNumber: '123-456789-0', accountHolder: 'Tienda S.A.', accountType: 'monetaria', isActive: true },
      { bankName: 'BAC', accountNumber: '900-111222-3', accountHolder: 'Tienda S.A.', accountType: 'ahorro', isActive: false },
    ];

    it('GET devuelve los valores por defecto si aun no hay configuracion', async () => {
      const { body } = await call('/api/superuser/settings', { token: tokens.rootA });
      assert.deepEqual(body.data, { defaultTaxRate: 0.12, companyBankAccounts: [], maintenanceMode: false, updatedAt: null, updatedBy: null });
    });

    it('PATCH actualiza IVA y cuentas', async () => {
      const { status, body } = await call('/api/superuser/settings', {
        method: 'PATCH',
        token: tokens.rootA,
        body: { defaultTaxRate: 0.12, companyBankAccounts: accounts },
      });
      assert.equal(status, 200);
      assert.equal(body.data.companyBankAccounts.length, 2);
      assert.equal(body.data.updatedBy, rootA._id.toString());
    });

    it('PATCH rechaza tasa > 1, banco fuera del enum y cuerpo vacio (400)', async () => {
      for (const payload of [{ defaultTaxRate: 1.5 }, { companyBankAccounts: [{ ...accounts[0], bankName: 'Banco X' }] }, {}]) {
        const { status, body } = await call('/api/superuser/settings', { method: 'PATCH', token: tokens.rootA, body: payload });
        assert.equal(status, 400, JSON.stringify(payload));
        assert.equal(body.error.code, 'VALIDATION_ERROR');
      }
    });

    it('GET /api/store/config/public sin sesion: solo IVA y cuentas activas, con cache publica', async () => {
      const { status, headers, body } = await call('/api/store/config/public');
      assert.equal(status, 200);
      assert.equal(headers.get('cache-control'), 'public, max-age=60');
      assert.deepEqual(body.data, {
        defaultTaxRate: 0.12,
        companyBankAccounts: [{ bankName: 'Banco Industrial', accountNumber: '123-456789-0', accountHolder: 'Tienda S.A.', accountType: 'monetaria' }],
      });
      // El catalogo /api/store sigue funcionando tras montar /store/config antes.
      assert.equal((await call('/api/store/products/no-es-id')).status, 400);
    });

    it('maintenanceMode bloquea el checkout del POS con 503 y se puede desactivar', async () => {
      await call('/api/superuser/settings', { method: 'PATCH', token: tokens.rootA, body: { maintenanceMode: true } });
      const blocked = await call('/api/pos/checkout', { method: 'POST', token: tokens.customer, body: {} });
      assert.equal(blocked.status, 503);
      assert.equal(blocked.body.error.code, 'MAINTENANCE_MODE');

      await call('/api/superuser/settings', { method: 'PATCH', token: tokens.rootA, body: { maintenanceMode: false } });
      const open = await call('/api/pos/checkout', { method: 'POST', token: tokens.customer, body: {} });
      assert.notEqual(open.status, 503);
    });

    it('cada cambio de configuracion queda auditado (settings.updated)', async () => {
      const { body } = await call('/api/superuser/audit-logs?action=settings.updated&targetCollection=system_settings', { token: tokens.rootA });
      assert.equal(body.meta.total, 3);
      assert.ok(body.data.every((log) => log.targetCollection === 'system_settings' && log.timestamp));
    });
  });

  describe('personal', () => {
    it('POST crea un admin sin exponer passwordHash', async () => {
      const { status, headers, body } = await call('/api/superuser/staff', {
        method: 'POST',
        token: tokens.rootA,
        body: { email: 'Nuevo.Admin@Example.com', password: 'Segura123', firstName: 'Nuevo', lastName: 'Admin', role: 'admin' },
      });
      assert.equal(status, 201);
      assert.equal(body.data.email, 'nuevo.admin@example.com');
      assert.equal(body.data.passwordHash, undefined);
      assert.match(headers.get('location'), /\/superuser\/staff\/[a-f\d]{24}$/);
    });

    it('POST rechaza el rol user (400) y el correo duplicado (409)', async () => {
      const base = { password: 'Segura123', firstName: 'X', lastName: 'Y' };
      const user = await call('/api/superuser/staff', { method: 'POST', token: tokens.rootA, body: { ...base, email: 'u@example.com', role: 'user' } });
      assert.equal(user.status, 400);
      const duplicate = await call('/api/superuser/staff', { method: 'POST', token: tokens.rootA, body: { ...base, email: admin.email, role: 'admin' } });
      assert.equal(duplicate.status, 409);
      assert.equal(duplicate.body.error.code, 'EMAIL_IN_USE');
    });

    it('GET lista solo personal', async () => {
      const { body } = await call('/api/superuser/staff?limit=50', { token: tokens.rootA });
      assert.ok(body.data.every((user) => ['admin', 'superuser'].includes(user.role)));
      assert.ok(body.data.every((user) => user.passwordHash === undefined));
      assert.equal(body.meta.total, 4);
    });

    it('409 SELF_LOCKOUT al degradarse a si mismo', async () => {
      const { status, body } = await call(`/api/superuser/staff/${rootA._id}/role`, { method: 'PATCH', token: tokens.rootA, body: { role: 'admin' } });
      assert.equal(status, 409);
      assert.equal(body.error.code, 'SELF_LOCKOUT');
    });

    it('degradar a otro superusuario revoca sus sesiones y queda auditado', async () => {
      const { status, body } = await call(`/api/superuser/staff/${rootB._id}/role`, { method: 'PATCH', token: tokens.rootA, body: { role: 'admin' } });
      assert.equal(status, 200);
      assert.equal(body.data.role, 'admin');

      const revoked = await call('/api/superuser/settings', { token: tokens.rootB });
      assert.equal(revoked.status, 401);
      assert.equal(revoked.body.error.code, 'SESSION_REVOKED');

      const logs = await call('/api/superuser/audit-logs?action=staff.role_changed', { token: tokens.rootA });
      assert.equal(logs.body.data[0].metadata.before.role, 'superuser');
      assert.equal(logs.body.data[0].metadata.after.role, 'admin');
      assert.equal(logs.body.data[0].actorId, rootA._id.toString());
    });

    it('el ultimo superusuario activo no puede desactivarse y el sistema conserva uno', async () => {
      // Ahora rootA es el unico superusuario activo. Por HTTP el actor siempre es un superusuario
      // activo, asi que aqui actua SELF_LOCKOUT; LAST_SUPERUSER solo aparece en carreras
      // (cubierto en superuser-staff.test.js y en superuser.mongo.test.js).
      const { status, body } = await call(`/api/superuser/staff/${rootA._id}/status`, { method: 'PATCH', token: tokens.rootA, body: { isActive: false } });
      assert.equal(status, 409);
      assert.equal(body.error.code, 'SELF_LOCKOUT');
      assert.equal(await userRepository.countActiveByRole(ROLES.SUPERUSER), 1);
    });

    it('PATCH valida el cuerpo y el id', async () => {
      assert.equal((await call(`/api/superuser/staff/${admin._id}/role`, { method: 'PATCH', token: tokens.rootA, body: { role: 'root' } })).status, 400);
      assert.equal((await call(`/api/superuser/staff/${admin._id}/status`, { method: 'PATCH', token: tokens.rootA, body: { isActive: 'no' } })).status, 400);
      assert.equal((await call('/api/superuser/staff/123/role', { method: 'PATCH', token: tokens.rootA, body: { role: 'admin' } })).status, 400);
    });
  });

  describe('purga', () => {
    it('400 con una coleccion fuera de la lista blanca', async () => {
      const { status, body } = await call(`/api/superuser/purge/orders/${new ObjectId()}`, { method: 'DELETE', token: tokens.rootA });
      assert.equal(status, 400);
      assert.equal(body.error.code, 'VALIDATION_ERROR');
    });

    it('400 NOT_SOFT_DELETED si el registro sigue activo', async () => {
      const { status, body } = await call(`/api/superuser/purge/users/${activeCustomer._id}`, { method: 'DELETE', token: tokens.rootA });
      assert.equal(status, 400);
      assert.equal(body.error.code, 'NOT_SOFT_DELETED');
    });

    it('409 FISCAL_INTEGRITY_LOCK al purgar un cliente con facturas', async () => {
      const { status, body } = await call(`/api/superuser/purge/users/${lockedCustomer._id}`, { method: 'DELETE', token: tokens.rootA });
      assert.equal(status, 409);
      assert.equal(body.error.code, 'FISCAL_INTEGRITY_LOCK');
      assert.deepEqual(body.error.details.references, { orders: 0, invoices: 1 });
    });

    it('200 al purgar un cliente sin dependencias; la auditoria guarda la instantanea sin passwordHash', async () => {
      const { status, body } = await call(`/api/superuser/purge/users/${cleanCustomer._id}`, { method: 'DELETE', token: tokens.rootA });
      assert.equal(status, 200);
      assert.equal(body.data.collection, 'users');
      assert.equal(body.data.id, cleanCustomer._id.toString());
      assert.equal(body.data.purged, true);
      assert.match(body.data.auditLogId, /^[a-f\d]{24}$/);

      const logs = await call('/api/superuser/audit-logs?action=record.purged&targetCollection=users', { token: tokens.rootA });
      assert.equal(logs.status, 200);
      const [entry] = logs.body.data;
      assert.equal(entry.id, body.data.auditLogId);
      assert.equal(entry.snapshot.email, cleanCustomer.email);
      assert.equal(entry.snapshot.passwordHash, undefined);
      assert.equal(entry.snapshot.tokenVersion, undefined);
      assert.ok(entry.timestamp);
      assert.deepEqual(Object.keys(logs.body.meta).sort(), ['limit', 'page', 'total', 'totalPages']);

      const again = await call(`/api/superuser/purge/users/${cleanCustomer._id}`, { method: 'DELETE', token: tokens.rootA });
      assert.equal(again.status, 404);
    });

    it('audit-logs valida filtros (fechas invertidas, limite excesivo)', async () => {
      const inverted = await call('/api/superuser/audit-logs?startDate=2026-02-01&endDate=2026-01-01', { token: tokens.rootA });
      assert.equal(inverted.status, 400);
      assert.equal((await call('/api/superuser/audit-logs?limit=500', { token: tokens.rootA })).status, 400);
      assert.equal((await call('/api/superuser/audit-logs?role=root', { token: tokens.rootA })).status, 400);
    });

    it('no existe ninguna ruta para modificar o borrar audit_logs', async () => {
      const id = auditLogRepository.entries[0]._id.toString();
      for (const method of ['PATCH', 'PUT', 'DELETE']) {
        const { status } = await call(`/api/superuser/audit-logs/${id}`, { method, token: tokens.rootA, body: method === 'DELETE' ? undefined : {} });
        assert.equal(status, 404, method);
      }
      assert.equal((await call('/api/superuser/audit-logs', { method: 'DELETE', token: tokens.rootA })).status, 404);
    });
  });
});
