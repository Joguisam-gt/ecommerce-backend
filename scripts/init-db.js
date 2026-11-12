/**
 * Script: npm run db:init
 *
 * Crea o actualiza las 7 colecciones con sus validadores $jsonSchema e indices.
 * Es idempotente: puede ejecutarse tantas veces como se quiera (por ejemplo en CI/CD).
 */
import { database } from '../src/config/database.js';
import { loadConfig } from '../src/config/env.js';
import { ensureCollections } from '../src/database/setup.js';
import { createLogger } from '../src/utils/logger.js';

const config = loadConfig();
const logger = createLogger({ level: 'info' });

try {
  const db = await database.connect(config.mongo);
  const summary = await ensureCollections(db, undefined, logger);
  logger.info('Inicializacion completada', summary);
} catch (error) {
  logger.error('Fallo la inicializacion de la base de datos', { error: error.message });
  process.exitCode = 1;
} finally {
  await database.close();
}
