/**
 * Logger estructurado minimo (JSON por linea) sin dependencias externas.
 *
 * Escribe en stdout/stderr con un nivel minimo configurable. Las capas lo
 * reciben por inyeccion, por lo que en pruebas se sustituye por silentLogger.
 */

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

/**
 * Crea un logger con nivel minimo.
 * @param {{ level?: keyof typeof LEVELS }} [options]
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
export function createLogger({ level = 'info' } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  /**
   * Genera la funcion de log para un nivel concreto.
   * @param {keyof typeof LEVELS} name
   */
  const write = (name) => (message, context = {}) => {
    if (LEVELS[name] < threshold) return;
    const line = JSON.stringify({ level: name, time: new Date().toISOString(), message, ...context });
    if (LEVELS[name] >= LEVELS.warn) process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };

  return Object.freeze({
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
  });
}

/** Logger que descarta todo; util en pruebas. */
export const silentLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {},
});
