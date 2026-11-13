/**
 * Dobles de prueba de la PARTE C del panel (clientes, facturacion admin y reportes).
 *
 * - InMemoryCustomerRepository: mismo contrato que CustomerRepository; las
 *   escrituras respetan role 'user' en el filtro y simulan el indice unico de userCode.
 * - FakeReportRepository: devuelve resultados fijos y registra las llamadas.
 * - InMemoryAdminInvoiceRepository: busqueda minima por id.
 * - startRouterApp: monta un sub-router con un actor fijo en req.user y el
 *   manejador de errores real, para probar rutas con fetch nativo.
 */
import express from 'express';
import { ROLES } from '../../src/constants/roles.js';
import { createErrorHandler } from '../../src/middlewares/error-handler.js';
import { silentLogger } from '../../src/utils/logger.js';
import { deepClone } from './checkout-fakes.js';

export class InMemoryCustomerRepository {
  /** @type {Map<string, object>} usuarios por id */
  docs = new Map();

  /** Filas de directorio devueltas por findDetailById/listDirectory (por id). */
  detailRows = new Map();

  /** Si es true, updateById lanza un E11000 (carrera en el indice unico). */
  failWithDuplicateKey = false;

  /** @param {object[]} [seed] Documentos de users (p. ej. makeUser()). */
  constructor(seed = []) {
    for (const user of seed) this.docs.set(user._id.toString(), deepClone(user));
  }

  /** @param {unknown} id */
  peek(id) {
    return this.docs.get(id.toString());
  }

  async listDirectory(filters, pagination) {
    this.lastListCall = { filters, pagination };
    const items = [...this.detailRows.values()].map(deepClone);
    return { items, total: items.length };
  }

  async findDetailById(id) {
    const user = this.docs.get(id.toString());
    if (!user || user.role !== ROLES.USER) return null;
    return deepClone(this.detailRows.get(id.toString()) ?? { _id: user._id, name: `${user.firstName} ${user.lastName}` });
  }

  async findById(id) {
    const doc = this.docs.get(id.toString());
    return doc ? deepClone(doc) : null;
  }

  async findByUserCode(userCode) {
    const doc = [...this.docs.values()].find((user) => user.userCode === userCode);
    return doc ? deepClone(doc) : null;
  }

  async updateById(id, changes, now) {
    if (this.failWithDuplicateKey) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const doc = this.docs.get(id.toString());
    if (!doc || doc.role !== ROLES.USER) return null;
    Object.assign(doc, changes, { updatedAt: now });
    return deepClone(doc);
  }

  async deactivate(id, now) {
    const doc = this.docs.get(id.toString());
    if (!doc || doc.role !== ROLES.USER) return null;
    Object.assign(doc, { isActive: false, updatedAt: now, tokenVersion: doc.tokenVersion + 1 });
    return deepClone(doc);
  }

  async deleteById(id) {
    const doc = this.docs.get(id.toString());
    if (!doc || doc.role !== ROLES.USER) return false;
    return this.docs.delete(id.toString());
  }
}

export class FakeReportRepository {
  /** @type {Array<{ method: string, args: unknown[] }>} */
  calls = [];

  /** Fila devuelta por supplierPerformance (null simula producto inexistente). */
  performanceRow = null;

  /**
   * Registra una llamada.
   * @param {string} method
   * @param {unknown[]} args
   */
  #track(method, args) {
    this.calls.push({ method, args });
  }

  async salesFacets(...args) {
    this.#track('salesFacets', args);
    return {
      salesSummary: { revenueCents: 123450, unitsSold: 7, ordersCount: 3, averageTicketCents: 41150 },
      paymentMethodBreakdown: [{ method: 'card', ordersCount: 2, revenueCents: 100000 }],
      couponRanking: [{ code: 'PROMO10', uses: 2, totalDiscountCents: 1500, revenueCents: 90000 }],
      topProducts: [],
    };
  }

  async lossesSummary(...args) {
    this.#track('lossesSummary', args);
    return { byReason: [{ reason: 'expired', units: 4, totalLossCents: 2000, records: 2 }], totals: { units: 4, totalLossCents: 2000, records: 2 } };
  }

  async inventoryStatus(...args) {
    this.#track('inventoryStatus', args);
    return { products: [], totals: { products: 0, units: 0, inventoryCostCents: 0, inventoryRetailCents: 0, lowStockCount: 0 } };
  }

  async supplierPerformance(...args) {
    this.#track('supplierPerformance', args);
    return this.performanceRow ? deepClone(this.performanceRow) : null;
  }
}

export class InMemoryAdminInvoiceRepository {
  /** @param {object[]} [seed] */
  constructor(seed = []) {
    this.docs = new Map(seed.map((invoice) => [invoice._id.toString(), deepClone(invoice)]));
  }

  async search({ page, limit }) {
    const items = [...this.docs.values()];
    return { items: items.slice((page - 1) * limit, page * limit).map(deepClone), total: items.length };
  }

  async findById(id) {
    const doc = this.docs.get(id.toString());
    return doc ? deepClone(doc) : null;
  }
}

/**
 * Levanta una app Express minima con un sub-router y el actor dado en req.user.
 * El actor se puede cambiar por peticion con la cabecera x-test-role.
 * @param {import('express').Router} router
 * @param {Record<string, { id: string, role: string }>} actorsByRole
 * @returns {Promise<{ call: Function, close: () => Promise<void> }>}
 */
export async function startRouterApp(router, actorsByRole) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = actorsByRole[req.get('x-test-role')] ?? null;
    next();
  });
  app.use('/', router);
  app.use(createErrorHandler({ logger: silentLogger, isProduction: false }));

  const server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  /**
   * Peticion JSON con fetch nativo.
   * @param {string} path
   * @param {{ method?: string, role?: string, body?: object }} [options]
   */
  async function call(path, { method = 'GET', role, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (role) headers['x-test-role'] = role;
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  return { call, close: () => new Promise((resolve) => server.close(resolve)) };
}
