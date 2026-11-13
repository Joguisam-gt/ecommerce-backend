/**
 * Raiz de composicion del modulo exclusivo de superusuario (Fase 4).
 *
 * Igual que admin.container.js: recibe las dependencias transversales ya
 * construidas (repositorio de usuarios, secuencias, ejecutor de transacciones,
 * auditoria y contrasenas) y devuelve servicios, controladores y el
 * middleware de mantenimiento. Los repositorios propios del modulo se
 * resuelven con "pick", por lo que cualquiera puede sustituirse por un doble
 * en pruebas mediante "repositories" (misma clave).
 */
import { StoreConfigController } from './controllers/store-config.controller.js';
import { SuperuserAuditLogController } from './controllers/superuser-audit-log.controller.js';
import { SuperuserPurgeController } from './controllers/superuser-purge.controller.js';
import { SuperuserSettingsController } from './controllers/superuser-settings.controller.js';
import { SuperuserStaffController } from './controllers/superuser-staff.controller.js';
import { createMaintenanceGuard } from './middlewares/maintenance-guard.js';
import { FiscalReferenceRepository } from './repositories/fiscal-reference.repository.js';
import { PurgeRepository } from './repositories/purge.repository.js';
import { SystemSettingsRepository } from './repositories/system-settings.repository.js';
import { PurgeService } from './services/purge.service.js';
import { SettingsService } from './services/settings.service.js';
import { StaffService } from './services/staff.service.js';

/** Repositorios propios del modulo: clave del contenedor -> clase concreta. */
const SUPERUSER_REPOSITORY_CLASSES = Object.freeze({
  systemSettingsRepository: SystemSettingsRepository,
  purgeRepository: PurgeRepository,
  fiscalReferenceRepository: FiscalReferenceRepository,
});

/**
 * Construye servicios, controladores y middlewares del modulo de superusuario.
 * @param {{ pick: (name: string, Factory: Function) => object,
 *           userRepository: object, sequenceRepository: object,
 *           transactionRunner: { run: Function },
 *           auditService: import('./services/audit.service.js').AuditService,
 *           passwordService: import('./services/password.service.js').PasswordService,
 *           clock?: () => Date }} deps
 * @returns {{ services: Record<string, object>,
 *             controllers: { superuser: Record<string, object>, storeConfig: StoreConfigController },
 *             middlewares: { maintenanceGuard: import('express').RequestHandler } }}
 */
export function buildSuperuserModule({ pick, userRepository, sequenceRepository, transactionRunner, auditService, passwordService, clock }) {
  const repos = Object.fromEntries(
    Object.entries(SUPERUSER_REPOSITORY_CLASSES).map(([name, Factory]) => [name, pick(name, Factory)]),
  );

  // Dependencias comunes a los servicios transaccionales del modulo.
  const shared = { transactionRunner, auditService, clock };

  const staffService = new StaffService({ userRepository, passwordService, sequenceRepository, ...shared });
  const settingsService = new SettingsService({ systemSettingsRepository: repos.systemSettingsRepository, ...shared });
  const purgeService = new PurgeService({
    purgeRepository: repos.purgeRepository,
    fiscalReferenceRepository: repos.fiscalReferenceRepository,
    ...shared,
  });

  return {
    services: { staffService, settingsService, purgeService },
    controllers: {
      superuser: {
        staff: new SuperuserStaffController({ staffService }),
        settings: new SuperuserSettingsController({ settingsService }),
        auditLog: new SuperuserAuditLogController({ auditService }),
        purge: new SuperuserPurgeController({ purgeService }),
      },
      storeConfig: new StoreConfigController({ settingsService }),
    },
    middlewares: { maintenanceGuard: createMaintenanceGuard({ settingsService }) },
  };
}
