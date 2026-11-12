/**
 * Pruebas de TokenService (JWT) y PasswordService (bcrypt).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { PasswordService } from '../../src/services/password.service.js';
import { TokenService } from '../../src/services/token.service.js';
import { makeUser, testConfig } from '../helpers/fixtures.js';

describe('TokenService', () => {
  const service = new TokenService(testConfig.jwt);
  const user = makeUser({ tokenVersion: 3 });

  it('emite y verifica un par de tokens', () => {
    const { accessToken, refreshToken, expiresIn } = service.issueTokenPair(user);
    const access = service.verifyAccessToken(accessToken);
    const refresh = service.verifyRefreshToken(refreshToken);

    assert.equal(access.sub, user._id.toString());
    assert.equal(access.tv, 3);
    assert.equal(access.type, 'access');
    assert.equal(refresh.type, 'refresh');
    assert.equal(expiresIn, 900);
  });

  it('no acepta un refresh token como access token ni al reves', () => {
    const { accessToken, refreshToken } = service.issueTokenPair(user);
    assert.throws(() => service.verifyAccessToken(refreshToken), { status: 401, code: 'INVALID_TOKEN' });
    assert.throws(() => service.verifyRefreshToken(accessToken), { status: 401, code: 'INVALID_TOKEN' });
  });

  it('rechaza tokens manipulados', () => {
    const token = service.signAccessToken(user);
    const [header, payload, signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), role: 'superuser' })).toString('base64url');
    assert.throws(() => service.verifyAccessToken(`${header}.${forgedPayload}.${signature}`), { code: 'INVALID_TOKEN' });
  });

  it('rechaza el algoritmo "none"', () => {
    const unsigned = jwt.sign({ type: 'access', tv: 0 }, null, {
      algorithm: 'none',
      subject: user._id.toString(),
      issuer: testConfig.jwt.issuer,
      audience: testConfig.jwt.audience,
    });
    assert.throws(() => service.verifyAccessToken(unsigned), { code: 'INVALID_TOKEN' });
  });

  it('distingue tokens expirados', () => {
    const expired = new TokenService({ ...testConfig.jwt, accessTtlSeconds: -10 }).signAccessToken(user);
    assert.throws(() => service.verifyAccessToken(expired), { status: 401, code: 'TOKEN_EXPIRED' });
  });

  it('rechaza otra audiencia', () => {
    const other = new TokenService({ ...testConfig.jwt, audience: 'otra-app' }).signAccessToken(user);
    assert.throws(() => service.verifyAccessToken(other), { code: 'INVALID_TOKEN' });
  });
});

describe('PasswordService', () => {
  const service = new PasswordService({ saltRounds: 4 });

  it('genera hashes bcrypt de 60 caracteres con sal distinta', async () => {
    const first = await service.hash('Segura123');
    const second = await service.hash('Segura123');
    assert.equal(first.length, 60);
    assert.notEqual(first, second);
  });

  it('compara correctamente', async () => {
    const hash = await service.hash('Segura123');
    assert.equal(await service.compare('Segura123', hash), true);
    assert.equal(await service.compare('Otra1234', hash), false);
  });

  it('compareWithDummy siempre devuelve false', async () => {
    assert.equal(await service.compareWithDummy('loquesea'), false);
  });
});
