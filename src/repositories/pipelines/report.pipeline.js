/**
 * Pipelines de agregacion de los reportes analiticos (Fase 3).
 *
 * Funciones puras que construyen las etapas; ReportRepository solo ejecuta
 * collection.aggregate(pipeline). Todos los importes se calculan en centavos.
 *
 * Convenciones:
 * - Ingresos (revenue): suma de items.grandTotalCents (lo que pago el cliente,
 *   impuestos incluidos) de pedidos en REVENUE_ORDER_STATUSES.
 * - Ingreso neto (netRevenue): revenue menos items.taxCents; base del margen.
 * - Los filtros de categoria y nombre de producto se aplican por linea de
 *   pedido (tras $unwind de items y $lookup a products), de modo que todas las
 *   facetas reflejan solo las lineas que cumplen el filtro.
 * - El rango de fechas usa createdAt en orders y occurredAt en inventory_losses.
 *   El estado de inventario es una foto actual: no aplica rango de fechas.
 */
import { REVENUE_ORDER_STATUSES, RETURNED_ORDER_STATUSES } from '../../constants/commerce.js';
import { COLLECTIONS } from '../../database/collections.js';
import { containsRegex, equalsIgnoreCaseRegex } from './customer.pipeline.js';

/** Categoria usada cuando el producto de una linea ya no existe en el catalogo. */

/** Maximo de productos en el detalle del estado de inventario (priorizando stock bajo). */
export const INVENTORY_DETAIL_LIMIT = 200;

export const UNKNOWN_CATEGORY = 'sin_categoria';

/** Numero de filas por defecto de los rankings (cupones y productos). */
export const DEFAULT_TOP_LIMIT = 10;

/** Umbral por defecto de stock bajo (lowStock = stock <= umbral). */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/**
 * Umbrales de la recomendacion sobre el proveedor de un producto.
 * - returnRate: proporcion de unidades devueltas sobre unidades despachadas.
 * - marginPercent: margen bruto estimado en porcentaje.
 */
export const SUPPLIER_RECOMMENDATION_THRESHOLDS = Object.freeze({
  returnRate: Object.freeze({ evaluate: 0.1, change: 0.2 }),
  marginPercent: Object.freeze({ evaluate: 20, change: 5 }),
});

/** Recomendaciones posibles sobre el proveedor. */
export const SUPPLIER_RECOMMENDATIONS = Object.freeze({
  CONTINUE: 'continuar',
  EVALUATE: 'evaluar',
  CHANGE: 'cambiar_proveedor',
});

/**
 * Condicion de rango de fechas para un campo (null si no hay limites).
 * @param {{ startDate?: Date, endDate?: Date }} range
 * @returns {{ $gte?: Date, $lte?: Date } | null}
 */
export function dateRangeCondition({ startDate, endDate } = {}) {
  if (!startDate && !endDate) return null;
  const condition = {};
  if (startDate) condition.$gte = startDate;
  if (endDate) condition.$lte = endDate;
  return condition;
}

/**
 * Faceta de resumen de ventas: ingresos, pedidos, unidades y ticket promedio.
 * Agrupa primero por pedido para contar pedidos sin acumular arrays de ids.
 * @returns {object[]}
 */
function salesSummaryFacet() {
  return [
    // Totales por pedido (solo de sus lineas filtradas).
    { $group: { _id: '$_id', revenueCents: { $sum: '$items.grandTotalCents' }, units: { $sum: '$items.quantity' } } },
    // Totales globales.
    { $group: { _id: null, revenueCents: { $sum: '$revenueCents' }, unitsSold: { $sum: '$units' }, ordersCount: { $sum: 1 } } },
    // Ticket promedio redondeado a centavos.
    {
      $project: {
        _id: 0,
        revenueCents: 1,
        unitsSold: 1,
        ordersCount: 1,
        averageTicketCents: {
          $cond: [{ $gt: ['$ordersCount', 0] }, { $round: [{ $divide: ['$revenueCents', '$ordersCount'] }, 0] }, 0],
        },
      },
    },
  ];
}

/**
 * Faceta por metodo de pago: pedidos e ingresos de cada metodo.
 * @returns {object[]}
 */
function paymentMethodFacet() {
  return [
    // Ingresos por pedido conservando su metodo.
    { $group: { _id: '$_id', method: { $first: '$payment.method' }, revenueCents: { $sum: '$items.grandTotalCents' } } },
    // Agregado por metodo.
    { $group: { _id: '$method', ordersCount: { $sum: 1 }, revenueCents: { $sum: '$revenueCents' } } },
    { $project: { _id: 0, method: '$_id', ordersCount: 1, revenueCents: 1 } },
    { $sort: { revenueCents: -1, method: 1 } },
  ];
}

/**
 * Faceta de ranking de cupones: usos (pedidos) y descuento total atribuido a
 * las lineas filtradas (items.couponDiscountCents).
 * @param {number} topLimit
 * @returns {object[]}
 */
function couponRankingFacet(topLimit) {
  return [
    // Solo pedidos con cupon.
    { $match: { 'coupon.code': { $type: 'string' } } },
    // Un uso por pedido, con el descuento de sus lineas.
    {
      $group: {
        _id: '$_id',
        code: { $first: '$coupon.code' },
        discountCents: { $sum: '$items.couponDiscountCents' },
        revenueCents: { $sum: '$items.grandTotalCents' },
      },
    },
    // Agregado por codigo.
    {
      $group: {
        _id: '$code',
        uses: { $sum: 1 },
        totalDiscountCents: { $sum: '$discountCents' },
        revenueCents: { $sum: '$revenueCents' },
      },
    },
    { $project: { _id: 0, code: '$_id', uses: 1, totalDiscountCents: 1, revenueCents: 1 } },
    { $sort: { uses: -1, totalDiscountCents: -1, code: 1 } },
    { $limit: topLimit },
  ];
}

/**
 * Faceta de productos mas vendidos por unidades (desempate por ingresos).
 * @param {number} topLimit
 * @returns {object[]}
 */
function topProductsFacet(topLimit) {
  return [
    {
      $group: {
        _id: '$items.productId',
        sku: { $first: '$items.sku' },
        name: { $first: '$items.name' },
        category: { $first: '$line.category' },
        unitsSold: { $sum: '$items.quantity' },
        revenueCents: { $sum: '$items.grandTotalCents' },
        ordersCount: { $sum: 1 },
      },
    },
    { $sort: { unitsSold: -1, revenueCents: -1, _id: 1 } },
    { $limit: topLimit },
    { $project: { _id: 0, productId: '$_id', sku: 1, name: 1, category: 1, unitsSold: 1, revenueCents: 1, ordersCount: 1 } },
  ];
}

/**
 * Pipeline del reporte general de ventas sobre orders: un unico $facet con
 * salesSummary, paymentMethodBreakdown, couponRanking y topProducts.
 * @param {{ startDate?: Date, endDate?: Date, category?: string, productName?: string, topLimit?: number }} filters
 * @returns {object[]}
 */
export function buildGeneralReportPipeline(filters = {}) {
  const topLimit = filters.topLimit ?? DEFAULT_TOP_LIMIT;

  // 1) Nivel pedido: ventas efectivas y rango de fechas (indice status + createdAt).
  const orderMatch = { status: { $in: [...REVENUE_ORDER_STATUSES] } };
  const createdAt = dateRangeCondition(filters);
  if (createdAt) orderMatch.createdAt = createdAt;

  // 4) Nivel linea: categoria (exacta, sin mayusculas) y nombre de producto (parcial).
  const lineMatch = {};
  if (filters.category) lineMatch['line.category'] = equalsIgnoreCaseRegex(filters.category);
  if (filters.productName) lineMatch['items.name'] = containsRegex(filters.productName);

  const pipeline = [
    { $match: orderMatch },
    // 2) Una fila por linea de pedido.
    { $unwind: '$items' },
    // 3) Categoria actual del producto de la linea (solo el campo necesario).
    {
      $lookup: {
        from: COLLECTIONS.PRODUCTS,
        let: { productId: '$items.productId' },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$productId'] } } }, { $project: { _id: 0, category: 1 } }],
        as: 'product',
      },
    },
    { $set: { line: { category: { $ifNull: [{ $arrayElemAt: ['$product.category', 0] }, UNKNOWN_CATEGORY] } } } },
  ];
  if (Object.keys(lineMatch).length > 0) pipeline.push({ $match: lineMatch });

  // 5) Todas las metricas en una sola pasada.
  pipeline.push({
    $facet: {
      salesSummary: salesSummaryFacet(),
      paymentMethodBreakdown: paymentMethodFacet(),
      couponRanking: couponRankingFacet(topLimit),
      topProducts: topProductsFacet(topLimit),
    },
  });
  return pipeline;
}

/**
 * Pipeline de mermas sobre inventory_losses: desglose por motivo y total.
 * @param {{ startDate?: Date, endDate?: Date, category?: string, productName?: string }} filters
 * @returns {object[]}
 */
export function buildLossesReportPipeline(filters = {}) {
  // 1) Filtros de fecha (occurredAt), categoria y nombre (snapshot de la merma).
  const match = {};
  const occurredAt = dateRangeCondition(filters);
  if (occurredAt) match.occurredAt = occurredAt;
  if (filters.category) match.category = equalsIgnoreCaseRegex(filters.category);
  if (filters.productName) match.productName = containsRegex(filters.productName);

  return [
    { $match: match },
    {
      $facet: {
        // 2) Por motivo (vencimiento, dano).
        byReason: [
          { $group: { _id: '$reason', units: { $sum: '$quantity' }, totalLossCents: { $sum: '$totalLossCents' }, records: { $sum: 1 } } },
          { $project: { _id: 0, reason: '$_id', units: 1, totalLossCents: 1, records: 1 } },
          { $sort: { totalLossCents: -1, reason: 1 } },
        ],
        // 3) Totales globales.
        totals: [
          { $group: { _id: null, units: { $sum: '$quantity' }, totalLossCents: { $sum: '$totalLossCents' }, records: { $sum: 1 } } },
          { $project: { _id: 0, units: 1, totalLossCents: 1, records: 1 } },
        ],
      },
    },
  ];
}

/**
 * Pipeline del estado de inventario sobre products: stock, costo y valor por
 * producto, con indicador lowStock (stock <= umbral) y totales.
 * @param {{ category?: string, productName?: string, lowStockThreshold?: number }} filters
 * @returns {object[]}
 */
export function buildInventoryStatusPipeline(filters = {}) {
  const threshold = filters.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

  // 1) Filtros de categoria y nombre actuales del producto.
  const match = {};
  if (filters.category) match.category = equalsIgnoreCaseRegex(filters.category);
  if (filters.productName) match.name = containsRegex(filters.productName);

  return [
    { $match: match },
    // 2) Valores por producto; un costo desconocido (null) cuenta como 0 en el valor.
    {
      $project: {
        _id: 0,
        productId: '$_id',
        sku: 1,
        name: 1,
        category: 1,
        isActive: 1,
        stock: 1,
        costCents: { $ifNull: ['$costCents', null] },
        priceCents: 1,
        inventoryCostCents: { $multiply: ['$stock', { $ifNull: ['$costCents', 0] }] },
        inventoryRetailCents: { $multiply: ['$stock', '$priceCents'] },
        lowStock: { $lte: ['$stock', threshold] },
      },
    },
    {
      $facet: {
        // 3) Detalle: primero los de stock bajo, luego por stock ascendente.
        // Tope para no superar el limite de 16 MB del documento $facet; los totales no se limitan.
        products: [{ $sort: { lowStock: -1, stock: 1, name: 1 } }, { $limit: INVENTORY_DETAIL_LIMIT }],
        // 4) Totales del inventario filtrado.
        totals: [
          {
            $group: {
              _id: null,
              products: { $sum: 1 },
              units: { $sum: '$stock' },
              inventoryCostCents: { $sum: '$inventoryCostCents' },
              inventoryRetailCents: { $sum: '$inventoryRetailCents' },
              lowStockCount: { $sum: { $cond: ['$lowStock', 1, 0] } },
            },
          },
          { $project: { _id: 0 } },
        ],
      },
    },
  ];
}

/**
 * Pipeline de desempeno del proveedor de un producto (sobre products por _id).
 * Calcula ventas, devoluciones, mermas, precios y margen bruto estimado.
 *
 * Definiciones:
 * - unitsSold / revenueCents / netRevenueCents: lineas del producto en pedidos REVENUE.
 * - returnedUnits: lineas del producto en pedidos RETURNED.
 * - returnRate = returnedUnits / (unitsSold + returnedUnits), 4 decimales; 0 sin despachos.
 * - grossMargin (estimado, base 'ventas'): netRevenue - costo actual * unitsSold,
 *   porcentaje sobre netRevenue. Sin ventas (base 'catalogo'): margen unitario del
 *   precio de catalogo con descuento propio. Sin costo conocido: null.
 * El producto se fija por literal en los $lookup para usar los indices
 * ix_orders_items_product e ix_losses_product_occurred.
 * @param {import('mongodb').ObjectId} productId
 * @param {{ startDate?: Date, endDate?: Date }} [range]
 * @returns {object[]}
 */
export function buildSupplierPerformancePipeline(productId, range = {}) {
  const dates = dateRangeCondition(range);

  // Pedidos relevantes del producto: ventas efectivas y devueltos, en el rango.
  const ordersMatch = {
    'items.productId': productId,
    status: { $in: [...REVENUE_ORDER_STATUSES, ...RETURNED_ORDER_STATUSES] },
  };
  if (dates) ordersMatch.createdAt = dates;

  // Mermas del producto en el rango.
  const lossesMatch = { productId };
  if (dates) lossesMatch.occurredAt = dates;

  /** Suma condicional por estado de la linea del producto. */
  const sumIf = (statuses, field) => ({ $sum: { $cond: [{ $in: ['$status', [...statuses]] }, field, 0] } });

  return [
    // 1) El producto.
    { $match: { _id: productId } },
    // 2) Proveedor: solo los campos de contacto y distribucion.
    {
      $lookup: {
        from: COLLECTIONS.SUPPLIERS,
        let: { supplierId: '$supplierId' },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$supplierId'] } } },
          { $project: { _id: 1, supplierCode: 1, name: 1, phone: 1, distributionDescription: 1 } },
        ],
        as: 'supplier',
      },
    },
    // 3) Ventas y devoluciones del producto (solo sus lineas).
    {
      $lookup: {
        from: COLLECTIONS.ORDERS,
        pipeline: [
          { $match: ordersMatch },
          { $unwind: '$items' },
          { $match: { 'items.productId': productId } },
          {
            $group: {
              _id: null,
              unitsSold: sumIf(REVENUE_ORDER_STATUSES, '$items.quantity'),
              revenueCents: sumIf(REVENUE_ORDER_STATUSES, '$items.grandTotalCents'),
              netRevenueCents: sumIf(REVENUE_ORDER_STATUSES, { $subtract: ['$items.grandTotalCents', '$items.taxCents'] }),
              returnedUnits: sumIf(RETURNED_ORDER_STATUSES, '$items.quantity'),
            },
          },
        ],
        as: 'sales',
      },
    },
    // 4) Mermas: unidades y costo perdido.
    {
      $lookup: {
        from: COLLECTIONS.INVENTORY_LOSSES,
        pipeline: [
          { $match: lossesMatch },
          { $group: { _id: null, lossUnits: { $sum: '$quantity' }, lossCostCents: { $sum: '$totalLossCents' } } },
        ],
        as: 'losses',
      },
    },
    // 5) Metricas base con valores por defecto cuando no hay ventas ni mermas.
    {
      $project: {
        _id: 0,
        productId: '$_id',
        sku: 1,
        name: 1,
        category: 1,
        isActive: 1,
        stock: 1,
        supplier: { $ifNull: [{ $arrayElemAt: ['$supplier', 0] }, null] },
        costPriceCents: { $ifNull: ['$costCents', null] },
        salePriceCents: '$priceCents',
        discountPercent: { $ifNull: ['$discountPercent', 0] },
        unitsSold: { $ifNull: [{ $arrayElemAt: ['$sales.unitsSold', 0] }, 0] },
        revenueCents: { $ifNull: [{ $arrayElemAt: ['$sales.revenueCents', 0] }, 0] },
        netRevenueCents: { $ifNull: [{ $arrayElemAt: ['$sales.netRevenueCents', 0] }, 0] },
        returnedUnits: { $ifNull: [{ $arrayElemAt: ['$sales.returnedUnits', 0] }, 0] },
        lossUnits: { $ifNull: [{ $arrayElemAt: ['$losses.lossUnits', 0] }, 0] },
        lossCostCents: { $ifNull: [{ $arrayElemAt: ['$losses.lossCostCents', 0] }, 0] },
      },
    },
    // 6) Derivados: tasa de devolucion y precio efectivo de catalogo.
    {
      $set: {
        returnRate: {
          $let: {
            vars: { shipped: { $add: ['$unitsSold', '$returnedUnits'] } },
            in: { $cond: [{ $gt: ['$$shipped', 0] }, { $round: [{ $divide: ['$returnedUnits', '$$shipped'] }, 4] }, 0] },
          },
        },
        effectivePriceCents: {
          $round: [{ $divide: [{ $multiply: ['$salePriceCents', { $subtract: [100, '$discountPercent'] }] }, 100] }, 0],
        },
      },
    },
    // 7) Margen bruto estimado (ver definiciones en la cabecera de la funcion).
    {
      $set: {
        marginBasis: {
          $cond: [{ $eq: ['$costPriceCents', null] }, null, { $cond: [{ $gt: ['$unitsSold', 0] }, 'ventas', 'catalogo'] }],
        },
        grossProfitCents: {
          $cond: [
            { $or: [{ $eq: ['$costPriceCents', null] }, { $eq: ['$unitsSold', 0] }] },
            null,
            { $subtract: ['$netRevenueCents', { $multiply: ['$costPriceCents', '$unitsSold'] }] },
          ],
        },
        unitMarginCents: {
          $cond: [{ $eq: ['$costPriceCents', null] }, null, { $subtract: ['$effectivePriceCents', '$costPriceCents'] }],
        },
      },
    },
    {
      $set: {
        grossMarginPercent: {
          $switch: {
            branches: [
              {
                case: { $and: [{ $eq: ['$marginBasis', 'ventas'] }, { $gt: ['$netRevenueCents', 0] }] },
                then: { $round: [{ $multiply: [{ $divide: ['$grossProfitCents', '$netRevenueCents'] }, 100] }, 2] },
              },
              {
                case: { $and: [{ $eq: ['$marginBasis', 'catalogo'] }, { $gt: ['$effectivePriceCents', 0] }] },
                then: { $round: [{ $multiply: [{ $divide: ['$unitMarginCents', '$effectivePriceCents'] }, 100] }, 2] },
              },
            ],
            default: null,
          },
        },
      },
    },
  ];
}

/**
 * Recomendacion simple sobre el proveedor (funcion pura, aplicada por ReportService).
 *
 * Regla (umbrales en SUPPLIER_RECOMMENDATION_THRESHOLDS):
 * - 'cambiar_proveedor': returnRate >= 20 % o margen bruto < 5 %.
 * - 'evaluar': returnRate >= 10 %, margen < 20 % o margen desconocido (sin costo).
 * - 'continuar': en cualquier otro caso.
 * @param {{ returnRate: number, grossMarginPercent: number | null }} metrics
 * @param {typeof SUPPLIER_RECOMMENDATION_THRESHOLDS} [thresholds]
 * @returns {{ recommendation: string, reasons: string[] }}
 */
export function recommendSupplierAction({ returnRate, grossMarginPercent }, thresholds = SUPPLIER_RECOMMENDATION_THRESHOLDS) {
  const rate = Number(returnRate) || 0;
  const margin = grossMarginPercent ?? null;

  // Criterios graves: cambio de proveedor.
  const changeReasons = [];
  if (rate >= thresholds.returnRate.change) changeReasons.push('tasa de devolucion muy alta');
  if (margin !== null && margin < thresholds.marginPercent.change) changeReasons.push('margen bruto muy bajo');
  if (changeReasons.length > 0) return { recommendation: SUPPLIER_RECOMMENDATIONS.CHANGE, reasons: changeReasons };

  // Criterios de alerta: evaluar.
  const evaluateReasons = [];
  if (rate >= thresholds.returnRate.evaluate) evaluateReasons.push('tasa de devolucion elevada');
  if (margin === null) evaluateReasons.push('margen desconocido (producto sin costo registrado)');
  else if (margin < thresholds.marginPercent.evaluate) evaluateReasons.push('margen bruto reducido');
  if (evaluateReasons.length > 0) return { recommendation: SUPPLIER_RECOMMENDATIONS.EVALUATE, reasons: evaluateReasons };

  return { recommendation: SUPPLIER_RECOMMENDATIONS.CONTINUE, reasons: ['devoluciones y margen dentro de los umbrales'] };
}
