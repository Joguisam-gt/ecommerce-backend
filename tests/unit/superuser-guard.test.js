/**
 * Pruebas unitarias del perimetro del modulo de superusuario (Fase 4):
 * guard RBAC estricto requireSuperuser y middleware de modo mantenimiento.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALL_ROLES, ROLES } from '../../src/constants/roles.js';
import { createMaintenanceGuard } from '../../src/middlewares/maintenance-guard.js';
import { SUPERUSER_ONLY_ROLES, requireSuperuser } from '../../src/middlewares/require-superuser.js';

/**
 * Ejecuta un middleware sincrono y devuelve el argumento pasado a next().
 * @param {Function} middleware
 * @param {object} req
 */
function run(middleware, req) {
  let received = 'no-llamado';
  middleware(req, {}, (arg) => {
    received = arg;
  });
  return received;
}

describe('requireSuperuser (guard RBAC estricto)', () => {
  it('solo admite el rol superuser', () => {
    assert.deepEqual([...SUPERUSER_ONLY_ROLES], [ROLES.SUPERUSER]);
  });

  it('401 AUTH_REQUIRED sin usuario autenticado', () => {
    const error = run(requireSuperuser, {});
    assert.equal(error.status, 401);
    assert.equal(error.code, 'AUTH_REQUIRED');
  });

  it('403 FORBIDDEN para admin y user (cualquier rol distinto de superuser)', () => {
    for (const role of ALL_ROLES.filter((value) => value !== ROLES.SUPERUSER)) {
      const error = run(requireSuperuser, { user: { id: 'x', role } });
      assert.equal(error.status, 403, role);
      assert.equal(error.code, 'FORBIDDEN', role);
    }
  });

  it('403 para un rol desconocido o manipulado', () => {
    assert.equal(run(requireSuperuser, { user: { id: 'x', role: 'SUPERUSER' } }).status, 403);
    assert.equal(run(requireSuperuser, { user: { id: 'x', role: 'root' } }).status, 403);
  });

  it('deja pasar al superusuario', () => {
    assert.equal(run(requireSuperuser, { user: { id: 'x', role: ROLES.SUPERUSER } }), undefined);
  });
});

describe('createMaintenanceGuard', () => {
  /** Servicio de configuracion falso con el modo indicado. */
  const settingsWith = (maintenanceMode) => ({ isMaintenanceMode: async () => maintenanceMode });

  it('503 MAINTENANCE_MODE cuando el modo mantenimiento esta activo', async () => {
    const guard = createMaintenanceGuard({ settingsService: settingsWith(true) });
    let nextCalled = false;
    await assert.rejects(
      guard({}, {}, () => {
        nextCalled = true;
      }),
      { status: 503, code: 'MAINTENANCE_MODE' },
    );
    assert.equal(nextCalled, false);
  });

  it('continua cuando el modo mantenimiento esta desactivado', async () => {
    const guard = createMaintenanceGuard({ settingsService: settingsWith(false) });
    let received = 'no-llamado';
    await guard({}, {}, (arg) => {
      received = arg;
    });
    assert.equal(received, undefined);
  });

  it('propaga un fallo al leer la configuracion (no lo silencia)', async () => {
    const guard = createMaintenanceGuard({
      settingsService: {
        isMaintenanceMode: async () => {
          throw new Error('sin base de datos');
        },
      },
    });
    await assert.rejects(guard({}, {}, () => {}), /sin base de datos/);
  });
});
