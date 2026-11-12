/**
 * Dobles en memoria de los repositorios.
 *
 * Implementan el mismo contrato publico que UserRepository y AuditLogRepository
 * (principio de sustitucion de Liskov), lo que permite probar servicios,
 * middlewares y rutas sin un servidor de MongoDB. Tambien simulan el indice
 * unico de email lanzando un error con code 11000.
 */
import { ObjectId } from 'mongodb';

export class InMemoryUserRepository {
  /** @type {Map<string, object>} */
  #docs = new Map();

  /** @param {object[]} [seed] Documentos iniciales (deben traer _id). */
  constructor(seed = []) {
    for (const doc of seed) this.#docs.set(doc._id.toString(), { ...doc });
  }

  /** Copia superficial para que las pruebas no muten el estado interno. */
  #clone(doc) {
    return doc ? { ...doc } : null;
  }

  /** Aplica cambios y devuelve la copia actualizada. */
  #patch(id, mutate) {
    const doc = this.#docs.get(id.toString());
    if (!doc) return null;
    mutate(doc);
    return this.#clone(doc);
  }

  async findById(id) {
    return this.#clone(this.#docs.get(id.toString()));
  }

  async findByEmail(email) {
    return this.#clone([...this.#docs.values()].find((doc) => doc.email === email));
  }

  async create(document) {
    if ([...this.#docs.values()].some((doc) => doc.email === document.email)) {
      throw Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyValue: { email: document.email } });
    }
    const doc = { ...document, _id: new ObjectId() };
    this.#docs.set(doc._id.toString(), doc);
    return this.#clone(doc);
  }

  async updateById(id, changes, now) {
    return this.#patch(id, (doc) => Object.assign(doc, changes, { updatedAt: now }));
  }

  async updatePassword(id, passwordHash, now) {
    return this.#patch(id, (doc) => Object.assign(doc, { passwordHash, updatedAt: now, tokenVersion: doc.tokenVersion + 1 }));
  }

  async updateRole(id, role, now) {
    return this.#patch(id, (doc) => Object.assign(doc, { role, updatedAt: now, tokenVersion: doc.tokenVersion + 1 }));
  }

  async updateStatus(id, isActive, now) {
    return this.#patch(id, (doc) => {
      Object.assign(doc, { isActive, updatedAt: now });
      if (!isActive) doc.tokenVersion += 1;
    });
  }

  async incrementTokenVersion(id) {
    return this.#patch(id, (doc) => {
      doc.tokenVersion += 1;
    });
  }

  async incrementFailedLogins(id) {
    return this.#patch(id, (doc) => {
      doc.failedLoginAttempts += 1;
    });
  }

  async lockAccount(id, lockUntil) {
    this.#patch(id, (doc) => Object.assign(doc, { lockUntil, failedLoginAttempts: 0 }));
  }

  async recordSuccessfulLogin(id, now) {
    return this.#patch(id, (doc) => Object.assign(doc, { failedLoginAttempts: 0, lockUntil: null, lastLoginAt: now }));
  }

  async countActiveByRole(role) {
    return [...this.#docs.values()].filter((doc) => doc.role === role && doc.isActive).length;
  }

  async list({ page, limit, role, isActive, search }) {
    let items = [...this.#docs.values()];
    if (role) items = items.filter((doc) => doc.role === role);
    if (isActive !== undefined) items = items.filter((doc) => doc.isActive === isActive);
    if (search) {
      const term = search.toLowerCase();
      items = items.filter((doc) => [doc.email, doc.firstName, doc.lastName].some((v) => v.toLowerCase().startsWith(term)));
    }
    const total = items.length;
    const start = (page - 1) * limit;
    return {
      items: items.slice(start, start + limit).map(({ passwordHash: _omit, ...rest }) => rest),
      total,
    };
  }

  async deleteById(id) {
    return this.#docs.delete(id.toString());
  }

  /** Ayuda de prueba: acceso directo al documento interno. */
  peek(id) {
    return this.#docs.get(id.toString());
  }
}

export class InMemoryAuditLogRepository {
  /** @type {object[]} Entradas registradas, en orden. */
  entries = [];

  /** Si es true, create() falla (para probar que la auditoria no rompe el flujo). */
  failOnCreate = false;

  async create(entry) {
    if (this.failOnCreate) throw new Error('fallo simulado de auditoria');
    const doc = { ...entry, _id: new ObjectId() };
    this.entries.push(doc);
    return doc;
  }

  async list({ page, limit, action }) {
    const items = this.entries.filter((entry) => !action || entry.action === action);
    return { items: items.slice((page - 1) * limit, page * limit), total: items.length };
  }

  /** Acciones registradas, para asserts concisos. */
  actions() {
    return this.entries.map((entry) => entry.action);
  }
}
