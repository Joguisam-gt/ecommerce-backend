/**
 * Raiz de composicion (inyeccion de dependencias manual).
 *
 * Es el unico lugar donde se instancian las clases concretas y se conectan
 * entre si. Las capas solo conocen las dependencias que reciben en su
 * constructor, lo que permite sustituir repositorios, la pasarela de pago o el
 * ejecutor de transacciones por dobles en las pruebas (parametro "overrides").
 */
import { buildAdminModule } from './admin.container.js';
import { buildSuperuserModule } from './superuser.container.js';
import { AuditLogController } from './controllers/audit-log.controller.js';
import { AuthController } from './controllers/auth.controller.js';
import { CartController } from './controllers/cart.controller.js';
import { HealthController } from './controllers/health.controller.js';
import { InvoiceController } from './controllers/invoice.controller.js';
import { PosController } from './controllers/pos.controller.js';
import { StoreController } from './controllers/store.controller.js';
import { UserController } from './controllers/user.controller.js';
import { MongoTransactionRunner } from './database/transaction-runner.js';
import { createAuthenticate } from './middlewares/authenticate.js';
import { AuditLogRepository } from './repositories/audit-log.repository.js';
import { CartRepository } from './repositories/cart.repository.js';
import { CouponRepository } from './repositories/coupon.repository.js';
import { InvoiceRepository } from './repositories/invoice.repository.js';
import { OrderRepository } from './repositories/order.repository.js';
import { ProductRepository } from './repositories/product.repository.js';
import { SequenceRepository } from './repositories/sequence.repository.js';
import { UserRepository } from './repositories/user.repository.js';
import { AuditService } from './services/audit.service.js';
import { AuthService } from './services/auth.service.js';
import { CartPricingService } from './services/cart-pricing.service.js';
import { CartService } from './services/cart.service.js';
import { CheckoutService } from './services/checkout.service.js';
import { InvoiceService } from './services/invoice.service.js';
import { PasswordService } from './services/password.service.js';
import { createPaymentGateway } from './services/payments/payment-gateway.js';
import { StoreService } from './services/store.service.js';
import { TokenService } from './services/token.service.js';
import { UserService } from './services/user.service.js';
import { AuthCookieManager } from './utils/auth-cookies.js';

/**
 * Marcador para una dependencia no configurada (por ejemplo, en pruebas sin base
 * de datos): no falla al construir el contenedor, sino al usarse, con un mensaje claro.
 * @param {string} name
 */
function unavailable(name) {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'then') return undefined;
        return () => {
          throw new Error(`Dependencia no configurada: ${name}.${String(property)}`);
        };
      },
    },
  );
}

/**
 * Politica de resolucion de repositorios: el doble inyectado, el repositorio
 * real si hay base de datos o un marcador "no disponible" en otro caso.
 * @param {import('mongodb').Db | undefined} db
 * @param {Record<string, object>} repositories
 * @returns {(name: string, Factory: Function) => object}
 */
function makeRepositoryPicker(db, repositories) {
  return (name, Factory) => repositories[name] ?? (db ? new Factory(db) : unavailable(name));
}

/**
 * Crea los repositorios de las Fases 1 y 2, permitiendo sustituir cualquiera de ellos.
 * @param {(name: string, Factory: Function) => object} pick
 */
function buildRepositories(pick) {
  return {
    userRepository: pick('userRepository', UserRepository),
    auditLogRepository: pick('auditLogRepository', AuditLogRepository),
    productRepository: pick('productRepository', ProductRepository),
    cartRepository: pick('cartRepository', CartRepository),
    couponRepository: pick('couponRepository', CouponRepository),
    orderRepository: pick('orderRepository', OrderRepository),
    invoiceRepository: pick('invoiceRepository', InvoiceRepository),
    sequenceRepository: pick('sequenceRepository', SequenceRepository),
  };
}

/**
 * @param {{ db?: import('mongodb').Db, mongoClient?: import('mongodb').MongoClient, config: object, logger: object,
 *           pingDatabase?: () => Promise<boolean>, repositories?: Record<string, object>,
 *           transactionRunner?: { run: Function }, paymentGateway?: object, clock?: () => Date }} options
 */
export function buildContainer({
  db,
  mongoClient,
  config,
  logger,
  pingDatabase = async () => true,
  repositories = {},
  transactionRunner,
  paymentGateway,
  clock,
}) {
  const pick = makeRepositoryPicker(db, repositories);
  const repos = buildRepositories(pick);
  const transactions =
    transactionRunner ?? (mongoClient ? new MongoTransactionRunner(mongoClient) : unavailable('transactionRunner'));

  // Servicios transversales.
  const passwordService = new PasswordService(config.bcrypt);
  const tokenService = new TokenService(config.jwt);
  const auditService = new AuditService({ auditLogRepository: repos.auditLogRepository, logger, clock });
  const authCookies = new AuthCookieManager({ cookieConfig: config.cookies, jwtConfig: config.jwt });

  // Fase 1.
  const authService = new AuthService({ ...repos, passwordService, tokenService, auditService, securityConfig: config.security, clock });

  // Fase 2.
  const cartPricingService = new CartPricingService({
    productRepository: repos.productRepository,
    couponRepository: repos.couponRepository,
    couponUsageCounter: (userId, couponId, options) => repos.orderRepository.countByUserAndCoupon(userId, couponId, options),
    clock,
  });
  const storeService = new StoreService({ productRepository: repos.productRepository, storeConfig: config.store, clock });
  const cartService = new CartService({ ...repos, cartPricingService, clock });
  const checkoutService = new CheckoutService({
    ...repos,
    cartPricingService,
    paymentGateway: paymentGateway ?? createPaymentGateway(config.payments),
    transactionRunner: transactions,
    auditService,
    storeConfig: config.store,
    logger,
    clock,
  });
  const invoiceService = new InvoiceService({ invoiceRepository: repos.invoiceRepository });

  // Fase 3: panel de administracion (comparte auditoria, secuencias y transacciones).
  const admin = buildAdminModule({
    pick,
    sequenceRepository: repos.sequenceRepository,
    transactionRunner: transactions,
    auditService,
    storeConfig: config.store,
    clock,
  });

  // Fase 4: modulo exclusivo de superusuario (personal, configuracion, auditoria y purga).
  const superuser = buildSuperuserModule({
    pick,
    userRepository: repos.userRepository,
    sequenceRepository: repos.sequenceRepository,
    transactionRunner: transactions,
    auditService,
    passwordService,
    clock,
  });

  // Fase 1 (gestion de usuarios): se construye despues del modulo de
  // superusuario porque reutiliza su ruta transaccional. Cambios de rol y
  // estado van por StaffService (centinela anti write skew) y el borrado fisico
  // por PurgeService. La dependencia es unidireccional (sin ciclos).
  const userService = new UserService({
    ...repos,
    passwordService,
    auditService,
    staffService: superuser.services.staffService,
    purgeService: superuser.services.purgeService,
    clock,
  });

  return Object.freeze({
    services: {
      authService,
      userService,
      auditService,
      tokenService,
      passwordService,
      storeService,
      cartService,
      checkoutService,
      invoiceService,
      ...admin.services,
      ...superuser.services,
    },
    controllers: {
      health: new HealthController({ pingDatabase }),
      auth: new AuthController({ authService, authCookies }),
      user: new UserController({ userService }),
      auditLog: new AuditLogController({ auditService }),
      store: new StoreController({ storeService, storeConfig: config.store }),
      cart: new CartController({ cartService, storeConfig: config.store }),
      pos: new PosController({ checkoutService }),
      invoice: new InvoiceController({ invoiceService }),
      admin: admin.controllers,
      superuser: superuser.controllers.superuser,
      storeConfig: superuser.controllers.storeConfig,
    },
    middlewares: {
      authenticate: createAuthenticate({ tokenService, userRepository: repos.userRepository }),
      maintenanceGuard: superuser.middlewares.maintenanceGuard,
    },
  });
}
