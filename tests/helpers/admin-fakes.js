/**
 * Dobles en memoria compartidos por las pruebas del panel de administracion (Fase 3).
 *
 * - InMemoryInventoryStockRepository: mismo contrato que InventoryStockRepository,
 *   con snapshot()/restore() para participar en InMemoryTransactionRunner y
 *   exigencia de sesion en las escrituras.
 * - RecordingAuditService: captura las llamadas a recordChange/record.
 * - adminActor / superuserActor / customerActor: actores autenticados de prueba.
 */
import { ObjectId } from 'mongodb';
import { ROLES } from '../../src/constants/roles.js';
import { deepClone } from './checkout-fakes.js';

/**
 * Falla si una escritura transaccional llega sin sesion.
 * @param {object | undefined} session
 * @param {string} operation
 */
function assertSession(session, operation) {
  if (!session) throw new Error(`${operation} se invoco sin la sesion de la transaccion`);
}

export class InMemoryInventoryStockRepository {
  /** @type {Map<string, object>} productos por id */
  docs = new Map();

  /** @param {object[]} [seed] Productos (p. ej. makeProduct()). */
  constructor(seed = []) {
    for (const product of seed) this.docs.set(product._id.toString(), deepClone(product));
  }

  snapshot() {
    return new Map([...this.docs].map(([key, doc]) => [key, deepClone(doc)]));
  }

  /** @param {Map<string, object>} snapshot */
  restore(snapshot) {
    this.docs = new Map([...snapshot].map(([key, doc]) => [key, deepClone(doc)]));
  }

  /** @param {unknown} id */
  peek(id) {
    return this.docs.get(id.toString());
  }

  async incrementStock(productId, quantity, { session } = {}) {
    assertSession(session, 'incrementStock');
    const doc = this.docs.get(productId.toString());
    if (!doc) return false;
    doc.stock += quantity;
    return true;
  }

  async receiveStock(productId, quantity, costCents, { session } = {}) {
    assertSession(session, 'receiveStock');
    const doc = this.docs.get(productId.toString());
    if (!doc) return false;
    doc.stock += quantity;
    doc.costCents = costCents;
    return true;
  }

  async decrementStock(productId, quantity, { session } = {}) {
    assertSession(session, 'decrementStock');
    const doc = this.docs.get(productId.toString());
    if (!doc || doc.stock < quantity) return false;
    doc.stock -= quantity;
    return true;
  }
}

export class RecordingAuditService {
  /** @type {object[]} */
  changes = [];

  /** @type {object[]} */
  events = [];

  async recordChange(change) {
    this.changes.push(deepClone(change));
  }

  async record(event) {
    this.events.push(deepClone(event));
  }
}

/** Actores autenticados de prueba (forma de req.user). */
export const adminActor = Object.freeze({ id: new ObjectId().toString(), role: ROLES.ADMIN });
export const superuserActor = Object.freeze({ id: new ObjectId().toString(), role: ROLES.SUPERUSER });
export const customerActor = Object.freeze({ id: new ObjectId().toString(), role: ROLES.USER });
