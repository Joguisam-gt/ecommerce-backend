/**
 * Conexion a MongoDB con el patron Singleton.
 *
 * Garantiza que toda la aplicacion comparta un unico MongoClient (y por lo tanto
 * un unico pool de conexiones). El constructor esta protegido con un token
 * privado del modulo: la unica forma de obtener la instancia es
 * Database.getInstance() o el export `database`.
 */
import { MongoClient } from 'mongodb';

/** Token privado del modulo que impide instanciar la clase desde fuera. */
const CONSTRUCTOR_TOKEN = Symbol('Database.constructor');

export class Database {
  /** @type {Database | null} Instancia unica. */
  static #instance = null;

  /** @type {MongoClient | null} */
  #client = null;

  /** @type {import('mongodb').Db | null} */
  #db = null;

  /** @type {Promise<import('mongodb').Db> | null} Conexion en curso (evita conexiones duplicadas concurrentes). */
  #connecting = null;

  /**
   * @param {symbol} token Token interno; cualquier otro valor lanza un error.
   */
  constructor(token) {
    if (token !== CONSTRUCTOR_TOKEN) {
      throw new Error('Database es un Singleton: usa Database.getInstance()');
    }
  }

  /**
   * Devuelve la instancia unica, creandola en la primera llamada.
   * @returns {Database}
   */
  static getInstance() {
    if (!Database.#instance) {
      Database.#instance = new Database(CONSTRUCTOR_TOKEN);
    }
    return Database.#instance;
  }

  /**
   * Abre la conexion si no existe. Es idempotente y segura ante llamadas concurrentes:
   * si ya hay una conexion en curso, devuelve la misma promesa.
   * @param {{ uri: string, dbName: string, maxPoolSize?: number, serverSelectionTimeoutMS?: number }} options
   * @returns {Promise<import('mongodb').Db>}
   */
  async connect({ uri, dbName, maxPoolSize = 20, serverSelectionTimeoutMS = 5000 }) {
    if (this.#db) return this.#db;
    if (this.#connecting) return this.#connecting;

    this.#connecting = (async () => {
      const client = new MongoClient(uri, {
        maxPoolSize,
        serverSelectionTimeoutMS,
        appName: 'ecommerce-backend',
      });
      try {
        await client.connect();
        await client.db(dbName).command({ ping: 1 });
      } catch (error) {
        await client.close().catch(() => {});
        throw error;
      }
      this.#client = client;
      this.#db = client.db(dbName);
      return this.#db;
    })();

    try {
      return await this.#connecting;
    } finally {
      this.#connecting = null;
    }
  }

  /**
   * Devuelve la base de datos activa.
   * @returns {import('mongodb').Db}
   * @throws {Error} Si todavia no se ha llamado a connect().
   */
  getDb() {
    if (!this.#db) {
      throw new Error('La base de datos no esta conectada. Llama primero a connect().');
    }
    return this.#db;
  }

  /**
   * Devuelve el cliente subyacente (necesario para transacciones en fases posteriores).
   * @returns {MongoClient}
   */
  getClient() {
    if (!this.#client) {
      throw new Error('La base de datos no esta conectada. Llama primero a connect().');
    }
    return this.#client;
  }

  /** @returns {boolean} true si hay una conexion abierta. */
  isConnected() {
    return this.#db !== null;
  }

  /**
   * Comprueba que el servidor responde. Usado por el endpoint de salud.
   * @returns {Promise<boolean>}
   */
  async ping() {
    if (!this.#db) return false;
    try {
      await this.#db.command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cierra la conexion y libera el pool. Se usa en el apagado ordenado.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.#client) {
      await this.#client.close();
    }
    this.#client = null;
    this.#db = null;
  }
}

/** Instancia unica compartida por toda la aplicacion. */
export const database = Database.getInstance();
