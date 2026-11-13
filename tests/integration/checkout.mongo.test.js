/**
 * Prueba de integracion del checkout contra un MongoDB REAL con replica set
 * (las transacciones multi-documento lo requieren).
 *
 * Se omite automaticamente si no se define MONGODB_TEST_URI. Ejemplo:
 *   docker run -d --name mongo-rs -p 27017:27017 mongo:8.0 --replSet rs0
 *   docker exec mongo-rs mongosh --eval "rs.initiate()"
 *   MONGODB_TEST_URI="mongodb://localhost:27017/?replicaSet=rs0&directConnection=true" npm test
 *
 * Verifica de extremo a extremo (HTTP + servicios + repositorios + $jsonSchema):
 * - checkout correcto: stock descontado, pedido y factura validos, carrito vacio.
 * - rollback real: si falla el segundo producto, el primero recupera su stock y
 *   no quedan pedido, factura ni consumo de secuencia o cupon.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { MongoClient, ObjectId } from 'mongodb';
import { createApp } from '../../src/app.js';
import { buildContainer } from '../../src/container.js';
import { COLLECTIONS } from '../../src/database/collections.js';
import { ensureCollections } from '../../src/database/setup.js';
import { ROLES } from '../../src/constants/roles.js';
import { silentLogger } from '../../src/utils/logger.js';
import { TEST_PASSWORD, makeUser, testConfig } from '../helpers/fixtures.js';

const uri = process.env.MONGODB_TEST_URI;

describe('Checkout ACID contra MongoDB real', { skip: !uri && 'Define MONGODB_TEST_URI (replica set) para ejecutarla' }, () => {
  let client;
  let db;
  let server;
  let baseUrl;
  let token;
  const customer = makeUser({ role: ROLES.USER, email: 'compras@example.com' });

  /** Producto valido segun products.schema.js. */
  const product = (sku, overrides = {}) => ({
    _id: new ObjectId(),
    sku,
    name: `Producto ${sku}`,
    slug: sku.toLowerCase(),
    description: null,
    priceCents: 10000,
    discountPercent: 10,
    taxRatePercent: 12,
    stock: 5,
    category: 'pruebas',
    tags: [],
    images: [],
    isActive: true,
    isFeatured: false,
    pickupAvailable: true,
    acceptedPaymentMethods: ['card', 'cash_on_delivery', 'bank_transfer'],
    ratingAverage: 0,
    ratingCount: 0,
    supplierId: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const first = product('RS-001');
  const second = product('RS-002', { stock: 2 });

  /** Peticion JSON autenticada con fetch nativo. */
  async function call(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  const cardPayment = {
    paymentMethod: 'card',
    payment: { paymentToken: 'tok_visa_approved_123', last4: '4242', cardHolderName: 'Ana Perez', cardBrand: 'Visa' },
  };

  before(async () => {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db(`ecommerce_it_${Date.now()}`);
    await ensureCollections(db);
    await db.collection(COLLECTIONS.USERS).insertOne(customer);
    await db.collection(COLLECTIONS.PRODUCTS).insertMany([first, second]);

    const container = buildContainer({ db, mongoClient: client, config: testConfig, logger: silentLogger });
    const app = createApp({ config: testConfig, container, logger: silentLogger });
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;

    const login = await fetch(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customer.email, password: TEST_PASSWORD }),
    });
    token = (await login.json()).data.accessToken;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.dropDatabase();
    await client.close();
  });

  it('rollback real: un fallo de stock en el segundo producto revierte todo', async () => {
    await call('/cart/items', { method: 'POST', body: { productId: first._id.toString(), quantity: 2 } });
    await call('/cart/items', { method: 'POST', body: { productId: second._id.toString(), quantity: 2 } });

    // Otra venta "concurrente" deja al segundo producto con 1 unidad despues de armar el carrito.
    await db.collection(COLLECTIONS.PRODUCTS).updateOne({ _id: second._id }, { $set: { stock: 1 } });

    const { status, body } = await call('/pos/checkout', { method: 'POST', body: cardPayment });
    assert.equal(status, 409);
    assert.equal(body.error, 'INSUFFICIENT_STOCK');
    assert.equal(body.availableStock, 1);

    const stocks = await db.collection(COLLECTIONS.PRODUCTS).find({}, { projection: { sku: 1, stock: 1 } }).toArray();
    assert.equal(stocks.find((p) => p.sku === 'RS-001').stock, 5, 'el primer producto debe recuperar su stock');
    assert.equal(await db.collection(COLLECTIONS.ORDERS).countDocuments(), 0);
    assert.equal(await db.collection(COLLECTIONS.INVOICES).countDocuments(), 0);
    assert.equal(await db.collection(COLLECTIONS.COUNTERS).countDocuments(), 0);
    const cart = await db.collection(COLLECTIONS.CARTS).findOne({ userId: customer._id });
    assert.equal(cart.items.length, 2, 'el carrito no se vacia');
  });

  it('checkout correcto: descuenta stock, crea pedido y factura validos y vacia el carrito', async () => {
    await db.collection(COLLECTIONS.PRODUCTS).updateOne({ _id: second._id }, { $set: { stock: 2 } });

    const { status, body } = await call('/pos/checkout', { method: 'POST', body: cardPayment });
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.data.order.status, 'paid');
    assert.equal(body.data.invoice.nitType, 'user_code');
    assert.equal(body.data.invoice.grandTotal, body.data.order.totals.grandTotal);

    // 2 x 100.00 con 10% = 180.00 por producto; 360.00 + 12% = 403.20
    assert.equal(body.data.invoice.grandTotal, 403.2);

    const stocks = await db.collection(COLLECTIONS.PRODUCTS).find({}, { projection: { sku: 1, stock: 1 } }).toArray();
    assert.equal(stocks.find((p) => p.sku === 'RS-001').stock, 3);
    assert.equal(stocks.find((p) => p.sku === 'RS-002').stock, 0);
    assert.equal(await db.collection(COLLECTIONS.ORDERS).countDocuments(), 1);
    assert.equal(await db.collection(COLLECTIONS.INVOICES).countDocuments(), 1);
    const cart = await db.collection(COLLECTIONS.CARTS).findOne({ userId: customer._id });
    assert.equal(cart.items.length, 0);
  });

  it('el stock no puede quedar negativo: un nuevo intento devuelve 409', async () => {
    const add = await call('/cart/items', { method: 'POST', body: { productId: second._id.toString(), quantity: 1 } });
    assert.equal(add.status, 409);
    assert.equal(add.body.availableStock, 0);
  });
});
