/**
 * Prueba HTTP del endpoint publico de la especificacion OpenAPI
 * (GET /api/v1/docs/openapi.json y su alias /api/docs/openapi.json).
 *
 * Usa la app real (middlewares de seguridad incluidos) con un contenedor inerte:
 * la especificacion no depende de la base de datos ni de la sesion.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../../src/app.js';
import { openApiSpec } from '../../src/docs/openapi.js';
import { silentLogger } from '../../src/utils/logger.js';
import { stubContainer } from '../helpers/route-recorder.js';
import { testConfig } from '../helpers/fixtures.js';

describe('GET /api/v1/docs/openapi.json', () => {
  let server;
  let origin;

  before(async () => {
    const app = createApp({ config: testConfig, container: stubContainer(), logger: silentLogger });
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('es publico (sin credenciales) y devuelve JSON OpenAPI 3.x', async () => {
    const response = await fetch(`${origin}/api/v1/docs/openapi.json`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    const spec = await response.json();
    assert.ok(spec.openapi.startsWith('3.'), `openapi: ${spec.openapi}`);
    assert.equal(spec.info.title, 'Ecommerce Backend API');
    assert.deepEqual(spec.servers, openApiSpec.servers);
    assert.ok(Object.keys(spec.paths).length > 40);
  });

  it('tambien esta disponible en el alias /api y conserva las cabeceras de seguridad', async () => {
    const response = await fetch(`${origin}/api/docs/openapi.json`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.ok((await response.json()).paths['/docs/openapi.json'].get);
  });

  it('permite la carga desde un origen CORS autorizado (Swagger UI)', async () => {
    const allowed = testConfig.cors.origins[0];
    const response = await fetch(`${origin}/api/v1/docs/openapi.json`, { headers: { Origin: allowed } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), allowed);
  });
});
