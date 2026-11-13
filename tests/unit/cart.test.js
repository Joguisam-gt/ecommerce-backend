/**
 * Pruebas del carrito y la liquidacion: calculo de caja, politica de cupones,
 * CartService, CartDTO y el cuerpo 409 INSUFFICIENT_STOCK del error-handler.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { AddCartItemDTO, ApplyCouponDTO, CartDTO } from '../../src/dtos/cart.dto.js';
import { createErrorHandler } from '../../src/middlewares/error-handler.js';
import { COUPON_REJECTIONS, evaluateCoupon } from '../../src/services/pricing/coupon.policy.js';
import { PricingCalculator } from '../../src/services/pricing/pricing.calculator.js';
import { HttpError } from '../../src/utils/http-error.js';
import { silentLogger } from '../../src/utils/logger.js';
import { NOW, makeCartHarness, makeCoupon, makeProduct } from '../helpers/cart-fakes.js';

const calculator = new PricingCalculator();

/** Dos lineas del enunciado: A con 15% de descuento (2 x 100.00) y B sin descuento (1 x 50.00), IVA 12%. */
const lineA = { productId: 'a'.repeat(24), sku: 'A', name: 'A', quantity: 2, unitPriceCents: 10000, discountPercent: 15, taxRatePercent: 12 };
const lineB = { productId: 'b'.repeat(24), sku: 'B', name: 'B', quantity: 1, unitPriceCents: 5000, discountPercent: 0, taxRatePercent: 12 };

describe('PricingCalculator', () => {
  it('calcula a mano 2 lineas con y sin descuento e impuesto del 12%', () => {
    const { lines, totals } = calculator.calculate([lineA, lineB]);
    // A: subtotal 20000, descuento 3000, neto 17000, impuesto 2040. B: 5000, 0, 5000, 600.
    assert.equal(lines[0].unitFinalPriceCents, 8500);
    assert.equal(lines[0].taxCents, 2040);
    assert.equal(lines[1].taxCents, 600);
    assert.equal(totals.subtotalCents, 25000);
    assert.equal(totals.productDiscountCents, 3000);
    assert.equal(totals.couponDiscountCents, 0);
    assert.equal(totals.discountTotalCents, 3000);
    assert.equal(totals.taxTotalCents, 2640);
    assert.equal(totals.grandTotalCents, 24640);
    assert.equal(totals.totalItemsCount, 3);
  });

  it('cupon porcentual 10% solo sobre productos aplicables y el impuesto va sobre la base descontada', () => {
    const coupon = { couponId: 'c', code: 'P10', discountType: 'percentage', discountValue: 10, applicableProductIds: [lineA.productId] };
    const { lines, totals } = calculator.calculate([lineA, lineB], coupon);
    assert.equal(lines[0].couponDiscountCents, 1700);
    assert.equal(lines[1].couponDiscountCents, 0);
    assert.equal(lines[0].taxableCents, 15300);
    assert.equal(lines[0].taxCents, 1836); // 12% de 15300, no de 17000
    assert.equal(totals.couponDiscountCents, 1700);
    assert.equal(totals.discountTotalCents, 4700);
    assert.equal(totals.taxTotalCents, 2436);
    assert.equal(totals.grandTotalCents, 22736);
  });

  it('cupon fijo se reparte proporcionalmente con suma exacta', () => {
    const coupon = { couponId: 'c', code: 'F', discountType: 'fixed', discountValue: 3333, applicableProductIds: [] };
    const { lines, totals } = calculator.calculate([lineA, lineB], coupon);
    assert.equal(lines[0].couponDiscountCents + lines[1].couponDiscountCents, 3333);
    assert.equal(totals.couponDiscountCents, 3333);
    assert.ok(lines[0].couponDiscountCents > lines[1].couponDiscountCents);
  });

  it('cupon fijo nunca supera el neto aplicable', () => {
    const coupon = { couponId: 'c', code: 'F', discountType: 'fixed', discountValue: 999999, applicableProductIds: [lineB.productId] };
    const { lines, totals } = calculator.calculate([lineA, lineB], coupon);
    assert.equal(lines[1].couponDiscountCents, 5000);
    assert.equal(lines[0].couponDiscountCents, 0);
    assert.equal(lines[1].grandTotalCents, 0);
    assert.equal(totals.couponDiscountCents, 5000);
  });
});

describe('coupon.policy evaluateCoupon', () => {
  const { lines } = calculator.calculate([lineA, lineB]);
  const evaluate = (coupon, extra = {}) => evaluateCoupon(coupon, { lines, now: NOW, ...extra });

  it('rechaza cupon inexistente', () => {
    assert.equal(evaluate(null).reason, COUPON_REJECTIONS.NOT_FOUND);
  });

  it('rechaza cupon inactivo', () => {
    assert.equal(evaluate(makeCoupon({ isActive: false })).reason, COUPON_REJECTIONS.INACTIVE);
  });

  it('rechaza cupon que aun no inicia', () => {
    assert.equal(evaluate(makeCoupon({ validFrom: new Date('2026-12-01T00:00:00Z') })).reason, COUPON_REJECTIONS.NOT_STARTED);
  });

  it('rechaza cupon expirado', () => {
    const coupon = makeCoupon({ isPermanent: false, validUntil: new Date('2026-06-01T00:00:00Z') });
    assert.equal(evaluate(coupon).reason, COUPON_REJECTIONS.EXPIRED);
  });

  it('acepta isPermanent true con validUntil null', () => {
    const result = evaluate(makeCoupon({ isPermanent: true, validUntil: null }));
    assert.equal(result.valid, true);
  });

  it('rechaza por limite global', () => {
    assert.equal(evaluate(makeCoupon({ maxUses: 5, usedCount: 5 })).reason, COUPON_REJECTIONS.USAGE_LIMIT_REACHED);
  });

  it('rechaza por limite por usuario', () => {
    const coupon = makeCoupon({ maxUsesPerUser: 1 });
    assert.equal(evaluate(coupon, { userUsageCount: 1 }).reason, COUPON_REJECTIONS.USER_LIMIT_REACHED);
    assert.equal(evaluate(coupon, { userUsageCount: 0 }).valid, true);
  });

  it('rechaza si no aplica a ningun producto del carrito', () => {
    const coupon = makeCoupon({ applicableProductIds: [new ObjectId()] });
    assert.equal(evaluate(coupon).reason, COUPON_REJECTIONS.NOT_APPLICABLE);
  });

  it('rechaza si no alcanza la compra minima', () => {
    // El neto del carrito es 22000 centavos.
    assert.equal(evaluate(makeCoupon({ minOrderCents: 22001 })).reason, COUPON_REJECTIONS.MIN_ORDER_NOT_MET);
    assert.equal(evaluate(makeCoupon({ minOrderCents: 22000 })).valid, true);
  });
});

describe('CartService', () => {
  /** Carrito con un producto de 100.00, IVA 12%, stock 5. */
  function setup(productOverrides = {}, couponList = []) {
    const product = makeProduct({ stock: 5, ...productOverrides });
    const harness = makeCartHarness({ products: [product], coupons: couponList });
    return { ...harness, product, productId: product._id.toString() };
  }

  it('addItem agrega y calcula la caja', async () => {
    const { cartService, actor, productId } = setup();
    const result = await cartService.addItem(actor, { productId, quantity: 2 });
    assert.equal(result.pricing.totals.subtotalCents, 20000);
    assert.equal(result.pricing.totals.grandTotalCents, 22400);
  });

  it('addItem responde 409 INSUFFICIENT_STOCK con el stock disponible', async () => {
    const { cartService, actor, productId } = setup();
    await assert.rejects(cartService.addItem(actor, { productId, quantity: 6 }), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.body.error, 'INSUFFICIENT_STOCK');
      assert.equal(err.body.availableStock, 5);
      assert.equal(err.body.productId, productId);
      return true;
    });
  });

  it('addItem suma con lo existente y da 409 si lo supera', async () => {
    const { cartService, actor, productId, cartRepository, userId } = setup();
    await cartService.addItem(actor, { productId, quantity: 3 });
    await assert.rejects(cartService.addItem(actor, { productId, quantity: 3 }), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.body.availableStock, 5);
      return true;
    });
    const ok = await cartService.addItem(actor, { productId, quantity: 2 });
    assert.equal(ok.cart.items[0].quantity, 5);
    assert.equal((await cartRepository.findByUserId(userId)).items.length, 1);
  });

  it('addItem con producto inactivo o inexistente responde 404', async () => {
    const inactive = makeProduct({ isActive: false });
    const harness = makeCartHarness({ products: [inactive] });
    await assert.rejects(harness.cartService.addItem(harness.actor, { productId: inactive._id.toString(), quantity: 1 }), {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
    await assert.rejects(harness.cartService.addItem(harness.actor, { productId: new ObjectId().toString(), quantity: 1 }), {
      status: 404,
    });
  });

  it('addItem respeta el limite de cantidad por linea', async () => {
    const { cartService, actor, productId } = setup({ stock: 5000 });
    await assert.rejects(cartService.addItem(actor, { productId, quantity: 1000 }), { status: 422, code: 'QUANTITY_LIMIT' });
  });

  it('updateItemQuantity fija la cantidad, valida stock y 404 si no esta', async () => {
    const { cartService, actor, productId } = setup();
    await assert.rejects(cartService.updateItemQuantity(actor, productId, 1), { status: 404, code: 'CART_ITEM_NOT_FOUND' });
    await cartService.addItem(actor, { productId, quantity: 1 });
    const result = await cartService.updateItemQuantity(actor, productId, 4);
    assert.equal(result.cart.items[0].quantity, 4);
    await assert.rejects(cartService.updateItemQuantity(actor, productId, 9), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.body.availableStock, 5);
      return true;
    });
  });

  it('removeItem quita la linea y 404 si no esta', async () => {
    const { cartService, actor, productId } = setup();
    await cartService.addItem(actor, { productId, quantity: 1 });
    const result = await cartService.removeItem(actor, productId);
    assert.equal(result.pricing.totals.totalItemsCount, 0);
    await assert.rejects(cartService.removeItem(actor, productId), { status: 404 });
  });

  it('applyCoupon invalido lanza 422 y el carrito no cambia', async () => {
    const expired = makeCoupon({ code: 'VIEJO', isPermanent: false, validUntil: new Date('2026-01-02T00:00:00Z') });
    const { cartService, actor, productId, cartRepository, userId } = setup({}, [expired]);
    const before = await cartService.addItem(actor, { productId, quantity: 2 });

    await assert.rejects(cartService.applyCoupon(actor, 'viejo'), { status: 422, code: COUPON_REJECTIONS.EXPIRED });
    await assert.rejects(cartService.applyCoupon(actor, 'NOEXISTE'), { status: 422, code: COUPON_REJECTIONS.NOT_FOUND });

    assert.equal((await cartRepository.findByUserId(userId)).couponCode, null);
    const after = await cartService.getCart(actor);
    assert.equal(after.pricing.totals.grandTotalCents, before.pricing.totals.grandTotalCents);
    assert.equal(after.coupon, null);
  });

  it('applyCoupon con carrito vacio responde 422 CART_EMPTY', async () => {
    const { cartService, actor } = setup({}, [makeCoupon()]);
    await assert.rejects(cartService.applyCoupon(actor, 'PROMO10'), { status: 422, code: 'CART_EMPTY' });
  });

  it('applyCoupon valido reduce el total y removeCoupon lo restaura', async () => {
    const { cartService, actor, productId } = setup({}, [makeCoupon()]);
    const before = await cartService.addItem(actor, { productId, quantity: 2 });
    const applied = await cartService.applyCoupon(actor, ' promo10 ');
    assert.equal(applied.coupon.applied, true);
    assert.equal(applied.pricing.totals.couponDiscountCents, 2000);
    assert.ok(applied.pricing.totals.grandTotalCents < before.pricing.totals.grandTotalCents);
    const removed = await cartService.removeCoupon(actor);
    assert.equal(removed.coupon, null);
    assert.equal(removed.pricing.totals.grandTotalCents, before.pricing.totals.grandTotalCents);
  });

  it('cupon que deja de ser valido: getCart devuelve applied false y totales sin cupon', async () => {
    const coupon = makeCoupon({ isPermanent: false, validUntil: new Date('2026-07-01T00:00:00Z') });
    const { cartService, actor, productId, state } = setup({}, [coupon]);
    const base = await cartService.addItem(actor, { productId, quantity: 2 });
    await cartService.applyCoupon(actor, 'PROMO10');

    state.now = new Date('2026-08-01T00:00:00Z');
    const result = await cartService.getCart(actor);
    assert.equal(result.coupon.applied, false);
    assert.equal(result.coupon.reason, COUPON_REJECTIONS.EXPIRED);
    assert.equal(result.pricing.totals.couponDiscountCents, 0);
    assert.equal(result.pricing.totals.grandTotalCents, base.pricing.totals.grandTotalCents);
  });
});

describe('CartDTO', () => {
  it('convierte a decimales y mantiene la suma', async () => {
    const product = makeProduct({ priceCents: 4999, discountPercent: 10, stock: 7, images: ['http://img/1.png'] });
    const { cartService, actor } = (() => {
      const h = makeCartHarness({ products: [product], coupons: [makeCoupon()] });
      return h;
    })();
    await cartService.addItem(actor, { productId: product._id.toString(), quantity: 3 });
    const result = await cartService.applyCoupon(actor, 'PROMO10');
    const dto = CartDTO.from(result, { currency: 'GTQ' });

    const [item] = dto.items;
    assert.equal(dto.currency, 'GTQ');
    assert.equal(item.imageUrl, 'http://img/1.png');
    assert.equal(item.availableStock, 7);
    assert.equal(item.unitPrice, 49.99);
    assert.equal(item.subtotal, 149.97);
    assert.equal(dto.summary.subtotal, 149.97);
    assert.equal(dto.summary.totalItemsCount, 3);
    assert.equal(dto.coupon.applied, true);
    assert.equal(dto.coupon.discount, dto.summary.couponDiscountTotal);
    // grandTotal = subtotal - descuentos + impuesto (con tolerancia de redondeo a centavos)
    const expected = Math.round((dto.summary.subtotal - dto.summary.discountTotal + dto.summary.taxTotal) * 100) / 100;
    assert.equal(dto.summary.grandTotal, expected);
    assert.equal(item.grandTotal, dto.summary.grandTotal);
  });

  it('DTOs de entrada normalizan', () => {
    assert.deepEqual(AddCartItemDTO.from({ productId: 'x', quantity: 2 }), { productId: 'x', quantity: 2 });
    assert.deepEqual(ApplyCouponDTO.from({ code: '  promo10 ' }), { code: 'PROMO10' });
  });
});

describe('error-handler INSUFFICIENT_STOCK', () => {
  it('produce 409 con el cuerpo contractual', () => {
    const res = {
      headersSent: false,
      statusCode: 200,
      body: undefined,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    const handler = createErrorHandler({ logger: silentLogger, isProduction: false });
    handler(HttpError.insufficientStock(3, 'abc'), { path: '/', method: 'POST' }, res, () => {});
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, {
      error: 'INSUFFICIENT_STOCK',
      availableStock: 3,
      productId: 'abc',
      message: 'No hay stock suficiente para la cantidad solicitada',
    });
  });
});
