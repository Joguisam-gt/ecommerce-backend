/**
 * Ayudas para construir la especificacion OpenAPI 3.0.3 sin dependencias.
 *
 * Solo generan objetos planos (referencias, respuestas, parametros y notas de
 * permisos). Las notas de permisos se calculan desde la matriz RBAC real
 * (constants/permissions.js), de modo que la documentacion no se desfasa si
 * cambia lo que puede hacer un rol.
 */
import { ROLE_PERMISSIONS } from '../constants/permissions.js';
import { ROLES } from '../constants/roles.js';

/** Referencia a un esquema de components.schemas. */
export const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

/** Referencia a un parametro reutilizable de components.parameters. */
export const param = (name) => ({ $ref: `#/components/parameters/${name}` });

/** Referencia a una respuesta reutilizable de components.responses. */
export const response = (name) => ({ $ref: `#/components/responses/${name}` });

/** Esquema nullable que apunta a otro esquema (en 3.0 "nullable" junto a $ref se ignora). */
export const nullableRef = (name) => ({ nullable: true, allOf: [ref(name)] });

/** Sesion por Bearer JWT o por cookie httpOnly access_token. */
export const AUTHENTICATED = Object.freeze([{ bearerAuth: [] }, { cookieAuth: [] }]);

/** Ruta publica: sin requisitos de seguridad. */
export const PUBLIC = Object.freeze([]);

/** Roles (de mayor a menor privilegio) que poseen TODOS los permisos indicados. */
export function rolesWith(...permissions) {
  return Object.values(ROLES).filter((role) => permissions.every((permission) => ROLE_PERMISSIONS[role].has(permission)));
}

/**
 * Nota de acceso para la descripcion de una operacion.
 * @param {string[]} permissions Permisos RBAC exigidos (todos).
 * @param {{ scope?: 'admin' | 'superuser' }} [options] Perimetro adicional por rol.
 */
export function access(permissions, { scope } = {}) {
  const roles = rolesWith(...permissions).join(', ');
  const perms = permissions.map((permission) => `\`${permission}\``).join(' + ');
  let perimeter = '';
  if (scope === 'admin') perimeter = ' El panel `/admin` exige ademas rol `admin` o `superuser` (los clientes reciben 403).';
  if (scope === 'superuser') perimeter = ' El modulo `/superuser` exige rol `superuser` estricto (un `admin` recibe 403).';
  return `**Acceso:** sesion valida y permiso ${perms} (roles con el permiso: ${roles}).${perimeter}`;
}

/** Nota para rutas que solo exigen sesion. */
export const SESSION_ONLY = '**Acceso:** cualquier usuario autenticado (sin permiso RBAC especifico).';

/** Nota para rutas publicas. */
export const PUBLIC_NOTE = '**Acceso:** publico, no requiere sesion.';

/** Cuerpo de respuesta JSON. */
export function json(description, schema, extra = {}) {
  return { description, content: { 'application/json': { schema, ...extra } } };
}

/** Sobre estandar { data } (con meta vacio opcional en los modulos administrativos). */
export function envelope(data, { meta = false } = {}) {
  const properties = { data };
  if (meta) properties.meta = { type: 'object', description: 'Metadatos (vacio en respuestas de un solo recurso).' };
  return { type: 'object', required: ['data'], properties };
}

/** Sobre estandar de listas paginadas { data: [...], meta: PageMeta }. */
export function paged(itemSchemaName) {
  return {
    type: 'object',
    required: ['data', 'meta'],
    properties: { data: { type: 'array', items: ref(itemSchemaName) }, meta: ref('PageMeta') },
  };
}

/** Cuerpo de solicitud JSON. */
export function body(schema, { examples, example, description } = {}) {
  const media = { schema };
  if (examples) media.examples = examples;
  if (example) media.example = example;
  return { required: true, ...(description ? { description } : {}), content: { 'application/json': media } };
}

/** Respuestas de error compartidas por codigo HTTP. */
const ERROR_RESPONSES = Object.freeze({
  400: 'BadRequest',
  401: 'Unauthorized',
  402: 'PaymentRequired',
  403: 'Forbidden',
  404: 'NotFound',
  409: 'Conflict',
  422: 'Unprocessable',
  423: 'Locked',
  502: 'BadGateway',
  503: 'ServiceUnavailable',
});

/**
 * Mapa de respuestas de error por codigo, apuntando a components.responses.
 * @param {...number} statuses
 */
export function errors(...statuses) {
  return Object.fromEntries(statuses.map((status) => [String(status), response(ERROR_RESPONSES[status])]));
}

/** Parametro de ruta ObjectId. */
export const idPath = (name, description) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: ref('ObjectId'),
});

/** Parametro de query. */
export const query = (name, schema, description) => ({ name, in: 'query', required: false, description, schema });

/** Parametro de query booleano. */
export const queryBool = (name, description) => query(name, { type: 'boolean' }, description);

/** Parametro de query ObjectId. */
export const queryId = (name, description) => query(name, ref('ObjectId'), description);

/** Parametro de query de fecha ISO 8601. */
export const queryDate = (name, description) => query(name, ref('IsoDate'), description);

/** Parametro de query importe decimal. */
export const queryMoney = (name, description) =>
  query(name, { type: 'number', format: 'double', minimum: 0, example: 100 }, `${description} (quetzales, maximo 2 decimales).`);

/** Parametro de query texto con longitud acotada. */
export const queryText = (name, maxLength, description) =>
  query(name, { type: 'string', minLength: 1, maxLength }, description);

/** Parametros de paginacion compartidos. */
export const PAGINATION = Object.freeze([param('Page'), param('Limit')]);

/**
 * Congela un objeto de forma recursiva (la especificacion es de solo lectura).
 * @template T
 * @param {T} target
 * @returns {Readonly<T>}
 */
export function deepFreeze(target) {
  if (target && typeof target === 'object' && !Object.isFrozen(target)) {
    Object.freeze(target);
    for (const value of Object.values(target)) deepFreeze(value);
  }
  return target;
}
