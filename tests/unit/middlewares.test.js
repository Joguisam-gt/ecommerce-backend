/**
 * Pruebas de los middlewares: authenticate, authorize, validate, sanitizeInput y errorHandler.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { ROLES } from '../../src/constants/roles.js';
import { createAuthenticate, extractAccessToken } from '../../src/middlewares/authenticate.js';
import { authorize, requireRoles } from '../../src/middlewares/authorize.js';
import { createErrorHandler } from '../../src/middlewares/error-handler.js';
import { findForbiddenKey, sanitizeInput } from '../../src/middlewares/sanitize-input.js';
import { validate } from '../../src/middlewares/validate.js';
import { HttpError } from '../../src/utils/http-error.js';
import { silentLogger } from '../../src/utils/logger.js';
import { registerSchema } from '../../src/validators/auth.validator.js';
import { makeDeps, makeUser } from '../helpers/fixtures.js';

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

/** Respuesta falsa que captura estado y cuerpo. */
function fakeResponse() {
  return {
    headersSent: false,
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('extractAccessToken', () => {
  it('prioriza la cookie y acepta Bearer como alternativa', () => {
    assert.equal(extractAccessToken({ cookies: { access_token: 'c' }, headers: { authorization: 'Bearer h' } }), 'c');
    assert.equal(extractAccessToken({ cookies: {}, headers: { authorization: 'Bearer h' } }), 'h');
    assert.equal(extractAccessToken({ cookies: {}, headers: { authorization: 'Basic abc' } }), null);
  });
});

describe('authenticate', () => {
  const user = makeUser({ role: ROLES.ADMIN });
  const deps = makeDeps([user]);
  const authenticate = createAuthenticate(deps);

  it('adjunta req.user con el rol leido de la base de datos', async () => {
    const req = { cookies: { access_token: deps.tokenService.signAccessToken({ ...user, role: ROLES.USER }) }, headers: {} };
    let called = false;
    await authenticate(req, {}, () => {
      called = true;
    });
    assert.ok(called);
    assert.deepEqual(req.user, { id: user._id.toString(), role: ROLES.ADMIN, email: user.email });
  });

  it('rechaza peticiones sin token', async () => {
    await assert.rejects(authenticate({ cookies: {}, headers: {} }, {}, () => {}), { status: 401, code: 'AUTH_REQUIRED' });
  });

  it('rechaza tokens revocados (tokenVersion distinto)', async () => {
    const token = deps.tokenService.signAccessToken(user);
    await deps.userRepository.incrementTokenVersion(user._id);
    await assert.rejects(authenticate({ cookies: { access_token: token }, headers: {} }, {}, () => {}), {
      code: 'SESSION_REVOKED',
    });
  });

  it('rechaza usuarios desactivados', async () => {
    const inactive = makeUser({ isActive: false });
    const local = makeDeps([inactive]);
    const token = local.tokenService.signAccessToken(inactive);
    await assert.rejects(createAuthenticate(local)({ cookies: { access_token: token }, headers: {} }, {}, () => {}), {
      status: 401,
    });
  });
});

describe('authorize / requireRoles', () => {
  it('permite cuando el rol tiene el permiso', () => {
    assert.equal(run(authorize(PERMISSIONS.USERS_READ), { user: { role: ROLES.ADMIN } }), undefined);
  });

  it('niega con 403 cuando falta el permiso', () => {
    const error = run(authorize(PERMISSIONS.AUDIT_READ), { user: { role: ROLES.ADMIN } });
    assert.equal(error.status, 403);
  });

  it('exige todos los permisos indicados', () => {
    const error = run(authorize(PERMISSIONS.USERS_READ, PERMISSIONS.USERS_DELETE), { user: { role: ROLES.ADMIN } });
    assert.equal(error.status, 403);
  });

  it('responde 401 si no hay usuario autenticado', () => {
    assert.equal(run(authorize(PERMISSIONS.PROFILE_READ), {}).status, 401);
  });

  it('requireRoles acepta cualquiera de los roles indicados', () => {
    assert.equal(run(requireRoles(ROLES.SUPERUSER, ROLES.ADMIN), { user: { role: ROLES.ADMIN } }), undefined);
    assert.equal(run(requireRoles(ROLES.SUPERUSER), { user: { role: ROLES.ADMIN } }).status, 403);
  });

  it('falla al configurarse sin permisos', () => {
    assert.throws(() => authorize(), /al menos un permiso/);
  });
});

describe('validate', () => {
  it('pasa con datos validos y responde 400 con detalles si no', () => {
    const middleware = validate(registerSchema);
    const ok = run(middleware, { body: { email: 'a@b.co', password: 'Segura123', firstName: 'A', lastName: 'B' } });
    assert.equal(ok, undefined);

    const error = run(middleware, { body: { email: 'mal' } });
    assert.equal(error.status, 400);
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(error.details));
  });
});

describe('sanitizeInput', () => {
  it('detecta operadores y claves con punto en cualquier nivel', () => {
    assert.equal(findForbiddenKey({ a: { b: [{ $where: '1' }] } }), '$where');
    assert.equal(findForbiddenKey({ 'profile.role': 'admin' }), 'profile.role');
    assert.equal(findForbiddenKey({ email: 'a@b.co' }), null);
  });

  it('bloquea la peticion con 400', () => {
    const error = run(sanitizeInput, { body: { email: { $gt: '' } }, query: {} });
    assert.equal(error.code, 'FORBIDDEN_KEYS');
  });
});

describe('errorHandler', () => {
  const handler = createErrorHandler({ logger: silentLogger, isProduction: true });

  it('traduce HttpError', () => {
    const res = fakeResponse();
    handler(HttpError.forbidden('No', 'X'), { path: '/' }, res, () => {});
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: { code: 'X', message: 'No' } });
  });

  it('traduce clave duplicada de MongoDB a 409', () => {
    const res = fakeResponse();
    handler({ code: 11000, keyValue: { email: 'a@b.co' } }, { path: '/' }, res, () => {});
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body.error.details, { fields: ['email'] });
  });

  it('oculta el mensaje interno en produccion', () => {
    const res = fakeResponse();
    handler(new Error('detalle interno sensible'), { path: '/', method: 'GET' }, res, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.message, 'Error interno del servidor');
  });
});
