/**
 * Raiz de composicion (inyeccion de dependencias manual).
 *
 * Es el unico lugar donde se instancian las clases concretas y se conectan
 * entre si. Las capas solo conocen las dependencias que reciben en su
 * constructor, lo que permite sustituir repositorios por dobles en memoria
 * en las pruebas (parametro "repositories").
 */
import { AuditLogController } from './controllers/audit-log.controller.js';
import { AuthController } from './controllers/auth.controller.js';
import { HealthController } from './controllers/health.controller.js';
import { UserController } from './controllers/user.controller.js';
import { createAuthenticate } from './middlewares/authenticate.js';
import { AuditLogRepository } from './repositories/audit-log.repository.js';
import { UserRepository } from './repositories/user.repository.js';
import { AuditService } from './services/audit.service.js';
import { AuthService } from './services/auth.service.js';
import { PasswordService } from './services/password.service.js';
import { TokenService } from './services/token.service.js';
import { UserService } from './services/user.service.js';
import { AuthCookieManager } from './utils/auth-cookies.js';

/**
 * @param {{ db?: import('mongodb').Db, config: object, logger: object,
 *           pingDatabase?: () => Promise<boolean>,
 *           repositories?: { userRepository?: object, auditLogRepository?: object },
 *           clock?: () => Date }} options
 */
export function buildContainer({ db, config, logger, pingDatabase = async () => true, repositories = {}, clock }) {
  const userRepository = repositories.userRepository ?? new UserRepository(db);
  const auditLogRepository = repositories.auditLogRepository ?? new AuditLogRepository(db);

  const passwordService = new PasswordService(config.bcrypt);
  const tokenService = new TokenService(config.jwt);
  const auditService = new AuditService({ auditLogRepository, logger, clock });
  const authService = new AuthService({
    userRepository,
    passwordService,
    tokenService,
    auditService,
    securityConfig: config.security,
    clock,
  });
  const userService = new UserService({ userRepository, passwordService, auditService, clock });
  const authCookies = new AuthCookieManager({ cookieConfig: config.cookies, jwtConfig: config.jwt });

  return Object.freeze({
    services: { authService, userService, auditService, tokenService, passwordService },
    controllers: {
      health: new HealthController({ pingDatabase }),
      auth: new AuthController({ authService, authCookies }),
      user: new UserController({ userService }),
      auditLog: new AuditLogController({ auditService }),
    },
    middlewares: {
      authenticate: createAuthenticate({ tokenService, userRepository }),
    },
  });
}
