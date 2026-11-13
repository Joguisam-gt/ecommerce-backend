/**
 * Repositorio de movimientos de stock del panel de administracion (Fase 3).
 *
 * Concentra las escrituras atomicas ($inc) sobre products.stock que comparten
 * varios modulos: devolucion de stock al rechazar una transferencia, ingreso
 * de mercaderia por compra a proveedor y baja por mermas. Todos los metodos
 * aceptan la sesion de la transaccion y reciben ObjectId ya convertidos.
 * A diferencia de ProductRepository.decrementStock (checkout), no exige que el
 * producto este activo: el inventario se gestiona tambien en productos ocultos.
 */
import { COLLECTIONS } from '../database/collections.js';

/**
 * Opciones del driver con la sesion opcional.
 * @param {import('mongodb').ClientSession | undefined} session
 */
const withSession = (session) => (session ? { session } : {});

export class InventoryStockRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.PRODUCTS);
  }

  /**
   * Suma unidades al stock (devoluciones y reposiciones).
   * @param {import('mongodb').ObjectId} productId
   * @param {number} quantity Entero positivo.
   * @param {{ session?: import('mongodb').ClientSession, now?: Date }} [options]
   * @returns {Promise<boolean>} true si el producto existe y se actualizo.
   */
  async incrementStock(productId, quantity, { session, now = new Date() } = {}) {
    const result = await this.#collection.updateOne(
      { _id: productId },
      { $inc: { stock: quantity }, $set: { updatedAt: now } },
      withSession(session),
    );
    return result.matchedCount === 1;
  }

  /**
   * Ingreso de mercaderia: suma stock y fija el nuevo costo unitario en una sola escritura atomica.
   * @param {import('mongodb').ObjectId} productId
   * @param {number} quantity Entero positivo.
   * @param {number} costCents Nuevo costo unitario en centavos.
   * @param {{ session?: import('mongodb').ClientSession, now?: Date }} [options]
   * @returns {Promise<boolean>}
   */
  async receiveStock(productId, quantity, costCents, { session, now = new Date() } = {}) {
    const result = await this.#collection.updateOne(
      { _id: productId },
      { $inc: { stock: quantity }, $set: { costCents, updatedAt: now } },
      withSession(session),
    );
    return result.matchedCount === 1;
  }

  /**
   * Baja de stock condicionada: solo descuenta si hay unidades suficientes (nunca deja stock negativo).
   * @param {import('mongodb').ObjectId} productId
   * @param {number} quantity Entero positivo.
   * @param {{ session?: import('mongodb').ClientSession, now?: Date }} [options]
   * @returns {Promise<boolean>} true si se descontaron las unidades.
   */
  async decrementStock(productId, quantity, { session, now = new Date() } = {}) {
    const result = await this.#collection.updateOne(
      { _id: productId, stock: { $gte: quantity } },
      { $inc: { stock: -quantity }, $set: { updatedAt: now } },
      withSession(session),
    );
    return result.modifiedCount === 1;
  }
}
