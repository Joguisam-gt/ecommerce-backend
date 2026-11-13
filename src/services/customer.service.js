/**
 * Servicio del directorio de clientes (Fase 3).
 *
 * Reglas:
 * - Solo gestiona cuentas con rol 'user': una cuenta admin o superusuario
 *   responde 403 NOT_A_CUSTOMER en mutaciones y 404 en el detalle (no forma
 *   parte del directorio).
 * - userCode es unico: 409 USER_CODE_IN_USE (comprobacion previa y, ante una
 *   carrera, el error E11000 del indice unico parcial).
 * - Desactivar es un borrado logico que revoca las sesiones (tokenVersion + 1).
 * - El borrado fisico exige records:hard_delete (solo superusuario); la ruta lo
 *   comprueba y este servicio lo vuelve a comprobar (defensa en profundidad).
 * - Cada mutacion se audita con recordChange DESPUES de escribir, con el
 *   estado previo y el nuevo.
 */
import { PERMISSIONS, hasPermission } from '../constants/permissions.js';
import { ROLES } from '../constants/roles.js';
import { COLLECTIONS } from '../database/collections.js';
import { HttpError } from '../utils/http-error.js';
import { isValidObjectId, toObjectId } from '../utils/object-id.js';
import { AUDIT_ACTIONS } from './audit.service.js';

/** Codigo de MongoDB para violacion de indice unico. */
const MONGO_DUPLICATE_KEY = 11000;

/** Error unico de cliente inexistente. */
const notFound = () => HttpError.notFound('Cliente no encontrado', 'CUSTOMER_NOT_FOUND');

/** Error de codigo de cliente duplicado. */
const userCodeInUse = () => HttpError.conflict('El codigo de cliente ya esta en uso', 'USER_CODE_IN_USE');

export class CustomerService {
  #customers;
  #audit;
  #now;

  /**
   * @param {{ customerRepository: import('../repositories/customer.repository.js').CustomerRepository,
   *           auditService: { recordChange: Function }, clock?: () => Date }} deps
   */
  constructor({ customerRepository, auditService, clock = () => new Date() }) {
    this.#customers = customerRepository;
    this.#audit = auditService;
    this.#now = clock;
  }

  /**
   * Listado paginado del directorio con metricas.
   * @param {object} query ListCustomersQueryDTO
   * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
   */
  async listCustomers(query) {
    const { page, limit, ...filters } = query;
    const { items, total } = await this.#customers.listDirectory(filters, { page, limit });
    return { items, total, page, limit };
  }

  /**
   * Detalle con metricas; 404 si no existe o no es un cliente.
   * @param {string} id
   */
  async getCustomer(id) {
    if (!isValidObjectId(id)) throw notFound();
    const row = await this.#customers.findDetailById(toObjectId(id));
    if (!row) throw notFound();
    return row;
  }

  /**
   * Actualiza firstName, lastName, phone y userCode de un cliente.
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {object} changes UpdateCustomerDTO
   * @param {object} [context] requestContext(req)
   */
  async updateCustomer(actor, id, changes, context = {}) {
    const target = await this.#findManagedOrFail(id);

    // Unicidad del codigo de cliente (solo si cambia a un valor no nulo).
    if (changes.userCode && changes.userCode !== target.userCode) {
      const owner = await this.#customers.findByUserCode(changes.userCode);
      if (owner && !owner._id.equals(target._id)) throw userCodeInUse();
    }

    let updated;
    try {
      updated = await this.#customers.updateById(target._id, changes, this.#now());
    } catch (error) {
      if (error?.code === MONGO_DUPLICATE_KEY) throw userCodeInUse();
      throw error;
    }
    if (!updated) throw notFound();

    await this.#recordChange(actor, AUDIT_ACTIONS.CUSTOMER_UPDATED, target, updated, context, { fields: Object.keys(changes) });
    return updated;
  }

  /**
   * Borrado logico (admin y superusuario). Idempotente: si ya esta inactivo
   * no escribe ni audita.
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {object} [context]
   */
  async deactivateCustomer(actor, id, context = {}) {
    const target = await this.#findManagedOrFail(id);
    if (!target.isActive) return target;

    const updated = await this.#customers.deactivate(target._id, this.#now());
    if (!updated) throw notFound();

    await this.#recordChange(actor, AUDIT_ACTIONS.CUSTOMER_DEACTIVATED, target, updated, context, { sessionsRevoked: true });
    return updated;
  }

  /**
   * Borrado fisico (solo superusuario). Los pedidos y facturas conservan su
   * snapshot del cliente; la auditoria guarda el estado previo completo.
   * @param {{ id: string, role: string }} actor
   * @param {string} id
   * @param {object} [context]
   */
  async deleteCustomer(actor, id, context = {}) {
    if (!hasPermission(actor.role, PERMISSIONS.CUSTOMERS_MANAGE) || !hasPermission(actor.role, PERMISSIONS.RECORDS_HARD_DELETE)) {
      throw HttpError.forbidden('El borrado fisico esta reservado al superusuario', 'HARD_DELETE_FORBIDDEN');
    }
    const target = await this.#findManagedOrFail(id);

    const deleted = await this.#customers.deleteById(target._id);
    if (!deleted) throw notFound();

    await this.#recordChange(actor, AUDIT_ACTIONS.CUSTOMER_DELETED, target, null, context, {});
  }

  /**
   * Busca la cuenta y exige que sea un cliente (rol user).
   * @param {string} id
   */
  async #findManagedOrFail(id) {
    if (!isValidObjectId(id)) throw notFound();
    const user = await this.#customers.findById(toObjectId(id));
    if (!user) throw notFound();
    if (user.role !== ROLES.USER) {
      throw HttpError.forbidden('Este modulo solo gestiona cuentas de clientes', 'NOT_A_CUSTOMER');
    }
    return user;
  }

  /**
   * Registra la mutacion en auditoria con el contrato de cambio completo.
   * @param {{ id: string, role: string }} actor
   * @param {string} action
   * @param {object} previousState
   * @param {object | null} newState
   * @param {object} context
   * @param {object} metadata
   */
  async #recordChange(actor, action, previousState, newState, context, metadata) {
    await this.#audit.recordChange({
      actor,
      action,
      targetCollection: COLLECTIONS.USERS,
      targetId: previousState._id.toString(),
      previousState,
      newState,
      metadata,
      context,
    });
  }
}
