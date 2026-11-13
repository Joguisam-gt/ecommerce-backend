/**
 * Dobles en memoria para las pruebas del catalogo publico.
 */
import { ObjectId } from 'mongodb';

/** Repositorio de productos falso: registra los criterios recibidos y devuelve productos fijos. */
export class FakeProductRepository {
  /** @type {object[]} */
  products;
  /** @type {object | null} Ultimos criterios recibidos por listPublic. */
  lastCriteria = null;

  /** @param {object[]} [products] */
  constructor(products = []) {
    this.products = products;
  }

  /** @param {ObjectId} id */
  async findPublicById(id) {
    return this.products.find((p) => p._id.equals(id) && p.isActive) ?? null;
  }

  /** @param {object} criteria */
  async listPublic(criteria) {
    this.lastCriteria = criteria;
    return { items: this.products, total: this.products.length };
  }
}

/**
 * Fabrica de productos de prueba.
 * @param {object} [overrides]
 */
export function makeProduct(overrides = {}) {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    _id: new ObjectId(),
    sku: 'TEST-001',
    name: 'Producto de prueba',
    slug: 'producto-de-prueba',
    description: 'Descripcion',
    priceCents: 4999,
    costCents: 2000,
    discountPercent: 0,
    taxRatePercent: 12,
    stock: 10,
    category: 'perifericos',
    images: ['https://example.com/a.png'],
    isFeatured: false,
    pickupAvailable: true,
    acceptedPaymentMethods: ['card'],
    ratingAverage: 4,
    ratingCount: 2,
    supplierId: new ObjectId(),
    isActive: true,
    createdBy: new ObjectId(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
