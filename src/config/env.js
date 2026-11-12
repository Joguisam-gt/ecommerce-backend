/**
 * Modulo de configuracion de la aplicacion.
 *
 * Es el unico punto que lee process.env. Aplica valores por defecto, valida las
 * variables obligatorias y devuelve un objeto inmutable. El resto de capas
 * reciben la configuracion por inyeccion de dependencias, lo que permite
 * probarlas sin depender del entorno real.
 */

/** Longitud minima exigida a los secretos JWT (256 bits en ASCII). */
const MIN_SECRET_LENGTH = 32;

/** Valores admitidos por el atributo SameSite de las cookies. */
const SAME_SITE_VALUES = ['strict', 'lax', 'none'];

/**
 * Convierte una cadena en entero no negativo; si no es valida, devuelve el valor por defecto.
 * @param {string | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function toInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Convierte una cadena en booleano ("true", "1", "yes").
 * @param {string | undefined} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function toBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['true', '1', 'yes'].includes(String(value).toLowerCase());
}

/**
 * Convierte una lista separada por comas en un arreglo sin espacios ni vacios.
 * @param {string | undefined} value
 * @returns {string[]}
 */
function toList(value) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Congela un objeto de forma recursiva para impedir mutaciones accidentales.
 * @template T
 * @param {T} target
 * @returns {Readonly<T>}
 */
function deepFreeze(target) {
  for (const value of Object.values(target)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value);
  }
  return Object.freeze(target);
}

/**
 * Comprueba las variables obligatorias y las reglas de seguridad de los secretos.
 * @param {Record<string, string | undefined>} env
 * @returns {string[]} Lista de errores encontrados.
 */
function collectErrors(env) {
  const errors = [];
  const required = ['MONGODB_URI', 'MONGODB_DB_NAME', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

  for (const key of required) {
    if (!env[key]) errors.push(`Falta la variable de entorno ${key}`);
  }

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (env[key] && env[key].length < MIN_SECRET_LENGTH) {
      errors.push(`${key} debe tener al menos ${MIN_SECRET_LENGTH} caracteres`);
    }
  }

  if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    errors.push('JWT_ACCESS_SECRET y JWT_REFRESH_SECRET deben ser distintos');
  }

  const sameSite = (env.COOKIE_SAME_SITE ?? 'strict').toLowerCase();
  if (!SAME_SITE_VALUES.includes(sameSite)) {
    errors.push(`COOKIE_SAME_SITE debe ser uno de: ${SAME_SITE_VALUES.join(', ')}`);
  }

  return errors;
}

/**
 * Construye la configuracion validada de la aplicacion.
 * @param {Record<string, string | undefined>} [env=process.env] Fuente de variables (inyectable en pruebas).
 * @returns {Readonly<object>} Configuracion inmutable.
 * @throws {Error} Si falta alguna variable obligatoria o algun valor es inseguro.
 */
export function loadConfig(env = process.env) {
  const errors = collectErrors(env);
  if (errors.length > 0) {
    throw new Error(`Configuracion invalida:\n- ${errors.join('\n- ')}`);
  }

  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const sameSite = (env.COOKIE_SAME_SITE ?? 'strict').toLowerCase();

  return deepFreeze({
    nodeEnv,
    isProduction,
    logLevel: env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
    server: {
      port: toInt(env.PORT, 3000),
      trustProxy: toInt(env.TRUST_PROXY, 0),
      bodyLimit: env.BODY_LIMIT ?? '100kb',
    },
    mongo: {
      uri: env.MONGODB_URI,
      dbName: env.MONGODB_DB_NAME,
      maxPoolSize: toInt(env.MONGODB_MAX_POOL_SIZE, 20),
      serverSelectionTimeoutMS: toInt(env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 5000),
      syncSchemaOnStart: toBool(env.DB_SYNC_ON_START, true),
    },
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtlSeconds: toInt(env.JWT_ACCESS_TTL_SECONDS, 15 * 60),
      refreshTtlSeconds: toInt(env.JWT_REFRESH_TTL_SECONDS, 7 * 24 * 60 * 60),
      issuer: env.JWT_ISSUER ?? 'ecommerce-backend',
      audience: env.JWT_AUDIENCE ?? 'ecommerce-clients',
    },
    bcrypt: {
      saltRounds: toInt(env.BCRYPT_SALT_ROUNDS, 12),
    },
    cors: {
      origins: toList(env.CORS_ORIGINS),
    },
    cookies: {
      secure: toBool(env.COOKIE_SECURE, isProduction),
      sameSite,
      domain: env.COOKIE_DOMAIN || undefined,
    },
    security: {
      maxLoginAttempts: toInt(env.MAX_LOGIN_ATTEMPTS, 5),
      lockTimeMs: toInt(env.LOCK_TIME_MINUTES, 15) * 60 * 1000,
    },
  });
}
