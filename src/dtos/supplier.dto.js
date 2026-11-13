/**
 * DTOs de proveedores (Fase 3): entrada de alta y actualizacion (costos del
 * catalogo convertidos a centavos), salida resumida y detalle con el catalogo
 * enriquecido, y parametros de listado.
 */
import { fromCents, percentOf, toCents } from '../utils/money.js';
import { optionalText } from './inventory.dto.js';
import { compact, normalizeEmail, normalizePhone, normalizeText } from './normalizers.js';

/** Convierte un booleano de query string ("true"/"false") en boolean. */
const toBool = (value) => (value === undefined ? undefined : value === true || value === 'true');

/**
 * NIT canonico: sin espacios y en mayusculas (clave del indice unico).
 * @param {string | undefined} value
 */
const normalizeNit = (value) => (value === undefined ? undefined : value.trim().toUpperCase());

/**
 * Correo opcional: null o vacio -> null; undefined se conserva.
 * @param {string | null | undefined} value
 */
const optionalEmail = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  return normalizeEmail(value);
};

/**
 * Catalogo de entrada [{ productId, cost }] -> [{ productId, costCents }].
 * @param {Array<{ productId: string, cost: number }> | undefined} catalog
 */
const catalogOf = (catalog) =>
  catalog === undefined ? undefined : catalog.map((entry) => ({ productId: entry.productId, costCents: toCents(entry.cost) }));

/**
 * Campos comunes de alta y actualizacion (undefined si no vienen).
 * @param {object} body
 */
const supplierInput = (body) => ({
  name: body.name === undefined ? undefined : normalizeText(body.name),
  nit: normalizeNit(body.nit),
  address: optionalText(body.address),
  phone: normalizePhone(body.phone),
  email: optionalEmail(body.email),
  contactName: optionalText(body.contactName),
  distributionDescription: optionalText(body.distributionDescription),
  catalog: catalogOf(body.catalog),
});

export class CreateSupplierDTO {
  /** @param {object} body Cuerpo validado. */
  static from(body) {
    const input = supplierInput(body);
    return Object.freeze({
      ...input,
      email: input.email ?? null,
      contactName: input.contactName ?? null,
      catalog: input.catalog ?? [],
    });
  }
}

export class UpdateSupplierDTO {
  /** @param {object} body Cuerpo validado (sin supplierCode). */
  static from(body) {
    return Object.freeze(compact({ ...supplierInput(body), isActive: body.isActive }));
  }
}

/**
 * Datos basicos del proveedor en la respuesta.
 * @param {object} supplier
 */
function baseOf(supplier) {
  return {
    id: supplier._id.toString(),
    supplierCode: supplier.supplierCode,
    name: supplier.name,
    nit: supplier.nit,
    address: supplier.address ?? null,
    phone: supplier.phone ?? null,
    email: supplier.email ?? null,
    contactName: supplier.contactName ?? null,
    distributionDescription: supplier.distributionDescription ?? null,
    isActive: Boolean(supplier.isActive),
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}

export class SupplierDTO {
  /**
   * Proveedor con su catalogo basico (productId y costo).
   * @param {object | null} supplier Documento de suppliers.
   * @returns {object | null}
   */
  static from(supplier) {
    if (!supplier) return null;
    return {
      ...baseOf(supplier),
      catalog: (supplier.catalog ?? []).map((entry) => ({
        productId: entry.productId.toString(),
        cost: fromCents(entry.costCents),
      })),
    };
  }

  /** @param {object[]} suppliers */
  static fromMany(suppliers) {
    return suppliers.map((supplier) => SupplierDTO.from(supplier));
  }
}

export class SupplierDetailDTO {
  /**
   * Proveedor con el catalogo enriquecido (cada entrada con "product" del $lookup).
   * @param {object | null} supplier
   * @returns {object | null}
   */
  static from(supplier) {
    if (!supplier) return null;
    return {
      ...baseOf(supplier),
      catalog: (supplier.catalog ?? []).map((entry) => {
        const product = entry.product ?? null;
        const discountPercent = product?.discountPercent ?? 0;
        return {
          productId: entry.productId.toString(),
          cost: fromCents(entry.costCents),
          sku: product?.sku ?? null,
          name: product?.name ?? null,
          stock: product?.stock ?? null,
          salePrice: product ? fromCents(product.priceCents) : null,
          finalPrice: product ? fromCents(product.priceCents - percentOf(product.priceCents, discountPercent)) : null,
          isActive: product ? Boolean(product.isActive) : null,
        };
      }),
    };
  }
}

export class ListSuppliersQueryDTO {
  /** @param {Record<string, string>} query Query string validada. */
  static from(query) {
    return Object.freeze({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      supplierCode: query.supplierCode ? query.supplierCode.trim().toUpperCase() : undefined,
      name: query.name?.trim() || undefined,
      address: query.address?.trim() || undefined,
      isActive: toBool(query.isActive),
    });
  }
}
