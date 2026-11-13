/**
 * DTOs del inventario del panel (Fase 3): salida de productos con costo y
 * proveedor, mermas, y entrada de consultas y del registro de mermas.
 *
 * Los importes salen en unidades decimales (fromCents); la base de datos
 * guarda centavos. Los ids salen como cadenas.
 */
import { fromCents, percentOf } from '../utils/money.js';
import { normalizeText } from './normalizers.js';

/**
 * Id a cadena (o null).
 * @param {unknown} id
 */
const idOf = (id) => (id ? id.toString() : null);

/** Convierte un booleano de query string ("true"/"false") en boolean. */
const toBool = (value) => (value === undefined ? undefined : value === true || value === 'true');

/** Convierte un numero de query string, dejando undefined si no viene. */
const toNum = (value) => (value === undefined ? undefined : Number(value));

/** Convierte una fecha ISO de query string o cuerpo, dejando undefined si no viene. */
export const toDate = (value) => (value === undefined || value === null ? undefined : new Date(value));

/** Fecha solo con dia (AAAA-MM-DD). */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Limite superior de un rango: una fecha sin hora abarca el dia completo
 * (23:59:59.999 UTC), igual que parseDateRange de los reportes.
 * @param {string | undefined | null} value
 */
export const toEndDate = (value) => {
  if (value === undefined || value === null) return undefined;
  const raw = String(value).trim();
  return DATE_ONLY.test(raw) ? new Date(`${raw}T23:59:59.999Z`) : new Date(raw);
};

/**
 * Texto opcional normalizado: null o vacio -> null; undefined se conserva.
 * @param {string | null | undefined} value
 */
export const optionalText = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = normalizeText(value);
  return text === '' ? null : text;
};

/**
 * Precios del producto: costo, precio de venta, descuento y precio final.
 * @param {object} product
 */
function pricesOf(product) {
  const discountPercent = product.discountPercent ?? 0;
  const finalCents = product.priceCents - percentOf(product.priceCents, discountPercent);
  return {
    costPrice: product.costCents === null || product.costCents === undefined ? null : fromCents(product.costCents),
    salePrice: fromCents(product.priceCents),
    discountPercent,
    finalPrice: fromCents(finalCents),
  };
}

export class InventoryProductDTO {
  /**
   * Fila del listado de inventario.
   * @param {object | null} product Documento de products.
   * @returns {object | null}
   */
  static from(product) {
    if (!product) return null;
    return {
      id: product._id.toString(),
      sku: product.sku,
      name: product.name,
      category: product.category,
      stock: product.stock,
      ...pricesOf(product),
      imageUrl: product.images?.[0] ?? null,
      isActive: Boolean(product.isActive),
      supplierId: idOf(product.supplierId),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  /** @param {object[]} products */
  static fromMany(products) {
    return products.map((product) => InventoryProductDTO.from(product));
  }
}

export class InventoryProductDetailDTO {
  /**
   * Detalle de producto con descripcion y datos del proveedor (campo supplier del $lookup).
   * @param {object | null} product
   * @returns {object | null}
   */
  static from(product) {
    if (!product) return null;
    const supplier = product.supplier ?? null;
    return {
      ...InventoryProductDTO.from(product),
      description: product.description ?? null,
      supplier: supplier
        ? {
            id: supplier._id.toString(),
            supplierCode: supplier.supplierCode,
            name: supplier.name,
            nit: supplier.nit,
            phone: supplier.phone ?? null,
            address: supplier.address ?? null,
            distributionDescription: supplier.distributionDescription ?? null,
            isActive: Boolean(supplier.isActive),
          }
        : null,
    };
  }
}

export class ListInventoryQueryDTO {
  /** @param {Record<string, string>} query Query string validada. */
  static from(query) {
    return Object.freeze({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      productName: query.productName?.trim() || undefined,
      supplierId: query.supplierId,
      category: query.category?.trim() || undefined,
      minPrice: toNum(query.minPrice),
      maxPrice: toNum(query.maxPrice),
      createdFrom: toDate(query.createdFrom),
      createdTo: toEndDate(query.createdTo),
      isActive: toBool(query.isActive),
      sort: query.sort || undefined,
    });
  }
}

export class RecordLossDTO {
  /** @param {object} body Cuerpo validado. */
  static from(body) {
    return Object.freeze({
      productId: body.productId,
      quantity: body.quantity,
      reason: body.reason,
      notes: optionalText(body.notes) ?? null,
      occurredAt: toDate(body.occurredAt),
    });
  }
}

export class InventoryLossDTO {
  /**
   * @param {object | null} loss Documento de inventory_losses.
   * @returns {object | null}
   */
  static from(loss) {
    if (!loss) return null;
    return {
      id: loss._id.toString(),
      productId: loss.productId.toString(),
      sku: loss.sku,
      productName: loss.productName,
      category: loss.category,
      supplierId: idOf(loss.supplierId),
      quantity: loss.quantity,
      reason: loss.reason,
      unitCost: fromCents(loss.unitCostCents),
      totalLoss: fromCents(loss.totalLossCents),
      notes: loss.notes ?? null,
      recordedBy: idOf(loss.recordedBy),
      occurredAt: loss.occurredAt,
      createdAt: loss.createdAt,
    };
  }

  /** @param {object[]} losses */
  static fromMany(losses) {
    return losses.map((loss) => InventoryLossDTO.from(loss));
  }
}

export class ListLossesQueryDTO {
  /** @param {Record<string, string>} query Query string validada. */
  static from(query) {
    return Object.freeze({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      productId: query.productId,
      reason: query.reason,
      from: toDate(query.from),
      to: toEndDate(query.to),
    });
  }
}
