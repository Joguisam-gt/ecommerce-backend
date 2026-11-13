/**
 * Script: npm run db:init
 *
 * Crea o actualiza todas las colecciones (ver database/schemas/index.js) con
 * sus validadores $jsonSchema e indices. Fase 4: crea ademas el documento de
 * configuracion global 'global_config' con los valores por defecto si aun no
 * existe (nunca sobrescribe una configuracion ya guardada).
 * Es idempotente: puede ejecutarse tantas veces como se quiera (por ejemplo en CI/CD).
 */
import { database } from '../src/config/database.js';
import { loadConfig } from '../src/config/env.js';
import { SETTINGS_DEFAULTS } from '../src/constants/settings.js';
import { ensureCollections } from '../src/database/setup.js';
import { SystemSettingsRepository } from '../src/repositories/system-settings.repository.js';
import { createLogger } from '../src/utils/logger.js';

const config = loadConfig();
const logger = createLogger({ level: 'info' });

try {
  const db = await database.connect(config.mongo);
  const summary = await ensureCollections(db, undefined, logger);

  // Configuracion global por defecto (solo si no existe: $setOnInsert con upsert).
  const settingsCreated = await new SystemSettingsRepository(db).ensureGlobal({
    ...SETTINGS_DEFAULTS,
    companyBankAccounts: [...SETTINGS_DEFAULTS.companyBankAccounts],
    updatedAt: new Date(),
    updatedBy: null,
  });

  logger.info('Inicializacion completada', { ...summary, settingsCreated });
} catch (error) {
  logger.error('Fallo la inicializacion de la base de datos', { error: error.message });
  process.exitCode = 1;
} finally {
  await database.close();
}
