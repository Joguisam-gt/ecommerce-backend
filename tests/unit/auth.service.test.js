/**
 * Pruebas de AuthService con repositorios en memoria y reloj controlado.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ROLES } from '../../src/constants/roles.js';
import { LoginDTO, RegisterUserDTO } from '../../src/dtos/auth.dto.js';
import { AUDIT_ACTIONS } from '../../src/services/audit.service.js';
import { AuthService } from '../../src/services/auth.service.js';
import { TEST_PASSWORD, actorOf, makeDeps, makeUser, testConfig } from '../helpers/fixtures.js';

describe('AuthService', () => {
  let now;
  let deps;
  let service;
  let customer;

  beforeEach(() => {
    now = new Date('2026-06-01T10:00:00Z');
    customer = makeUser({ email: 'cliente@example.com' });
    deps = makeDeps([customer], { clock: () => now });
    service = new AuthService({ ...deps, securityConfig: testConfig.security, clock: () => now });
  });

  describe('register', () => {
    it('crea siempre un cliente y devuelve tokens', async () => {
      const dto = RegisterUserDTO.from({ email: 'Nuevo@Example.com', password: 'Segura123', firstName: 'Luis', lastName: 'Gomez' });
      const { user, accessToken, refreshToken } = await service.register(dto);

      assert.equal(user.role, ROLES.USER);
      assert.equal(user.email, 'nuevo@example.com');
      assert.notEqual(user.passwordHash, 'Segura123');
      assert.ok(accessToken && refreshToken);
      assert.deepEqual(deps.auditLogRepository.actions(), [AUDIT_ACTIONS.AUTH_REGISTER]);
    });

    it('rechaza correos duplicados', async () => {
      const dto = RegisterUserDTO.from({ email: 'cliente@example.com', password: 'Segura123', firstName: 'A', lastName: 'B' });
      await assert.rejects(service.register(dto), { status: 409, code: 'EMAIL_IN_USE' });
    });
  });

  describe('login', () => {
    it('inicia sesion con credenciales correctas y limpia el contador', async () => {
      deps.userRepository.peek(customer._id).failedLoginAttempts = 2;
      const { user } = await service.login(LoginDTO.from({ email: 'CLIENTE@example.com', password: TEST_PASSWORD }));

      assert.equal(user.failedLoginAttempts, 0);
      assert.deepEqual(user.lastLoginAt, now);
      assert.ok(deps.auditLogRepository.actions().includes(AUDIT_ACTIONS.AUTH_LOGIN));
    });

    it('usa el mismo error para correo inexistente y contrasena incorrecta', async () => {
      await assert.rejects(service.login({ email: 'nadie@example.com', password: 'x' }), { status: 401, code: 'INVALID_CREDENTIALS' });
      await assert.rejects(service.login({ email: 'cliente@example.com', password: 'Mala1234' }), { status: 401, code: 'INVALID_CREDENTIALS' });
    });

    it('bloquea la cuenta tras el maximo de intentos y la desbloquea al expirar', async () => {
      const max = testConfig.security.maxLoginAttempts;
      for (let attempt = 0; attempt < max; attempt += 1) {
        await assert.rejects(service.login({ email: 'cliente@example.com', password: 'Mala1234' }), { status: 401 });
      }
      assert.ok(deps.auditLogRepository.actions().includes(AUDIT_ACTIONS.AUTH_ACCOUNT_LOCKED));

      // Bloqueada incluso con la contrasena correcta.
      await assert.rejects(service.login({ email: 'cliente@example.com', password: TEST_PASSWORD }), { status: 423, code: 'ACCOUNT_LOCKED' });

      now = new Date(now.getTime() + testConfig.security.lockTimeMs + 1000);
      const { user } = await service.login({ email: 'cliente@example.com', password: TEST_PASSWORD });
      assert.equal(user.lockUntil, null);
    });

    it('rechaza cuentas desactivadas solo despues de validar la contrasena', async () => {
      deps.userRepository.peek(customer._id).isActive = false;
      await assert.rejects(service.login({ email: 'cliente@example.com', password: 'Mala1234' }), { status: 401 });
      await assert.rejects(service.login({ email: 'cliente@example.com', password: TEST_PASSWORD }), { status: 403, code: 'ACCOUNT_DISABLED' });
    });
  });

  describe('refresh y logout', () => {
    it('renueva la sesion con un refresh token valido', async () => {
      const { refreshToken } = await service.login({ email: 'cliente@example.com', password: TEST_PASSWORD });
      const session = await service.refresh(refreshToken);
      assert.ok(session.accessToken);
    });

    it('logout revoca todos los refresh tokens emitidos', async () => {
      const { refreshToken } = await service.login({ email: 'cliente@example.com', password: TEST_PASSWORD });
      await service.logout(actorOf(customer));
      await assert.rejects(service.refresh(refreshToken), { status: 401, code: 'SESSION_REVOKED' });
    });

    it('falla sin refresh token', async () => {
      await assert.rejects(service.refresh(undefined), { code: 'MISSING_REFRESH_TOKEN' });
    });
  });

  describe('changePassword', () => {
    it('exige la contrasena actual', async () => {
      await assert.rejects(
        service.changePassword(actorOf(customer), { currentPassword: 'Mala1234', newPassword: 'Nueva1234' }),
        { status: 400, code: 'INVALID_CURRENT_PASSWORD' },
      );
    });

    it('cambia la contrasena e invalida sesiones anteriores', async () => {
      const { refreshToken: oldRefresh } = await service.login({ email: 'cliente@example.com', password: TEST_PASSWORD });
      const session = await service.changePassword(actorOf(customer), { currentPassword: TEST_PASSWORD, newPassword: 'Nueva1234' });

      await assert.rejects(service.refresh(oldRefresh), { code: 'SESSION_REVOKED' });
      assert.ok(await service.refresh(session.refreshToken));
      assert.ok(await service.login({ email: 'cliente@example.com', password: 'Nueva1234' }));
    });
  });

  it('un fallo de auditoria no interrumpe el login', async () => {
    deps.auditLogRepository.failOnCreate = true;
    const { user } = await service.login({ email: 'cliente@example.com', password: TEST_PASSWORD });
    assert.equal(user.email, 'cliente@example.com');
  });
});
