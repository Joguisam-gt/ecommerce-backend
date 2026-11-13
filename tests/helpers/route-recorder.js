/**
 * Utilidades para inspeccionar las rutas registradas en Express sin tocar sus
 * estructuras internas.
 *
 * En lugar de recorrer el "stack" privado de Express 5 (cuyas capas ya no
 * conservan la ruta de montaje), se envuelve temporalmente la API publica de
 * Router (get, post, patch, delete, put y use) mientras se construye el
 * enrutador. Cada llamada se registra por router y despues se reconstruye el
 * arbol de montaje, de forma que se obtienen las rutas completas
 * (por ejemplo "PATCH /admin/orders/{id}/reconcile").
 */
import { Router } from 'express';
import { createApiRouter } from '../../src/routes/index.js';

/** Metodos HTTP que registra la API. */
const HTTP_METHODS = Object.freeze(['get', 'post', 'put', 'patch', 'delete']);

/**
 * Doble "comodin": una funcion invocable cuyas propiedades son otros dobles.
 * Sirve como controlador o middleware de cualquier ruta (nunca se ejecuta).
 * @returns {Function}
 */
export function stub() {
  const target = function stubHandler() {};
  return new Proxy(target, {
    get: (fn, prop) => (prop in fn || typeof prop === 'symbol' ? fn[prop] : stub()),
  });
}

/** Contenedor de pruebas con todos los modulos montados y manejadores inertes. */
export function stubContainer() {
  return {
    controllers: new Proxy({}, { get: (_target, prop) => (typeof prop === 'symbol' ? undefined : stub()) }),
    middlewares: { authenticate: stub(), maintenanceGuard: stub() },
  };
}

/**
 * Convierte la ruta de Express (:id) al formato OpenAPI ({id}).
 * @param {string} path
 */
export const toOpenApiPath = (path) => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/**
 * Une un prefijo de montaje y una ruta relativa.
 * @param {string} prefix
 * @param {string} path
 */
function join(prefix, path) {
  const joined = `${prefix}${path === '/' ? '' : path}`;
  return joined === '' ? '/' : joined.replace(/\/+$/, '') || '/';
}

/**
 * Construye el enrutador de la API con un contenedor inerte y devuelve todas
 * las rutas registradas como "METODO /ruta/{param}".
 * @returns {string[]} Rutas ordenadas y sin duplicados.
 */
export function listRegisteredRoutes() {
  /** @type {Map<Function, { routes: Array<{ method: string, path: string }>, mounts: Array<{ path: string, child: unknown }> }>} */
  const registry = new Map();
  const entryOf = (router) => {
    if (!registry.has(router)) registry.set(router, { routes: [], mounts: [] });
    return registry.get(router);
  };

  // Los metodos de los enrutadores viven en Router.prototype (Express 5 / router 2.x).
  const proto = Router.prototype;
  const originals = { use: proto.use };
  for (const method of HTTP_METHODS) originals[method] = proto[method];

  let root;
  try {
    for (const method of HTTP_METHODS) {
      proto[method] = function recordRoute(path, ...handlers) {
        if (typeof path === 'string') entryOf(this).routes.push({ method, path });
        return originals[method].call(this, path, ...handlers);
      };
    }
    proto.use = function recordMount(path, ...handlers) {
      if (typeof path === 'string') {
        for (const child of handlers) entryOf(this).mounts.push({ path, child });
      }
      return originals.use.call(this, path, ...handlers);
    };
    root = createApiRouter(stubContainer());
  } finally {
    for (const [name, original] of Object.entries(originals)) proto[name] = original;
  }

  /** Recorre el arbol de montaje acumulando el prefijo. */
  const collect = (router, prefix) => {
    const entry = registry.get(router);
    if (!entry) return [];
    const own = entry.routes.map(({ method, path }) => `${method.toUpperCase()} ${toOpenApiPath(join(prefix, path))}`);
    const nested = entry.mounts.flatMap(({ path, child }) => collect(child, join(prefix, path)));
    return [...own, ...nested];
  };

  return [...new Set(collect(root, ''))].sort();
}
