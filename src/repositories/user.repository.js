/**
 * Repositorio de usuarios: unica capa que conoce la coleccion users y el driver.
 *
 * Expone operaciones con intencion de negocio (lockAccount, updateRole...) en
 * lugar de un update generico, para que los servicios no construyan consultas
 * de MongoDB y para que cada escritura sea atomica y acotada.
 * Todos los metodos reciben ObjectId ya convertidos por la capa de servicio.
 */
import { COLLECTIONS } from '../database/collections.js';

/** Proyeccion para listados: nunca se lee el hash de la contrasena. */
const LIST_PROJECTION = Object.freeze({ passwordHash: 0 });

/** Opciones de findOneAndUpdate: devolver el documento ya modificado. */
const RETURN_AFTER = Object.freeze({ returnDocument: 'after', includeResultMetadata: false });

/**
 * Escapa caracteres especiales para usar texto del usuario dentro de una RegExp.
 * Evita inyeccion de expresiones regulares y ReDoS.
 * @param {string} value
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class UserRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.USERS);
  }

  /**
   * @param {import('mongodb').ObjectId} id
   * @returns {Promise<object | null>}
   */
  findById(id) {
    return this.#collection.findOne({ _id: id });
  }

  /**
   * @param {string} email Correo ya normalizado.
   * @returns {Promise<object | null>}
   */
  findByEmail(email) {
    return this.#collection.findOne({ email });
  }

  /**
   * Inserta un usuario y devuelve el documento con su _id.
   * @param {object} document Documento completo (ver user-document.factory.js).
   */
  async create(document) {
    const { insertedId } = await this.#collection.insertOne(document);
    return { ...document, _id: insertedId };
  }

  /**
   * Actualiza campos basicos (nombre, telefono, correo).
   * @param {import('mongodb').ObjectId} id
   * @param {object} changes
   * @param {Date} now
   */
  updateById(id, changes, now) {
    return this.#collection.findOneAndUpdate({ _id: id }, { $set: { ...changes, updatedAt: now } }, RETURN_AFTER);
  }

  /**
   * Cambia la contrasena e invalida todas las sesiones (incrementa tokenVersion).
   * @param {import('mongodb').ObjectId} id
   * @param {string} passwordHash
   * @param {Date} now
   */
  updatePassword(id, passwordHash, now) {
    return this.#collection.findOneAndUpdate(
      { _id: id },
      { $set: { passwordHash, updatedAt: now }, $inc: { tokenVersion: 1 } },
      RETURN_AFTER,
    );
  }

  /**
   * Cambia el rol e invalida las sesiones para forzar tokens con el rol nuevo.
   * @param {import('mongodb').ObjectId} id
   * @param {string} role
   * @param {Date} now
   */
  updateRole(id, role, now) {
    return this.#collection.findOneAndUpdate(
      { _id: id },
      { $set: { role, updatedAt: now }, $inc: { tokenVersion: 1 } },
      RETURN_AFTER,
    );
  }

  /**
   * Activa o desactiva (borrado logico). Al desactivar se revocan las sesiones.
   * @param {import('mongodb').ObjectId} id
   * @param {boolean} isActive
   * @param {Date} now
   */
  updateStatus(id, isActive, now) {
    const update = { $set: { isActive, updatedAt: now } };
    if (!isActive) update.$inc = { tokenVersion: 1 };
    return this.#collection.findOneAndUpdate({ _id: id }, update, RETURN_AFTER);
  }

  /**
   * Revoca todas las sesiones del usuario (logout global).
   * @param {import('mongodb').ObjectId} id
   */
  incrementTokenVersion(id) {
    return this.#collection.findOneAndUpdate({ _id: id }, { $inc: { tokenVersion: 1 } }, RETURN_AFTER);
  }

  /**
   * Suma un intento fallido de forma atomica y devuelve el documento actualizado.
   * @param {import('mongodb').ObjectId} id
   */
  incrementFailedLogins(id) {
    return this.#collection.findOneAndUpdate({ _id: id }, { $inc: { failedLoginAttempts: 1 } }, RETURN_AFTER);
  }

  /**
   * Bloquea la cuenta hasta una fecha y reinicia el contador de intentos.
   * @param {import('mongodb').ObjectId} id
   * @param {Date} lockUntil
   */
  lockAccount(id, lockUntil) {
    return this.#collection.updateOne({ _id: id }, { $set: { lockUntil, failedLoginAttempts: 0 } });
  }

  /**
   * Registra un login correcto: limpia contador y bloqueo y guarda la fecha.
   * @param {import('mongodb').ObjectId} id
   * @param {Date} now
   */
  recordSuccessfulLogin(id, now) {
    return this.#collection.findOneAndUpdate(
      { _id: id },
      { $set: { failedLoginAttempts: 0, lockUntil: null, lastLoginAt: now } },
      RETURN_AFTER,
    );
  }

  /**
   * Cuenta usuarios activos de un rol (proteccion del ultimo superusuario).
   * @param {string} role
   */
  countActiveByRole(role) {
    return this.#collection.countDocuments({ role, isActive: true });
  }

  /**
   * Listado paginado con filtros. La busqueda de texto se escapa y se ancla al
   * inicio para aprovechar indices y evitar expresiones costosas.
   * @param {{ page: number, limit: number, role?: string, isActive?: boolean, search?: string }} criteria
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async list({ page, limit, role, isActive, search }) {
    const filter = {};
    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive;
    if (search) {
      const pattern = new RegExp(`^${escapeRegex(search)}`, 'i');
      filter.$or = [{ email: pattern }, { firstName: pattern }, { lastName: pattern }];
    }

    const [items, total] = await Promise.all([
      this.#collection
        .find(filter, { projection: LIST_PROJECTION })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      this.#collection.countDocuments(filter),
    ]);
    return { items, total };
  }

  /**
   * Borrado fisico. Solo lo invoca UserService tras comprobar el permiso users:delete.
   * @param {import('mongodb').ObjectId} id
   * @returns {Promise<boolean>} true si se elimino un documento.
   */
  async deleteById(id) {
    const { deletedCount } = await this.#collection.deleteOne({ _id: id });
    return deletedCount === 1;
  }
}
