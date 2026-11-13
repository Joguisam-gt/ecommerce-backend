/**
 * Pipelines de agregacion del directorio de clientes (Fase 3).
 *
 * Funciones puras: construyen arrays de etapas sin tocar MongoDB, de modo que
 * su estructura se prueba sin base de datos y el repositorio solo ejecuta
 * collection.aggregate(pipeline) sobre users.
 *
 * Metricas por cliente (calculadas con $lookup a orders + $group):
 * - purchasedItems: suma de quantity en pedidos con estado de venta efectiva
 *   (REVENUE_ORDER_STATUSES).
 * - returnedItems: suma de quantity en pedidos devueltos (RETURNED_ORDER_STATUSES).
 * - totalSpentCents: suma de totals.grandTotalCents en pedidos de venta efectiva.
 * - ordersCount: numero total de pedidos del cliente, en cualquier estado.
 * - preferredPaymentMethod: ver pickPreferredPaymentMethod (misma regla en JS y en el pipeline).
 *
 * Optimizacion: si no hay filtros sobre metricas calculadas, se pagina sobre
 * users ANTES del $lookup (dentro de la faceta items), y solo se calculan las
 * metricas de la pagina pedida. Con filtros sobre metricas hay que calcularlas
 * para todo el conjunto antes de filtrar y paginar.
 */
import { ObjectId } from 'mongodb';
import { REVENUE_ORDER_STATUSES, RETURNED_ORDER_STATUSES } from '../../constants/commerce.js';
import { ROLES } from '../../constants/roles.js';
import { COLLECTIONS } from '../../database/collections.js';

/** Patron de un ObjectId en texto (codigo de cliente por defecto). */
const OBJECT_ID_HEX = /^[a-f\d]{24}$/i;

/**
 * Escapa los caracteres especiales para usar texto del usuario dentro de una
 * expresion regular (evita inyeccion de regex y ReDoS).
 * @param {string} value
 * @returns {string}
 */
export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Condicion de busqueda parcial sin distinguir mayusculas, con el texto escapado.
 * @param {string} value
 * @returns {{ $regex: string, $options: string }}
 */
export function containsRegex(value) {
  return { $regex: escapeRegex(value), $options: 'i' };
}

/**
 * Condicion de igualdad exacta sin distinguir mayusculas, con el texto escapado.
 * @param {string} value
 * @returns {{ $regex: string, $options: string }}
 */
export function equalsIgnoreCaseRegex(value) {
  return { $regex: `^${escapeRegex(value)}$`, $options: 'i' };
}

/**
 * Regla del metodo de pago preferido (implementacion de referencia en JS).
 *
 * - Cuenta TODOS los pedidos del cliente sin importar su estado: la preferencia
 *   refleja el metodo que el cliente elige, no si el cobro termino bien (un pago
 *   rechazado o reembolsado tambien expresa su eleccion).
 * - Gana el metodo con mas pedidos.
 * - Empate: gana el metodo cuyo pedido mas reciente es posterior.
 * - Empate total (misma fecha): orden alfabetico del metodo, para ser determinista.
 * - Sin pedidos: null.
 * Acepta pedidos completos ({ payment: { method }, createdAt }) o proyectados ({ method, createdAt }).
 * @param {Array<{ method?: string, payment?: { method: string }, createdAt: Date | string }>} orders
 * @returns {string | null}
 */
export function pickPreferredPaymentMethod(orders) {
  // Acumula por metodo el numero de pedidos y la fecha del mas reciente.
  const byMethod = new Map();
  for (const order of orders ?? []) {
    const method = order.method ?? order.payment?.method;
    if (!method) continue;
    const createdAt = new Date(order.createdAt).getTime();
    const entry = byMethod.get(method) ?? { method, orders: 0, lastOrderAt: Number.NEGATIVE_INFINITY };
    entry.orders += 1;
    entry.lastOrderAt = Math.max(entry.lastOrderAt, createdAt);
    byMethod.set(method, entry);
  }

  // Elige el mejor con la misma comparacion que usa la etapa $reduce del pipeline.
  let best = null;
  for (const entry of byMethod.values()) {
    if (isBetterPaymentEntry(entry, best)) best = entry;
  }
  return best ? best.method : null;
}

/**
 * Comparacion compartida por la regla: mas pedidos, luego mas reciente, luego alfabetico.
 * @param {{ method: string, orders: number, lastOrderAt: number }} candidate
 * @param {{ method: string, orders: number, lastOrderAt: number } | null} current
 * @returns {boolean}
 */
function isBetterPaymentEntry(candidate, current) {
  if (!current) return true;
  if (candidate.orders !== current.orders) return candidate.orders > current.orders;
  if (candidate.lastOrderAt !== current.lastOrderAt) return candidate.lastOrderAt > current.lastOrderAt;
  return candidate.method < current.method;
}

/**
 * Etapa $addFields que calcula preferredPaymentMethod a partir del array
 * paymentMethods [{ method, orders, lastOrderAt }] generado por el segundo $group.
 * Replica en agregacion la regla de pickPreferredPaymentMethod con un $reduce
 * (compatible con cualquier version de MongoDB, sin depender de $sortArray).
 * @returns {object}
 */
export function preferredPaymentMethodStage() {
  return {
    $addFields: {
      preferredPaymentMethod: {
        $let: {
          vars: {
            best: {
              $reduce: {
                // Solo entradas reales: un cliente sin pedidos produce una entrada con metodo null.
                input: { $filter: { input: '$paymentMethods', as: 'entry', cond: { $ne: ['$$entry.method', null] } } },
                initialValue: null,
                in: {
                  $cond: [
                    {
                      $or: [
                        { $eq: ['$$value', null] },
                        { $gt: ['$$this.orders', '$$value.orders'] },
                        {
                          $and: [
                            { $eq: ['$$this.orders', '$$value.orders'] },
                            { $gt: ['$$this.lastOrderAt', '$$value.lastOrderAt'] },
                          ],
                        },
                        {
                          $and: [
                            { $eq: ['$$this.orders', '$$value.orders'] },
                            { $eq: ['$$this.lastOrderAt', '$$value.lastOrderAt'] },
                            { $lt: ['$$this.method', '$$value.method'] },
                          ],
                        },
                      ],
                    },
                    '$$this',
                    '$$value',
                  ],
                },
              },
            },
          },
          in: { $ifNull: ['$$best.method', null] },
        },
      },
    },
  };
}

/**
 * Suma condicional de un campo del pedido desenrollado segun su estado.
 * @param {readonly string[]} statuses
 * @param {string} field Expresion del valor a sumar (p. ej. '$orders.itemsCount').
 * @returns {object}
 */
function sumWhenStatus(statuses, field) {
  return { $sum: { $cond: [{ $in: [{ $ifNull: ['$orders.status', null] }, [...statuses]] }, field, 0] } };
}

/**
 * Etapas que calculan las metricas de cada cliente a partir de sus pedidos.
 * Entrada: documentos de users ya filtrados. Salida: un documento por cliente
 * con datos de contacto, metricas y preferredPaymentMethod.
 * @returns {object[]}
 */
export function customerMetricsStages() {
  return [
    // 1) Pedidos del cliente: $lookup correlacionado (let/$expr) que trae solo los campos necesarios.
    {
      $lookup: {
        from: COLLECTIONS.ORDERS,
        let: { customerId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$userId', '$$customerId'] } } },
          {
            $project: {
              _id: 0,
              status: 1,
              method: '$payment.method',
              grandTotalCents: '$totals.grandTotalCents',
              itemsCount: { $sum: '$items.quantity' },
              createdAt: 1,
            },
          },
        ],
        as: 'orders',
      },
    },
    // 2) Un documento por pedido; los clientes sin pedidos se conservan con orders ausente.
    { $unwind: { path: '$orders', preserveNullAndEmptyArrays: true } },
    // 3) Primer $group por (cliente, metodo de pago): totales parciales y pedidos por metodo.
    {
      $group: {
        // $ifNull: sin pedidos el metodo queda null explicito (no ausente) y el $filter final lo descarta.
        _id: { customerId: '$_id', method: { $ifNull: ['$orders.method', null] } },
        userCode: { $first: '$userCode' },
        firstName: { $first: '$firstName' },
        lastName: { $first: '$lastName' },
        email: { $first: '$email' },
        phone: { $first: '$phone' },
        isActive: { $first: '$isActive' },
        createdAt: { $first: '$createdAt' },
        methodOrders: { $sum: { $cond: [{ $eq: [{ $type: '$orders' }, 'object'] }, 1, 0] } },
        methodLastOrderAt: { $max: '$orders.createdAt' },
        purchasedItems: sumWhenStatus(REVENUE_ORDER_STATUSES, '$orders.itemsCount'),
        returnedItems: sumWhenStatus(RETURNED_ORDER_STATUSES, '$orders.itemsCount'),
        totalSpentCents: sumWhenStatus(REVENUE_ORDER_STATUSES, '$orders.grandTotalCents'),
      },
    },
    // 4) Segundo $group por cliente: totales finales y desglose de pedidos por metodo.
    {
      $group: {
        _id: '$_id.customerId',
        userCode: { $first: '$userCode' },
        firstName: { $first: '$firstName' },
        lastName: { $first: '$lastName' },
        email: { $first: '$email' },
        phone: { $first: '$phone' },
        isActive: { $first: '$isActive' },
        createdAt: { $first: '$createdAt' },
        ordersCount: { $sum: '$methodOrders' },
        purchasedItems: { $sum: '$purchasedItems' },
        returnedItems: { $sum: '$returnedItems' },
        totalSpentCents: { $sum: '$totalSpentCents' },
        paymentMethods: { $push: { method: '$_id.method', orders: '$methodOrders', lastOrderAt: '$methodLastOrderAt' } },
      },
    },
    // 5) Metodo de pago preferido (regla documentada en pickPreferredPaymentMethod).
    preferredPaymentMethodStage(),
    // 6) Forma final: codigo visible, nombre completo y desglose sin entradas vacias.
    {
      $project: {
        _id: 1,
        userCode: { $ifNull: ['$userCode', { $toString: '$_id' }] },
        name: { $concat: ['$firstName', ' ', '$lastName'] },
        firstName: 1,
        lastName: 1,
        email: 1,
        phone: { $ifNull: ['$phone', null] },
        isActive: 1,
        createdAt: 1,
        purchasedItems: 1,
        returnedItems: 1,
        totalSpentCents: 1,
        ordersCount: 1,
        preferredPaymentMethod: 1,
        paymentMethods: {
          $filter: { input: '$paymentMethods', as: 'entry', cond: { $ne: ['$$entry.method', null] } },
        },
      },
    },
  ];
}

/**
 * Filtro $match sobre users (etapa inicial, aprovecha indices): rol cliente,
 * estado, codigo, nombre, correo y telefono.
 * @param {{ userCode?: string, name?: string, email?: string, phone?: string,
 *           isActive?: boolean, includeInactive?: boolean }} filters
 * @returns {object}
 */
export function buildCustomerMatch(filters = {}) {
  const match = { role: ROLES.USER };

  // Estado: filtro explicito; si no, solo activos salvo includeInactive.
  if (filters.isActive !== undefined) match.isActive = filters.isActive;
  else if (!filters.includeInactive) match.isActive = true;

  // Codigo visible: userCode o, si parece un ObjectId, tambien el _id del cliente.
  if (filters.userCode) {
    match.$or = OBJECT_ID_HEX.test(filters.userCode)
      ? [{ userCode: filters.userCode }, { _id: ObjectId.createFromHexString(filters.userCode) }]
      : [{ userCode: filters.userCode }];
  }

  // Nombre completo (firstName + ' ' + lastName) por coincidencia parcial y escapada.
  if (filters.name) {
    match.$expr = {
      $regexMatch: { input: { $concat: ['$firstName', ' ', '$lastName'] }, regex: escapeRegex(filters.name), options: 'i' },
    };
  }

  if (filters.email) match.email = containsRegex(filters.email);
  if (filters.phone) match.phone = containsRegex(filters.phone);
  return match;
}

/**
 * Filtro $match sobre las metricas calculadas (etapa posterior al $group).
 * @param {{ preferredPaymentMethod?: string, minTotalSpentCents?: number,
 *           maxTotalSpentCents?: number, minPurchasedItems?: number }} filters
 * @returns {object | null} null si no hay filtros sobre metricas.
 */
export function buildCustomerMetricsMatch(filters = {}) {
  const match = {};
  if (filters.preferredPaymentMethod) match.preferredPaymentMethod = filters.preferredPaymentMethod;
  if (filters.minTotalSpentCents !== undefined || filters.maxTotalSpentCents !== undefined) {
    match.totalSpentCents = {};
    if (filters.minTotalSpentCents !== undefined) match.totalSpentCents.$gte = filters.minTotalSpentCents;
    if (filters.maxTotalSpentCents !== undefined) match.totalSpentCents.$lte = filters.maxTotalSpentCents;
  }
  if (filters.minPurchasedItems !== undefined) match.purchasedItems = { $gte: filters.minPurchasedItems };
  return Object.keys(match).length > 0 ? match : null;
}

/** Orden estable del directorio: clientes mas recientes primero. */
const DIRECTORY_SORT = Object.freeze({ createdAt: -1, _id: -1 });

/**
 * Pipeline del listado paginado del directorio. Devuelve un unico documento
 * { items: [...], total: [{ total }] } generado por $facet.
 * @param {object} filters Ver buildCustomerMatch y buildCustomerMetricsMatch.
 * @param {{ page: number, limit: number }} pagination
 * @returns {object[]}
 */
export function buildCustomerDirectoryPipeline(filters, { page, limit }) {
  const skip = (page - 1) * limit;
  const metricsMatch = buildCustomerMetricsMatch(filters);
  const pipeline = [{ $match: buildCustomerMatch(filters) }];

  if (metricsMatch) {
    // Con filtros sobre metricas: calcular para todos, filtrar y despues paginar.
    pipeline.push(
      ...customerMetricsStages(),
      { $match: metricsMatch },
      { $sort: DIRECTORY_SORT },
      { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'total' }] } },
    );
    return pipeline;
  }

  // Sin filtros sobre metricas: paginar primero y calcular solo la pagina pedida.
  pipeline.push(
    { $sort: DIRECTORY_SORT },
    {
      $facet: {
        items: [{ $skip: skip }, { $limit: limit }, ...customerMetricsStages(), { $sort: DIRECTORY_SORT }],
        total: [{ $count: 'total' }],
      },
    },
  );
  return pipeline;
}

/**
 * Pipeline del detalle de un cliente (incluye inactivos; solo rol user).
 * @param {ObjectId} customerId
 * @returns {object[]}
 */
export function buildCustomerDetailPipeline(customerId) {
  return [{ $match: { _id: customerId, role: ROLES.USER } }, ...customerMetricsStages()];
}
