/**
 * Pruebas de la gestion de cupones del panel (Fase 3): generador de codigos,
 * alta con codigo generado y reintento ante colision, regla estricta
 * expiresAt XOR isPermanent, cumplimiento del $jsonSchema de coupons,
 * edicion/desactivacion auditadas, validadores y filtro de productos aplicables.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { AdminCouponController } from '../../src/controllers/admin-coupon.controller.js';
import { couponsCollection } from '../../src/database/schemas/coupons.schema.js';
import { ApplicableProductDTO, CouponDTO, CreateCouponDTO, UpdateCouponDTO } from '../../src/dtos/admin-coupon.dto.js';
import { buildCouponFilter } from '../../src/repositories/admin-coupon.repository.js';
import { buildApplicableProductFilter } from '../../src/repositories/admin-product-query.repository.js';
import { AdminCouponService, resolveExpiration } from '../../src/services/admin-coupon.service.js';
import { AUDIT_ACTIONS } from '../../src/services/audit.service.js';
import { COUPON_CODE_ALPHABET, CouponCodeGenerator } from '../../src/services/coupon-code.generator.js';
import {
  applicableProductsQuerySchema,
  createCouponSchema,
  updateCouponSchema,
} from '../../src/validators/admin-coupon.validator.js';
import { validateSchema } from '../../src/validators/schema-validator.js';
import { adminActor, RecordingAuditService } from '../helpers/admin-fakes.js';
import { InMemoryAdminCouponRepository, InMemoryAdminProductQueryRepository } from '../helpers/admin-order-coupon-fakes.js';
import { jsonSchemaErrors, makeCoupon, makeProduct } from '../helpers/checkout-fakes.js';

const NOW = new Date('2026-06-01T10:00:00Z');
const FUTURE = '2026-12-31T23:59:59Z';
const COUPON_SCHEMA = couponsCollection.validator.$and[0].$jsonSchema;
const GENERATED_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;

/**
 * Valida el cuerpo como el middleware validate() y construye el DTO de alta.
 * @param {object} body
 */
function createDto(body) {
  assert.deepEqual(validateSchema(createCouponSchema, body), [], 'el cuerpo de prueba deberia ser valido');
  return CreateCouponDTO.from(body);
}

/**
 * Afirma que el documento cumple el $jsonSchema y las reglas cruzadas de coupons.schema.js.
 * @param {object} doc
 */
function assertCouponSchema(doc) {
  assert.deepEqual(jsonSchemaErrors(doc, COUPON_SCHEMA), []);
  assert.ok(doc.isPermanent === true || doc.validUntil > doc.validFrom, 'regla $or isPermanent / validUntil > validFrom');
  assert.ok(doc.discountType === 'fixed' || doc.discountValue <= 100, 'regla $or descuento porcentual <= 100');
}

/** Generador determinista que devuelve los codigos de la lista en orden. */
const scriptedGenerator = (codes) => {
  let index = 0;
  return { calls: () => index, generate: () => codes[index++] };
};

describe('CouponCodeGenerator', () => {
  it('genera codigos de 10 caracteres en mayuscula sin caracteres ambiguos', () => {
    const generator = new CouponCodeGenerator();
    for (let i = 0; i < 500; i += 1) {
      const code = generator.generate();
      assert.match(code, GENERATED_CODE);
      assert.doesNotMatch(code, /[01OIL]/);
      assert.match(code, /^[A-Z0-9_-]{3,30}$/, 'cumple el patron de coupons.schema.js');
    }
    assert.equal(/[01OIL]/.test(COUPON_CODE_ALPHABET), false);
  });

  it('no repite codigos en N generaciones', () => {
    const generator = new CouponCodeGenerator();
    const total = 5000;
    const codes = new Set(Array.from({ length: total }, () => generator.generate()));
    assert.equal(codes.size, total);
  });

  it('usa la fuente aleatoria inyectada en todo el alfabeto', () => {
    const calls = [];
    const generator = new CouponCodeGenerator({
      randomInt: (min, max) => {
        calls.push([min, max]);
        return calls.length - 1;
      },
    });
    assert.equal(generator.generate(), COUPON_CODE_ALPHABET.slice(0, 10));
    assert.ok(calls.every(([min, max]) => min === 0 && max === COUPON_CODE_ALPHABET.length));
  });

  it('rechaza configuraciones invalidas', () => {
    assert.throws(() => new CouponCodeGenerator({ length: 2 }));
    assert.throws(() => new CouponCodeGenerator({ alphabet: 'abc' }));
  });
});

describe('AdminCouponService', () => {
  let p1;
  let p2;
  let coupons;
  let products;
  let audit;
  let generator;
  let service;

  /** @param {{ generator?: object, coupons?: object[] }} [options] */
  function setup(options = {}) {
    p1 = makeProduct({ name: 'Teclado mecanico', priceCents: 45000, stock: 4, category: 'perifericos' });
    p2 = makeProduct({ name: 'Mouse (gamer)', priceCents: 15000, stock: 0, category: 'perifericos' });
    coupons = new InMemoryAdminCouponRepository(options.coupons ?? []);
    products = new InMemoryAdminProductQueryRepository([p1, p2]);
    audit = new RecordingAuditService();
    generator = options.generator ?? new CouponCodeGenerator();
    service = new AdminCouponService({
      adminCouponRepository: coupons,
      adminProductQueryRepository: products,
      couponCodeGenerator: generator,
      auditService: audit,
      clock: () => NOW,
    });
  }

  beforeEach(() => setup());

  describe('alta y generacion de codigo', () => {
    it('code ausente: genera un codigo seguro y el documento cumple el $jsonSchema', async () => {
      const coupon = await service.create(adminActor, createDto({ discountPercent: 15, isPermanent: true }));
      assert.match(coupon.code, GENERATED_CODE);
      assert.equal(coupon.discountType, 'percentage');
      assert.equal(coupon.discountValue, 15);
      assert.equal(coupon.isPermanent, true);
      assert.equal(coupon.validUntil, null);
      assert.deepEqual(coupon.validFrom, NOW);
      assert.deepEqual(coupon.applicableProductIds, []);
      assert.equal(coupon.usedCount, 0);
      assert.equal(coupon.isActive, true);
      assert.ok(coupon.createdBy.equals(new ObjectId(adminActor.id)));
      assertCouponSchema(coupons.peek(coupon._id));

      const change = audit.changes[0];
      assert.equal(change.action, AUDIT_ACTIONS.COUPON_CREATED);
      assert.equal(change.targetCollection, 'coupons');
      assert.equal(change.previousState, null);
      assert.equal(change.newState.code, coupon.code);
      assert.equal(change.metadata.generatedCode, true);
    });

    it('code vacio o con espacios tambien genera', async () => {
      const coupon = await service.create(adminActor, createDto({ code: '   ', discountPercent: 5, isPermanent: true }));
      assert.match(coupon.code, GENERATED_CODE);
      const other = await service.create(adminActor, createDto({ code: '', discountPercent: 5, isPermanent: true }));
      assert.match(other.code, GENERATED_CODE);
    });

    it('code enviado: se normaliza a mayusculas y un duplicado responde 409 sin reintentar', async () => {
      const body = { code: ' verano-26 ', discountPercent: 20, expiresAt: FUTURE, applicableProductIds: [p1._id.toString()] };
      const coupon = await service.create(adminActor, createDto(body));
      assert.equal(coupon.code, 'VERANO-26');
      assert.deepEqual(coupon.validUntil, new Date(FUTURE));
      assert.equal(coupon.isPermanent, false);
      assert.ok(coupon.applicableProductIds[0].equals(p1._id));
      assert.equal(audit.changes[0].metadata.generatedCode, false);
      assertCouponSchema(coupons.peek(coupon._id));

      await assert.rejects(service.create(adminActor, createDto({ ...body, code: 'Verano-26' })), {
        status: 409,
        code: 'COUPON_CODE_TAKEN',
      });
      assert.deepEqual(coupons.insertAttempts, ['VERANO-26', 'VERANO-26']);
    });

    it('reintenta ante colision del indice unico y usa el primer codigo libre', async () => {
      const scripted = scriptedGenerator(['TAKEN00001', 'TAKEN00002', 'FREECODE23']);
      setup({ generator: scripted });
      coupons.takenCodes = new Set(['TAKEN00001', 'TAKEN00002']);

      const coupon = await service.create(adminActor, createDto({ discountPercent: 10, isPermanent: true }));
      assert.equal(coupon.code, 'FREECODE23');
      assert.equal(scripted.calls(), 3);
      assert.deepEqual(coupons.insertAttempts, ['TAKEN00001', 'TAKEN00002', 'FREECODE23']);
    });

    it('agota los 5 intentos: 503 COUPON_CODE_GENERATION_FAILED sin crear nada', async () => {
      const scripted = { calls: 0, generate: () => (scripted.calls += 1, 'ALWAYSTAKN') };
      setup({ generator: scripted });
      coupons.takenCodes = new Set(['ALWAYSTAKN']);

      await assert.rejects(service.create(adminActor, createDto({ discountPercent: 10, isPermanent: true })), {
        status: 503,
        code: 'COUPON_CODE_GENERATION_FAILED',
      });
      assert.equal(scripted.calls, 5);
      assert.equal(coupons.docs.size, 0);
      assert.equal(audit.changes.length, 0);
    });

    it('un error distinto de la colision no se reintenta', async () => {
      coupons.insert = async () => {
        throw new Error('red caida');
      };
      await assert.rejects(service.create(adminActor, createDto({ discountPercent: 10, isPermanent: true })), /red caida/);
    });

    it('422 PRODUCTS_NOT_FOUND si algun producto aplicable no existe', async () => {
      const ghost = new ObjectId().toString();
      await assert.rejects(
        service.create(adminActor, createDto({ discountPercent: 10, isPermanent: true, applicableProductIds: [p1._id.toString(), ghost] })),
        (error) => {
          assert.equal(error.status, 422);
          assert.equal(error.code, 'PRODUCTS_NOT_FOUND');
          assert.deepEqual(error.details.productIds, [ghost]);
          return true;
        },
      );
      assert.equal(coupons.docs.size, 0);
    });

    it('documento completo con limites de uso cumple el $jsonSchema', async () => {
      const coupon = await service.create(
        adminActor,
        createDto({
          code: 'FULL_100',
          description: '  Descuento   de lanzamiento ',
          discountPercent: 100,
          applicableProductIds: [p1._id.toString(), p2._id.toString(), p1._id.toString().toUpperCase()],
          validFrom: '2026-06-10T00:00:00Z',
          expiresAt: '2026-07-10T00:00:00Z',
          maxUses: 50,
          maxUsesPerUser: 2,
        }),
      );
      assert.equal(coupon.description, 'Descuento de lanzamiento');
      assert.equal(coupon.applicableProductIds.length, 2, 'ids duplicados se colapsan');
      assert.equal(coupon.maxUses, 50);
      assert.equal(coupon.maxUsesPerUser, 2);
      assertCouponSchema(coupons.peek(coupon._id));
    });
  });

  describe('regla estricta expiresAt XOR isPermanent', () => {
    const cases = [
      [{ discountPercent: 10, expiresAt: FUTURE, isPermanent: true }, 'COUPON_EXPIRATION_CONFLICT'],
      [{ discountPercent: 10 }, 'COUPON_EXPIRATION_REQUIRED'],
      [{ discountPercent: 10, isPermanent: false }, 'COUPON_EXPIRATION_REQUIRED'],
      [{ discountPercent: 10, expiresAt: '2026-05-01T00:00:00Z' }, 'COUPON_EXPIRATION_IN_PAST'],
      [{ discountPercent: 10, expiresAt: '2026-07-01T00:00:00Z', validFrom: '2026-08-01T00:00:00Z' }, 'COUPON_EXPIRATION_BEFORE_START'],
    ];

    for (const [body, code] of cases) {
      it(`${JSON.stringify(body)} -> 422 ${code}`, async () => {
        await assert.rejects(service.create(adminActor, createDto(body)), { status: 422, code });
        assert.equal(coupons.docs.size, 0);
      });
    }

    it('expiresAt con isPermanent:false es valido', async () => {
      const coupon = await service.create(adminActor, createDto({ discountPercent: 10, expiresAt: FUTURE, isPermanent: false }));
      assert.equal(coupon.isPermanent, false);
      assert.deepEqual(coupon.validUntil, new Date(FUTURE));
    });

    it('resolveExpiration es pura y devuelve el mapeo a validUntil', () => {
      assert.deepEqual(resolveExpiration({ isPermanent: true }, { now: NOW, validFrom: NOW }), { isPermanent: true, validUntil: null });
      const until = new Date(FUTURE);
      assert.deepEqual(resolveExpiration({ expiresAt: until }, { now: NOW, validFrom: NOW }), { isPermanent: false, validUntil: until });
    });

    it('la edicion aplica la misma regla cuando se envia expiresAt o isPermanent', async () => {
      const coupon = await service.create(adminActor, createDto({ code: 'EDIT01', discountPercent: 10, expiresAt: FUTURE }));
      const id = coupon._id.toString();
      await assert.rejects(service.update(adminActor, id, UpdateCouponDTO.from({ isPermanent: true, expiresAt: FUTURE })), {
        status: 422,
        code: 'COUPON_EXPIRATION_CONFLICT',
      });
      await assert.rejects(service.update(adminActor, id, UpdateCouponDTO.from({ isPermanent: false })), {
        status: 422,
        code: 'COUPON_EXPIRATION_REQUIRED',
      });
      const permanent = await service.update(adminActor, id, UpdateCouponDTO.from({ isPermanent: true }));
      assert.equal(permanent.isPermanent, true);
      assert.equal(permanent.validUntil, null);
      assertCouponSchema(coupons.peek(id));
    });
  });

  describe('edicion y desactivacion', () => {
    let existing;

    beforeEach(() => {
      existing = makeCoupon({ code: 'BASE10', discountType: 'fixed', discountValue: 500, usedCount: 1 });
      setup({ coupons: [existing] });
    });

    it('PATCH actualiza descuento (pasa a porcentaje), productos y estado, y audita previo y nuevo', async () => {
      const updated = await service.update(
        adminActor,
        existing._id.toString(),
        UpdateCouponDTO.from({ discountPercent: 25, applicableProductIds: [p2._id.toString()], description: '' }),
        { ip: '1.1.1.1', userAgent: 'ua' },
      );
      assert.equal(updated.discountType, 'percentage');
      assert.equal(updated.discountValue, 25);
      assert.equal(updated.description, null);
      assert.ok(updated.applicableProductIds[0].equals(p2._id));
      assert.deepEqual(updated.updatedAt, NOW);
      assertCouponSchema(coupons.peek(existing._id));

      const change = audit.changes[0];
      assert.equal(change.action, AUDIT_ACTIONS.COUPON_UPDATED);
      assert.equal(change.previousState.discountType, 'fixed');
      assert.equal(change.newState.discountType, 'percentage');
      assert.deepEqual(change.metadata.changedFields.sort(), ['applicableProductIds', 'description', 'discountType', 'discountValue']);
      assert.deepEqual(change.context, { ip: '1.1.1.1', userAgent: 'ua' });
    });

    it('PATCH con productos inexistentes: 422 y sin cambios', async () => {
      await assert.rejects(
        service.update(adminActor, existing._id.toString(), UpdateCouponDTO.from({ applicableProductIds: [new ObjectId().toString()] })),
        { status: 422, code: 'PRODUCTS_NOT_FOUND' },
      );
      assert.deepEqual(coupons.peek(existing._id).applicableProductIds, []);
    });

    it('concurrencia optimista: si otro proceso modifico el cupon responde 409', async () => {
      const original = coupons.findById.bind(coupons);
      coupons.findById = async (id) => {
        const doc = await original(id);
        coupons.peek(id).updatedAt = new Date('2026-05-31T00:00:00Z');
        return doc;
      };
      await assert.rejects(service.update(adminActor, existing._id.toString(), UpdateCouponDTO.from({ isActive: false })), {
        status: 409,
        code: 'COUPON_MODIFIED_CONCURRENTLY',
      });
      assert.equal(audit.changes.length, 0);
    });

    it('deactivate: isActive false auditado; repetirlo es idempotente y no se audita', async () => {
      const result = await service.deactivate(adminActor, existing._id.toString());
      assert.equal(result.isActive, false);
      assert.equal(coupons.peek(existing._id).isActive, false);
      assert.equal(audit.changes[0].action, AUDIT_ACTIONS.COUPON_DEACTIVATED);
      assert.equal(audit.changes[0].previousState.isActive, true);
      assert.equal(audit.changes[0].newState.isActive, false);

      const again = await service.deactivate(adminActor, existing._id.toString());
      assert.equal(again.isActive, false);
      assert.equal(audit.changes.length, 1);
    });

    it('404 COUPON_NOT_FOUND en detalle, edicion y desactivacion', async () => {
      const ghost = new ObjectId().toString();
      await assert.rejects(service.getById(ghost), { status: 404, code: 'COUPON_NOT_FOUND' });
      await assert.rejects(service.update(adminActor, ghost, { isActive: true }), { status: 404 });
      await assert.rejects(service.deactivate(adminActor, ghost), { status: 404 });
    });

    it('listado con filtros isActive y prefijo de codigo', async () => {
      await service.create(adminActor, createDto({ code: 'OTRO', discountPercent: 5, isPermanent: true }));
      assert.equal((await service.list({ code: 'BASE' })).total, 1);
      assert.equal((await service.list({ isActive: true })).total, 2);
      assert.deepEqual(buildCouponFilter({ isActive: false, code: 'A.B' }), { isActive: false, code: { $regex: '^A\\.B' } });
    });
  });

  describe('productos aplicables', () => {
    it('convierte precios a centavos y aplica filtros', async () => {
      const result = await service.listApplicableProducts({ page: 1, limit: 10, minPrice: 100, maxPrice: 450.5, availability: 'inStock' });
      assert.deepEqual(products.lastCriteria, { page: 1, limit: 10, minPriceCents: 10000, maxPriceCents: 45050, availability: 'inStock' });
      assert.equal(result.total, 1);
      assert.deepEqual(ApplicableProductDTO.from(result.items[0]), {
        id: p1._id.toString(),
        sku: p1.sku,
        name: 'Teclado mecanico',
        category: 'perifericos',
        price: 450,
        discountPercent: 0,
        stock: 4,
        isActive: true,
      });
      const outOfStock = await service.listApplicableProducts({ availability: 'outOfStock' });
      assert.equal(outOfStock.items[0].name, 'Mouse (gamer)');
      await assert.rejects(service.listApplicableProducts({ minPrice: 10, maxPrice: 5 }), { status: 422 });
    });

    it('buildApplicableProductFilter escapa el nombre y traduce la disponibilidad', () => {
      assert.deepEqual(
        buildApplicableProductFilter({ name: 'Mouse (gamer).*', category: 'perifericos', availability: 'outOfStock', minPriceCents: 0, maxPriceCents: 500 }),
        {
          name: { $regex: 'Mouse \\(gamer\\)\\.\\*', $options: 'i' },
          category: 'perifericos',
          stock: { $lte: 0 },
          priceCents: { $gte: 0, $lte: 500 },
        },
      );
      assert.deepEqual(buildApplicableProductFilter({ availability: 'inStock' }), { stock: { $gt: 0 } });
      assert.deepEqual(buildApplicableProductFilter({}), {});
      assert.ok(new RegExp(buildApplicableProductFilter({ name: 'mouse (GAMER)' }).name.$regex, 'i').test(p2.name));
    });
  });

  describe('AdminCouponController', () => {
    it('POST responde 201 con Location y el cupon en unidades de la API', async () => {
      const controller = new AdminCouponController({ adminCouponService: service });
      const res = {
        statusCode: 200,
        headers: {},
        status(code) {
          this.statusCode = code;
          return this;
        },
        location(url) {
          this.headers.Location = url;
          return this;
        },
        json(body) {
          this.body = body;
          return this;
        },
      };
      const req = {
        user: adminActor,
        baseUrl: '/api/v1/admin/coupons',
        body: { discountPercent: 30, expiresAt: FUTURE },
        ip: '127.0.0.1',
        get: () => undefined,
      };
      await controller.create(req, res);
      assert.equal(res.statusCode, 201);
      assert.equal(res.headers.Location, `/api/v1/admin/coupons/${res.body.data.id}`);
      assert.equal(res.body.data.discountPercent, 30);
      assert.equal(res.body.data.expiresAt.toISOString(), new Date(FUTURE).toISOString());
      assert.equal(res.body.data.isGlobal, true);
      assert.match(res.body.data.code, GENERATED_CODE);
    });
  });
});

describe('Validacion de cupones', () => {
  const id = new ObjectId().toString();

  it('alta: acepta un cuerpo valido y rechaza campos desconocidos', () => {
    assert.deepEqual(validateSchema(createCouponSchema, { discountPercent: 10, isPermanent: true, applicableProductIds: [id] }), []);
    const errors = validateSchema(createCouponSchema, { discountPercent: 10, isPermanent: true, usedCount: 99 });
    assert.deepEqual(errors, [{ field: 'usedCount', message: 'Campo no permitido' }]);
  });

  it('alta: descuento 1..100 entero, codigo con patron, fechas ISO, ids validos y limites coherentes', () => {
    const field = (body) => validateSchema(createCouponSchema, { isPermanent: true, discountPercent: 10, ...body }).map((e) => e.field);
    assert.deepEqual(field({ discountPercent: 0 }), ['discountPercent']);
    assert.deepEqual(field({ discountPercent: 101 }), ['discountPercent']);
    assert.deepEqual(field({ discountPercent: 12.5 }), ['discountPercent']);
    assert.deepEqual(field({ discountPercent: undefined }), ['discountPercent']);
    assert.deepEqual(field({ code: 'ab' }), ['code']);
    assert.deepEqual(field({ code: 'con espacio' }), ['code']);
    assert.deepEqual(field({ code: 'promo_10' }), []);
    assert.deepEqual(field({ expiresAt: 'manana' }), ['expiresAt']);
    assert.deepEqual(field({ validFrom: '2026-13-45' }), ['validFrom']);
    assert.deepEqual(field({ applicableProductIds: 'x' }), ['applicableProductIds']);
    assert.deepEqual(field({ applicableProductIds: [id, 'nope'] }), ['applicableProductIds[1]']);
    assert.deepEqual(field({ applicableProductIds: [{ $ne: null }] }), ['applicableProductIds[0]']);
    assert.deepEqual(field({ maxUses: 5, maxUsesPerUser: 6 }), ['maxUsesPerUser']);
    assert.deepEqual(field({ maxUses: 0 }), ['maxUses']);
  });

  it('edicion: al menos un campo y sin campos ajenos', () => {
    assert.equal(validateSchema(updateCouponSchema, {})[0].field, '_root');
    assert.deepEqual(validateSchema(updateCouponSchema, { applicableProductIds: [] }), []);
    assert.deepEqual(validateSchema(updateCouponSchema, { isActive: false }), []);
    assert.deepEqual(validateSchema(updateCouponSchema, { code: 'NUEVO', isActive: true }), [{ field: 'code', message: 'Campo no permitido' }]);
    assert.deepEqual(
      validateSchema(updateCouponSchema, { code: 'NUEVO' }).map((error) => error.field),
      ['code', '_root'],
    );
  });

  it('productos aplicables: minPrice <= maxPrice y disponibilidad cerrada', () => {
    assert.deepEqual(validateSchema(applicableProductsQuerySchema, { minPrice: '10', maxPrice: '20.50', availability: 'inStock' }), []);
    assert.equal(validateSchema(applicableProductsQuerySchema, { minPrice: '30', maxPrice: '20' })[0].field, 'minPrice');
    assert.equal(validateSchema(applicableProductsQuerySchema, { availability: 'all' })[0].field, 'availability');
  });

  it('CouponDTO expone discountPercent y expiresAt; monto fijo en unidades', () => {
    const percentage = CouponDTO.from(makeCoupon({ isPermanent: false, validUntil: new Date(FUTURE) }));
    assert.equal(percentage.discountPercent, 10);
    assert.deepEqual(percentage.expiresAt, new Date(FUTURE));
    const fixed = CouponDTO.from(makeCoupon({ discountType: 'fixed', discountValue: 2500 }));
    assert.equal(fixed.discountPercent, null);
    assert.equal(fixed.discountValue, 25);
  });
});
