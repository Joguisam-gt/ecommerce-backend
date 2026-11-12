/**
 * Datos y fabricas compartidas por las pruebas.
 *
 * Usa un coste de bcrypt bajo (4) para que las pruebas sean rapidas; el valor
 * de produccion (12) se define en la configuracion real.
 */
import { ObjectId } from 'mongodb';
import { loadConfig } from '../../src/config/env.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditService } from '../../src/services/audit.service.js';
import { PasswordService } from '../../src/services/password.service.js';
import { TokenService } from '../../src/services/token.service.js';
import { buildUserDocument } from '../../src/services/user-document.factory.js';
import { silentLogger } from '../../src/utils/logger.js';
import { InMemoryAuditLogRepository, InMemoryUserRepository } from './in-memory-repositories.js';

/** Contrasena valida segun la politica, usada por los usuarios de prueba. */
export const TEST_PASSWORD = 'Secreta123';

/** Variables de entorno minimas y validas para loadConfig. */
export const TEST_ENV = Object.freeze({
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://localhost:27017',
  MONGODB_DB_NAME: 'ecommerce_test',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  BCRYPT_SALT_ROUNDS: '4',
  CORS_ORIGINS: 'http://localhost:5173',
});

/** Configuracion completa de prueba. */
export const testConfig = loadConfig(TEST_ENV);

/** Hash precalculado de TEST_PASSWORD (coste 4). */
const passwordService = new PasswordService({ saltRounds: 4 });
export const TEST_PASSWORD_HASH = await passwordService.hash(TEST_PASSWORD);

/**
 * Crea un documento de usuario completo con _id.
 * @param {Partial<object>} overrides
 */
export function makeUser(overrides = {}) {
  const role = overrides.role ?? ROLES.USER;
  return {
    ...buildUserDocument(
      {
        email: `${role}-${new ObjectId().toString().slice(-6)}@example.com`,
        passwordHash: TEST_PASSWORD_HASH,
        firstName: 'Ana',
        lastName: 'Perez',
        role,
      },
      new Date('2026-01-01T00:00:00Z'),
    ),
    _id: new ObjectId(),
    ...overrides,
  };
}

/**
 * Representacion de req.user a partir de un documento.
 * @param {{ _id: ObjectId, role: string, email: string }} user
 */
export const actorOf = (user) => ({ id: user._id.toString(), role: user.role, email: user.email });

/**
 * Construye todas las dependencias de los servicios con dobles en memoria.
 * @param {object[]} [seedUsers]
 * @param {{ clock?: () => Date }} [options]
 */
export function makeDeps(seedUsers = [], { clock } = {}) {
  const userRepository = new InMemoryUserRepository(seedUsers);
  const auditLogRepository = new InMemoryAuditLogRepository();
  const auditService = new AuditService({ auditLogRepository, logger: silentLogger, clock });
  const tokenService = new TokenService(testConfig.jwt);
  return { userRepository, auditLogRepository, auditService, tokenService, passwordService, clock };
}
