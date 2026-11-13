/**
 * Repositorio de la configuracion global (coleccion system_settings, Fase 4).
 *
 * Unica capa que conoce la coleccion. Trabaja siempre sobre el documento
 * 'global_config': lectura, upsert parcial y creacion idempotente de los
 * valores por defecto (script db:init).
 */
import { COLLECTIONS } from '../database/collections.js';
import { SYSTEM_SETTINGS_ID } from '../constants/settings.js';

/**
 * Opciones del driver con la sesion opcional.
 * @param {import('mongodb').ClientSession | undefined} session
 */
const withSession = (session) => (session ? { session } : {});

/**
 * Construye el update del upsert (funcion pura): $set con los cambios y
 * $setOnInsert con los valores por defecto que NO aparecen en $set (MongoDB
 * rechaza que un mismo campo este en ambos operadores). Si no queda ningun
 * valor por defecto, se omite $setOnInsert.
 * @param {object} changes Campos a fijar (incluye updatedAt y updatedBy).
 * @param {object} defaults Valores por defecto del documento.
 * @returns {{ $set: object, $setOnInsert?: object }}
 */
export function buildSettingsUpsert(changes, defaults) {
  const $set = { ...changes };
  const insertOnly = Object.fromEntries(Object.entries(defaults).filter(([key]) => !Object.hasOwn($set, key)));
  return Object.keys(insertOnly).length > 0 ? { $set, $setOnInsert: insertOnly } : { $set };
}

export class SystemSettingsRepository {
  /** @type {import('mongodb').Collection} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.SYSTEM_SETTINGS);
  }

  /**
   * Documento de configuracion global o null si aun no existe.
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<object | null>}
   */
  findGlobal({ session } = {}) {
    return this.#collection.findOne({ _id: SYSTEM_SETTINGS_ID }, withSession(session));
  }

  /**
   * Actualizacion parcial con upsert: crea el documento con los valores por
   * defecto si no existe y devuelve el resultado final.
   * @param {object} changes Campos a fijar (incluye updatedAt y updatedBy).
   * @param {object} defaults Valores por defecto para el insert.
   * @param {{ session?: import('mongodb').ClientSession }} [options]
   * @returns {Promise<object>}
   */
  upsertGlobal(changes, defaults, { session } = {}) {
    return this.#collection.findOneAndUpdate({ _id: SYSTEM_SETTINGS_ID }, buildSettingsUpsert(changes, defaults), {
      upsert: true,
      returnDocument: 'after',
      includeResultMetadata: false,
      ...withSession(session),
    });
  }

  /**
   * Crea el documento por defecto solo si no existe (idempotente).
   * @param {object} document Documento completo sin _id (defaults + updatedAt + updatedBy).
   * @returns {Promise<boolean>} true si se creo en esta llamada.
   */
  async ensureGlobal(document) {
    const { upsertedCount } = await this.#collection.updateOne(
      { _id: SYSTEM_SETTINGS_ID },
      { $setOnInsert: document },
      { upsert: true },
    );
    return upsertedCount === 1;
  }
}
