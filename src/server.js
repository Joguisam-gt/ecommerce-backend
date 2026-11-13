/**
 * Punto de entrada del proceso.
 *
 * Secuencia de arranque: cargar configuracion -> conectar a MongoDB (Singleton)
 * -> sincronizar esquema e indices -> componer dependencias -> escuchar.
 * Incluye apagado ordenado ante SIGINT/SIGTERM para no cortar peticiones en curso.
 */
import { createApp } from './app.js';
import { database } from './config/database.js';
import { loadConfig } from './config/env.js';
import { buildContainer } from './container.js';
import { ensureCollections } from './database/setup.js';
import { createLogger } from './utils/logger.js';

/** Tiempo maximo de espera para cerrar conexiones antes de forzar la salida. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Arranca el servidor HTTP.
 * @returns {Promise<void>}
 */
async function bootstrap() {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });

  const db = await database.connect(config.mongo);
  logger.info('Conectado a MongoDB', { dbName: config.mongo.dbName });

  if (config.mongo.syncSchemaOnStart) {
    await ensureCollections(db, undefined, logger);
  }

  const container = buildContainer({
    db,
    mongoClient: database.getClient(),
    config,
    logger,
    pingDatabase: () => database.ping(),
  });
  const app = createApp({ config, container, logger });

  const server = app.listen(config.server.port, () => {
    logger.info('Servidor HTTP escuchando', { port: config.server.port, env: config.nodeEnv });
  });

  /**
   * Cierra el servidor y la conexion a la base de datos.
   * @param {string} signal
   */
  const shutdown = (signal) => {
    logger.info('Apagando servidor', { signal });
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    server.close(async () => {
      await database.close();
      logger.info('Servidor detenido correctamente');
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

bootstrap().catch((error) => {
  process.stderr.write(`Error fatal durante el arranque: ${error.message}\n`);
  process.exit(1);
});
