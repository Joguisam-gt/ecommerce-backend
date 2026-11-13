/**
 * Pruebas de coherencia de la especificacion OpenAPI (src/docs/openapi.js).
 *
 * - Toda ruta registrada en los enrutadores de Express esta documentada (metodo + ruta)
 *   y, al reves, no se documenta ninguna ruta inexistente.
 * - Todo $ref resuelve dentro del documento.
 * - Estructura minima de cada operacion (tags declarados, parametros de ruta, seguridad).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openApiSpec } from '../../src/docs/openapi.js';
import { listRegisteredRoutes } from '../helpers/route-recorder.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Operaciones documentadas como "METODO /ruta". */
function documentedOperations() {
  return Object.entries(openApiSpec.paths).flatMap(([path, item]) =>
    Object.keys(item)
      .filter((key) => HTTP_METHODS.includes(key))
      .map((method) => `${method.toUpperCase()} ${path}`),
  );
}

/** Recorre el documento y devuelve todos los valores de "$ref" con su ubicacion. */
function collectRefs(node, location = '#', found = []) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectRefs(item, `${location}/${index}`, found));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') found.push({ ref: value, location });
      else collectRefs(value, `${location}/${key}`, found);
    }
  }
  return found;
}

/** Resuelve un puntero JSON local (#/components/...). */
function resolvePointer(pointer) {
  return pointer
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((node, part) => (node === undefined || node === null ? undefined : node[part]), openApiSpec);
}

describe('OpenAPI: estructura general', () => {
  it('declara OpenAPI 3.0.x, informacion, servidor y esquemas de seguridad', () => {
    assert.match(openApiSpec.openapi, /^3\.0\./);
    assert.equal(openApiSpec.info.title, 'Ecommerce Backend API');
    assert.equal(openApiSpec.info.version, '0.1.0');
    assert.deepEqual(
      openApiSpec.servers.map((server) => server.url),
      ['http://localhost:3000/api/v1'],
    );
    const { bearerAuth, cookieAuth } = openApiSpec.components.securitySchemes;
    assert.deepEqual([bearerAuth.type, bearerAuth.scheme, bearerAuth.bearerFormat], ['http', 'bearer', 'JWT']);
    assert.deepEqual([cookieAuth.type, cookieAuth.in, cookieAuth.name], ['apiKey', 'cookie', 'access_token']);
    assert.match(cookieAuth.description, /\/api\/v1\/auth/);
  });

  it('es inmutable', () => {
    assert.ok(Object.isFrozen(openApiSpec));
    assert.ok(Object.isFrozen(openApiSpec.paths));
    assert.ok(Object.isFrozen(openApiSpec.components.schemas.Error));
  });

  it('declara los grupos de tags requeridos', () => {
    const names = openApiSpec.tags.map((tag) => tag.name);
    for (const required of ['Salud', 'Autenticacion', 'Usuarios', 'Auditoria', 'Tienda', 'Carrito', 'POS', 'Facturas', 'Superusuario']) {
      assert.ok(names.includes(required), `falta el tag ${required}`);
    }
    assert.ok(names.some((name) => name.startsWith('Admin')), 'faltan los tags Admin');
    assert.equal(new Set(names).size, names.length, 'tags duplicados');
  });
});

describe('OpenAPI: cobertura de rutas', () => {
  const registered = listRegisteredRoutes();
  const documented = documentedOperations();

  it('el recorrido de los enrutadores encuentra las rutas esperadas', () => {
    // Salvaguarda de la propia prueba: si el recorrido fallara devolveria una lista vacia.
    assert.ok(registered.length >= 60, `rutas encontradas: ${registered.length}`);
    for (const expected of [
      'GET /health',
      'POST /auth/login',
      'GET /users/{id}',
      'POST /pos/checkout',
      'GET /store/config/public',
      'GET /admin/inventory/losses',
      'PATCH /admin/orders/{id}/reconcile',
      'GET /admin/reports/products/{id}/supplier-performance',
      'DELETE /superuser/purge/{collection}/{id}',
      'GET /docs/openapi.json',
    ]) {
      assert.ok(registered.includes(expected), `no se detecto ${expected}`);
    }
  });

  it('toda ruta registrada esta documentada', () => {
    const missing = registered.filter((route) => !documented.includes(route));
    assert.deepEqual(missing, [], `rutas sin documentar: ${missing.join(', ')}`);
  });

  it('no se documentan rutas que no existen', () => {
    const extra = documented.filter((route) => !registered.includes(route));
    assert.deepEqual(extra, [], `rutas documentadas pero no registradas: ${extra.join(', ')}`);
  });
});

describe('OpenAPI: referencias y operaciones', () => {
  it('todo $ref es local y resuelve', () => {
    const refs = collectRefs(openApiSpec);
    assert.ok(refs.length > 100, `referencias encontradas: ${refs.length}`);
    const broken = refs.filter(({ ref }) => !ref.startsWith('#/') || resolvePointer(ref) === undefined);
    assert.deepEqual(broken, [], `$ref sin resolver: ${JSON.stringify(broken)}`);
  });

  it('el mapping del discriminador del checkout resuelve y cubre los tres metodos', () => {
    const checkout = openApiSpec.components.schemas.CheckoutRequest;
    assert.equal(checkout.discriminator.propertyName, 'paymentMethod');
    assert.deepEqual(Object.keys(checkout.discriminator.mapping).sort(), ['bank_transfer', 'card', 'cash_on_delivery']);
    for (const target of Object.values(checkout.discriminator.mapping)) {
      assert.notEqual(resolvePointer(target), undefined, `mapping sin resolver: ${target}`);
    }
    assert.equal(checkout.oneOf.length, 3);
  });

  it('el checkout no admite datos de tarjeta en claro', () => {
    const { CardPayment } = openApiSpec.components.schemas;
    assert.deepEqual(Object.keys(CardPayment.properties).sort(), ['cardBrand', 'cardHolderName', 'last4', 'paymentToken']);
    assert.equal(CardPayment.additionalProperties, false);
  });

  it('cada operacion tiene resumen, tag declarado, respuesta 2xx y esquema de seguridad valido', () => {
    const declaredTags = new Set(openApiSpec.tags.map((tag) => tag.name));
    const schemes = new Set(Object.keys(openApiSpec.components.securitySchemes));
    const problems = [];

    for (const [path, item] of Object.entries(openApiSpec.paths)) {
      for (const method of HTTP_METHODS.filter((name) => item[name])) {
        const op = item[method];
        const label = `${method.toUpperCase()} ${path}`;
        if (!op.summary) problems.push(`${label}: sin summary`);
        if (!op.description) problems.push(`${label}: sin description`);
        if (!op.tags?.length || !op.tags.every((tag) => declaredTags.has(tag))) problems.push(`${label}: tags invalidos`);
        if (!Object.keys(op.responses ?? {}).some((status) => /^2\d\d$/.test(status))) problems.push(`${label}: sin respuesta 2xx`);
        for (const requirement of op.security ?? []) {
          for (const name of Object.keys(requirement)) if (!schemes.has(name)) problems.push(`${label}: esquema de seguridad ${name} inexistente`);
        }
        // Todo {param} de la ruta debe declararse como parametro de ruta.
        const pathParams = [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
        const declared = (op.parameters ?? []).filter((p) => p.in === 'path').map((p) => p.name);
        for (const name of pathParams) if (!declared.includes(name)) problems.push(`${label}: falta el parametro de ruta ${name}`);
      }
    }
    assert.deepEqual(problems, []);
  });

  it('las rutas autenticadas declaran 401 y las publicas no exigen seguridad', () => {
    const publicOps = new Set([
      'GET /health',
      'GET /docs/openapi.json',
      'POST /auth/register',
      'POST /auth/login',
      'POST /auth/refresh',
      'GET /store/products',
      'GET /store/products/{id}',
      'GET /store/config/public',
    ]);
    const problems = [];
    for (const [path, item] of Object.entries(openApiSpec.paths)) {
      for (const method of HTTP_METHODS.filter((name) => item[name])) {
        const op = item[method];
        const label = `${method.toUpperCase()} ${path}`;
        if (publicOps.has(label)) {
          if (!Array.isArray(op.security) || op.security.length > 0) problems.push(`${label}: deberia ser publica`);
        } else {
          if (op.security?.length !== 2) problems.push(`${label}: deberia exigir bearerAuth o cookieAuth`);
          if (!op.responses['401']) problems.push(`${label}: sin respuesta 401`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });
});
