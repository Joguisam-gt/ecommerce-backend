/**
 * Pruebas de configuracion y del Singleton de base de datos.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Database, database } from '../../src/config/database.js';
import { loadConfig } from '../../src/config/env.js';
import { TEST_ENV } from '../helpers/fixtures.js';

describe('loadConfig', () => {
  it('aplica valores por defecto seguros', () => {
    const config = loadConfig(TEST_ENV);
    assert.equal(config.server.port, 3000);
    assert.equal(config.jwt.accessTtlSeconds, 900);
    assert.equal(config.cookies.sameSite, 'strict');
    assert.equal(config.security.maxLoginAttempts, 5);
    assert.deepEqual(config.cors.origins, ['http://localhost:5173']);
  });

  it('devuelve un objeto inmutable en profundidad', () => {
    const config = loadConfig(TEST_ENV);
    assert.ok(Object.isFrozen(config));
    assert.ok(Object.isFrozen(config.jwt));
    assert.throws(() => {
      'use strict';
      config.jwt.accessSecret = 'x';
    }, TypeError);
  });

  it('falla si faltan variables obligatorias', () => {
    assert.throws(() => loadConfig({}), /MONGODB_URI/);
  });

  it('rechaza secretos cortos o iguales', () => {
    assert.throws(() => loadConfig({ ...TEST_ENV, JWT_ACCESS_SECRET: 'corto' }), /al menos 32/);
    assert.throws(
      () => loadConfig({ ...TEST_ENV, JWT_REFRESH_SECRET: TEST_ENV.JWT_ACCESS_SECRET }),
      /deben ser distintos/,
    );
  });

  it('activa cookies seguras por defecto en produccion', () => {
    const config = loadConfig({ ...TEST_ENV, NODE_ENV: 'production' });
    assert.equal(config.cookies.secure, true);
    assert.equal(config.isProduction, true);
  });
});

describe('Database (Singleton)', () => {
  it('getInstance devuelve siempre la misma instancia', () => {
    assert.equal(Database.getInstance(), Database.getInstance());
    assert.equal(Database.getInstance(), database);
  });

  it('impide instanciar con new', () => {
    assert.throws(() => new Database(), /Singleton/);
  });

  it('getDb falla si no hay conexion', () => {
    assert.equal(database.isConnected(), false);
    assert.throws(() => database.getDb(), /no esta conectada/);
  });

  it('ping devuelve false sin conexion', async () => {
    assert.equal(await database.ping(), false);
  });
});
