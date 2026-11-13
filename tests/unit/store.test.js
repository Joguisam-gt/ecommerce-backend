/**
 * Pruebas del catalogo publico: ProductDTO, ListProductsQueryDTO, validador,
 * StoreService (con repositorio en memoria) y construccion de filtros de MongoDB.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ListProductsQueryDTO, ProductDTO } from '../../src/dtos/product.dto.js';
import { buildProductFilter, buildProductSort } from '../../src/repositories/product.repository.js';
import { StoreService } from '../../src/services/store.service.js';
import { fromCents, percentOf } from '../../src/utils/money.js';
import { validateSchema } from '../../src/validators/schema-validator.js';
import { idParamSchema, listProductsQuerySchema } from '../../src/validators/store.validator.js';
import { FakeProductRepository, makeProduct } from '../helpers/store-fakes.js';

describe('ProductDTO', () => {
  it('expone exactamente los campos del contrato y oculta datos internos', () => {
    const product = makeProduct({ discountPercent: 15 });
    const dto = ProductDTO.from(product);
    for (const key of ['id', 'name', 'description', 'imageUrl', 'stock', 'pickupAvailable', 'acceptedPaymentMethods', 'originalPrice', 'discountPercent', 'finalPrice', 'hasDiscount']) {
      assert.ok(Object.hasOwn(dto, key), `falta ${key}`);
    }
    for (const key of ['costCents', 'supplierId', 'createdBy']) assert.equal(Object.hasOwn(dto, key), false);
    assert.equal(dto.id, product._id.toString());
    assert.equal(dto.imageUrl, 'https://example.com/a.png');
  });

  it('finalPrice coincide con percentOf (15% sobre 4999)', () => {
    const dto = ProductDTO.from(makeProduct({ priceCents: 4999, discountPercent: 15 }));
    assert.equal(dto.originalPrice, 49.99);
    assert.equal(dto.finalPrice, fromCents(4999 - percentOf(4999, 15)));
    assert.equal(dto.hasDiscount, true);
  });

  it('sin descuento: hasDiscount false, precio igual y sin imagen/descripcion da null', () => {
    const dto = ProductDTO.from(makeProduct({ discountPercent: 0, images: [], description: undefined }));
    assert.equal(dto.hasDiscount, false);
    assert.equal(dto.finalPrice, dto.originalPrice);
    assert.equal(dto.imageUrl, null);
    assert.equal(dto.description, null);
  });

  it('from(null) devuelve null y fromMany mapea', () => {
    assert.equal(ProductDTO.from(null), null);
    assert.equal(ProductDTO.fromMany([makeProduct(), makeProduct()]).length, 2);
  });
});

describe('ListProductsQueryDTO', () => {
  it('aplica valores por defecto y convierte tipos', () => {
    const dto = ListProductsQueryDTO.from({});
    assert.equal(dto.page, 1);
    assert.equal(dto.limit, 20);
    assert.equal(dto.featured, undefined);

    const parsed = ListProductsQueryDTO.from({ page: '2', limit: '5', featured: 'true', onSale: 'false', minPrice: '10.5', search: ' teclado ' });
    assert.equal(parsed.page, 2);
    assert.equal(parsed.limit, 5);
    assert.equal(parsed.featured, true);
    assert.equal(parsed.onSale, false);
    assert.equal(parsed.minPrice, 10.5);
    assert.equal(parsed.search, 'teclado');
  });
});

describe('listProductsQuerySchema', () => {
  it('acepta una consulta valida con booleanos en string', () => {
    assert.deepEqual(validateSchema(listProductsQuerySchema, { featured: 'true', onSale: 'false', sort: 'price_asc', minPrice: '1', maxPrice: '10.50' }), []);
  });

  it('rechaza sort invalido, minPrice > maxPrice y campos desconocidos', () => {
    assert.ok(validateSchema(listProductsQuerySchema, { sort: 'cualquiera' }).some((e) => e.field === 'sort'));
    assert.ok(validateSchema(listProductsQuerySchema, { minPrice: '20', maxPrice: '10' }).some((e) => e.field === 'minPrice'));
    assert.ok(validateSchema(listProductsQuerySchema, { featured: 'si' }).some((e) => e.field === 'featured'));
    assert.ok(validateSchema(listProductsQuerySchema, { foo: '1' }).some((e) => e.field === 'foo'));
  });

  it('idParamSchema rechaza ids invalidos', () => {
    assert.ok(validateSchema(idParamSchema, { id: 'xyz' }).length > 0);
  });
});

describe('StoreService', () => {
  const NOW = new Date('2026-06-30T12:00:00Z');
  let repo;
  let service;

  beforeEach(() => {
    repo = new FakeProductRepository([makeProduct()]);
    service = new StoreService({ productRepository: repo, storeConfig: { newArrivalsDays: 30 }, clock: () => NOW });
  });

  const list = (query) => service.listProducts(ListProductsQueryDTO.from(query));

  it('orden por defecto newest y paginacion', async () => {
    const result = await list({});
    assert.equal(repo.lastCriteria.sort, 'newest');
    assert.deepEqual([result.page, result.limit, result.total], [1, 20, 1]);
  });

  it('featured, onSale, categoria y busqueda', async () => {
    await list({ featured: 'true', category: 'monitores' });
    assert.equal(repo.lastCriteria.featured, true);
    assert.equal(repo.lastCriteria.category, 'monitores');
    await list({ onSale: 'true' });
    assert.equal(repo.lastCriteria.onSale, true);
    assert.equal(repo.lastCriteria.sort, 'discount_desc');
    await list({ search: 'teclado' });
    assert.equal(repo.lastCriteria.search, 'teclado');
    assert.equal(repo.lastCriteria.sort, undefined);
  });

  it('newArrivals usa el reloj y newArrivalsDays', async () => {
    await list({ newArrivals: 'true' });
    assert.equal(repo.lastCriteria.newerThan.getTime(), NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
  });

  it('topRated ordena por top_rated salvo sort explicito', async () => {
    await list({ topRated: 'true' });
    assert.equal(repo.lastCriteria.topRated, true);
    assert.equal(repo.lastCriteria.sort, 'top_rated');
    await list({ topRated: 'true', sort: 'price_asc' });
    assert.equal(repo.lastCriteria.sort, 'price_asc');
  });

  it('rango de precios en centavos', async () => {
    await list({ minPrice: '10.10', maxPrice: '99.99' });
    assert.equal(repo.lastCriteria.minPriceCents, 1010);
    assert.equal(repo.lastCriteria.maxPriceCents, 9999);
  });

  it('getProduct: devuelve activo, 404 si no existe o esta inactivo, 400 con id invalido', async () => {
    const active = repo.products[0];
    assert.equal(await service.getProduct(active._id.toString()), active);

    const inactive = makeProduct({ isActive: false });
    repo.products.push(inactive);
    await assert.rejects(service.getProduct(inactive._id.toString()), { status: 404, code: 'PRODUCT_NOT_FOUND' });
    await assert.rejects(service.getProduct('507f1f77bcf86cd799439011'), { status: 404 });
    await assert.rejects(service.getProduct('no-es-un-id'), { status: 400 });
  });
});

describe('buildProductFilter / buildProductSort', () => {
  it('siempre isActive y traduce cada criterio', () => {
    assert.deepEqual(buildProductFilter({}), { isActive: true });
    const since = new Date();
    const filter = buildProductFilter({ category: 'c', featured: true, onSale: true, newerThan: since, topRated: true, search: 'x', minPriceCents: 100, maxPriceCents: 500 });
    assert.deepEqual(filter, {
      isActive: true,
      category: 'c',
      isFeatured: true,
      discountPercent: { $gt: 0 },
      createdAt: { $gte: since },
      ratingCount: { $gte: 1 },
      $text: { $search: 'x' },
      priceCents: { $gte: 100, $lte: 500 },
    });
  });

  it('ordenes con desempate por _id y relevancia en busqueda', () => {
    assert.deepEqual(buildProductSort('newest').sort, { createdAt: -1, _id: -1 });
    assert.deepEqual(buildProductSort('top_rated').sort, { ratingAverage: -1, ratingCount: -1, _id: -1 });
    assert.equal(buildProductSort('price_asc').sort._id, 1);
    assert.equal(buildProductSort(undefined, true).byScore, true);
    assert.deepEqual(buildProductSort(undefined, false).sort, { createdAt: -1, _id: -1 });
  });
});
