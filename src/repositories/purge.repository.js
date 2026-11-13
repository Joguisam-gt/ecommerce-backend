/**
 * Repositorio de purga (borrado fisico) del superusuario (Fase 4).
 *
 * Traduce la lista blanca PURGEABLE_COLLECTIONS a colecciones reales resueltas
 * en el constructor: el nombre recibido solo se usa como clave de un mapa
 * congelado y nunca como nombre de coleccion, de modo que un valor fuera de la
 * lista lanza un error en lugar de tocar otra coleccion. Incluye ademas las
 * limpiezas en cascada de referencias no fiscales (carrito del usuario y
 * catalogos de proveedores). Todas las operaciones aceptan { session }.
 */
import { COLLECTIONS } from '../database/collections.js';
import { ALL_PURGEABLE_COLLECTIONS } from '../constants/superuser.js';

/**
 * Opciones del driver con la sesion opcional.
 * @param {import('mongodb').ClientSession | undefined} session
 */
const withSession = (session) => (session ? { session } : {});

export class PurgeRepository {
  /** @type {Readonly<Record<string, import('mongodb').Collection>>} */
  #targets;

  /** @type {import('mongodb').Collection} */
  #carts;

  /** @type {import('mongodb').Collection} */
  #suppliers;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#targets = Object.freeze(Object.fromEntries(ALL_PURGEABLE_COLLECTIONS.map((name) => [name, db.collection(name)])));
    this.#carts = db.collection(COLLECTIONS.CARTS);
    this.#suppliers = db.collection(COLLECTIONS.SUPPLIERS);
  }

  /**
   * Coleccion de la lista blanca o error (defensa en profundidad tras el validador).
   * @param {string} name
   * @returns {import('mongodb').Collection}
   */
  #target(name) {
    if (!Object.hasOwn(this.#targets, name)) throw new Error(`Coleccion no purgable: ${String(name)}`);
    return this.#targets[name];
  }

  /**
   * Documento a purgar (completo, para la instantanea de auditoria).
   * @param {string} collection Clave de la lista blanca.
   * @param {import('mongodb').ObjectId} id
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<object | null>}
   */
  findById(collection, id, { session } = {}) {
    return this.#target(collection).findOne({ _id: id }, withSession(session));
  }

  /**
   * Borrado fisico condicionado a que el documento siga desactivado
   * (isActive: false), por si cambio entre la lectura y el borrado.
   * @param {string} collection Clave de la lista blanca.
   * @param {import('mongodb').ObjectId} id
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<boolean>} true si se elimino.
   */
  async deleteById(collection, id, { session } = {}) {
    const { deletedCount } = await this.#target(collection).deleteOne({ _id: id, isActive: false }, withSession(session));
    return deletedCount === 1;
  }

  /**
   * Cascada de usuarios: elimina su carrito (dato efimero, sin valor fiscal).
   * @param {import('mongodb').ObjectId} userId
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<number>} Carritos eliminados (0 o 1).
   */
  async deleteCartByUserId(userId, { session } = {}) {
    const { deletedCount } = await this.#carts.deleteOne({ userId }, withSession(session));
    return deletedCount;
  }

  /**
   * Cascada de productos: retira el producto del catalogo de los proveedores
   * que lo surten (indice ix_suppliers_catalog_product).
   * @param {import('mongodb').ObjectId} productId
   * @param {Date} now
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<number>} Proveedores modificados.
   */
  async removeProductFromSupplierCatalogs(productId, now, { session } = {}) {
    const { modifiedCount } = await this.#suppliers.updateMany(
      { 'catalog.productId': productId },
      { $pull: { catalog: { productId } }, $set: { updatedAt: now } },
      withSession(session),
    );
    return modifiedCount;
  }
}
