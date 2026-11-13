/**
 * Servicio de purga (borrado fisico) del superusuario (Fase 4).
 *
 * Todo el flujo ocurre en UNA transaccion, con la sesion en cada operacion:
 *   1. Lectura del documento: 404 RECORD_NOT_FOUND si no existe.
 *   2. Usuarios: el actor no puede purgarse a si mismo (409 SELF_PURGE).
 *   3. Solo se purga lo ya desactivado (isActive === false): si no, 400 NOT_SOFT_DELETED.
 *   4. Bloqueo fiscal: si algun documento fiscal o contable lo referencia,
 *      409 FISCAL_INTEGRITY_LOCK con el detalle de conteos.
 *        - users: pedidos y facturas de venta por userId.
 *        - products: pedidos, facturas (venta y compra) y compras por items.productId.
 *        - suppliers: compras y facturas de proveedor por supplierId, y pedidos y
 *          facturas con items.productId de sus productos. Si el proveedor aun
 *          tiene productos asociados (products.supplierId), 409 SUPPLIER_HAS_PRODUCTS
 *          para no dejar referencias huerfanas.
 *        - coupons: sin bloqueo por contrato (cada pedido conserva una copia del
 *          cupon aplicado: couponId, codigo, tipo, valor y descuento).
 *   5. Cascada de referencias no fiscales: carrito del usuario; entradas del
 *      producto en los catalogos de proveedores.
 *   6. Borrado y auditoria record.purged con la instantanea redactada del
 *      documento (sin passwordHash ni otros secretos), en la misma transaccion:
 *      si la auditoria falla, no hay borrado.
 */
import { ALL_PURGEABLE_COLLECTIONS, PURGEABLE_COLLECTIONS } from '../constants/superuser.js';
import { HttpError } from '../utils/http-error.js';
import { toObjectId } from '../utils/object-id.js';
import { AUDIT_ACTIONS, toAuditState } from './audit.service.js';

/** Conteos que NO son documentos fiscales (no disparan FISCAL_INTEGRITY_LOCK). */
const NON_FISCAL_COUNTS = Object.freeze(['products']);

export class PurgeService {
  #purge;
  #fiscal;
  #transactions;
  #audit;
  #now;

  /**
   * Conteo de referencias por coleccion (estrategia por clave de la lista blanca).
   * @type {Readonly<Record<string, (id: import('mongodb').ObjectId, session: object) => Promise<Record<string, number>>>>}
   */
  #referenceCounters;

  /**
   * Cascada de referencias no fiscales por coleccion.
   * @type {Readonly<Record<string, (id: import('mongodb').ObjectId, session: object) => Promise<Record<string, number>>>>}
   */
  #cascades;

  /**
   * @param {{ purgeRepository: import('../repositories/purge.repository.js').PurgeRepository,
   *           fiscalReferenceRepository: import('../repositories/fiscal-reference.repository.js').FiscalReferenceRepository,
   *           transactionRunner: { run: (work: (session: object) => Promise<any>) => Promise<any> },
   *           auditService: import('./audit.service.js').AuditService, clock?: () => Date }} deps
   */
  constructor({ purgeRepository, fiscalReferenceRepository, transactionRunner, auditService, clock = () => new Date() }) {
    this.#purge = purgeRepository;
    this.#fiscal = fiscalReferenceRepository;
    this.#transactions = transactionRunner;
    this.#audit = auditService;
    this.#now = clock;

    this.#referenceCounters = Object.freeze({
      [PURGEABLE_COLLECTIONS.USERS]: (id, session) => this.#fiscal.countUserReferences(id, { session }),
      [PURGEABLE_COLLECTIONS.PRODUCTS]: (id, session) => this.#fiscal.countProductReferences(id, { session }),
      [PURGEABLE_COLLECTIONS.SUPPLIERS]: async (id, session) => {
        const productIds = await this.#fiscal.findProductIdsBySupplier(id, { session });
        const references = await this.#fiscal.countSupplierReferences(id, productIds, { session });
        return { ...references, products: productIds.length };
      },
    });

    this.#cascades = Object.freeze({
      [PURGEABLE_COLLECTIONS.USERS]: async (id, session) => ({
        cartsDeleted: await this.#purge.deleteCartByUserId(id, { session }),
      }),
      [PURGEABLE_COLLECTIONS.PRODUCTS]: async (id, session) => ({
        supplierCatalogsUpdated: await this.#purge.removeProductFromSupplierCatalogs(id, this.#now(), { session }),
      }),
    });
  }

  /**
   * Purga un registro desactivado de una coleccion de la lista blanca.
   * @param {{ id: string, role: string }} actor
   * @param {string} collection Clave de PURGEABLE_COLLECTIONS.
   * @param {string} id
   * @param {object} [context] requestContext(req)
   * @returns {Promise<{ collection: string, id: string, purged: true, auditLogId: string }>}
   */
  async purge(actor, collection, id, context = {}) {
    if (!ALL_PURGEABLE_COLLECTIONS.includes(collection)) {
      throw HttpError.badRequest('Coleccion no permitida para purga', 'COLLECTION_NOT_PURGEABLE');
    }
    const recordId = toObjectId(id);

    return this.#transactions.run(async (session) => {
      const record = await this.#purge.findById(collection, recordId, { session });
      if (!record) throw HttpError.notFound('Registro no encontrado', 'RECORD_NOT_FOUND');

      if (collection === PURGEABLE_COLLECTIONS.USERS && actor?.id === record._id.toString()) {
        throw HttpError.conflict('No puedes purgar tu propia cuenta', 'SELF_PURGE');
      }
      if (record.isActive !== false) {
        throw HttpError.badRequest('Solo se pueden purgar registros desactivados (borrado logico previo)', 'NOT_SOFT_DELETED');
      }

      await this.#assertNoReferences(collection, record._id, session);
      const cascade = (await this.#cascades[collection]?.(record._id, session)) ?? {};

      const deleted = await this.#purge.deleteById(collection, record._id, { session });
      if (!deleted) throw HttpError.conflict('El registro cambio durante la purga; vuelve a intentarlo', 'PURGE_CONFLICT');

      const entry = await this.#audit.recordInTransaction(
        {
          action: AUDIT_ACTIONS.RECORD_PURGED,
          entity: collection,
          entityId: record._id,
          targetCollection: collection,
          actor,
          snapshot: toAuditState(record),
          metadata: { cascade },
          context,
        },
        session,
      );
      return { collection, id: record._id.toString(), purged: true, auditLogId: entry._id.toString() };
    });
  }

  /**
   * Bloqueo fiscal y de referencias huerfanas (ver cabecera).
   * @param {string} collection
   * @param {import('mongodb').ObjectId} id
   * @param {object} session
   */
  async #assertNoReferences(collection, id, session) {
    const counter = this.#referenceCounters[collection];
    if (!counter) return;
    const references = await counter(id, session);

    const fiscalTotal = Object.entries(references)
      .filter(([key]) => !NON_FISCAL_COUNTS.includes(key))
      .reduce((sum, [, count]) => sum + count, 0);
    if (fiscalTotal > 0) {
      throw new HttpError(
        409,
        'El registro esta referenciado por documentos fiscales y no puede purgarse',
        'FISCAL_INTEGRITY_LOCK',
        { collection, references },
      );
    }
    if ((references.products ?? 0) > 0) {
      throw new HttpError(
        409,
        'El proveedor aun tiene productos asociados; reasignalos o purgalos antes',
        'SUPPLIER_HAS_PRODUCTS',
        { collection, references },
      );
    }
  }
}
