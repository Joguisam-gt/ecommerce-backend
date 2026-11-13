/**
 * Ejecutor de transacciones ACID de MongoDB.
 *
 * Encapsula el ciclo de vida de la sesion (startSession / withTransaction /
 * endSession) para que los servicios solo describan el trabajo transaccional
 * y no dependan del driver. En pruebas se sustituye por un doble en memoria.
 *
 * IMPORTANTE: session.withTransaction() reintenta automaticamente el callback
 * completo ante errores con la etiqueta TransientTransactionError (conflictos
 * de escritura, elecciones de primario) y reintenta el commit ante
 * UnknownTransactionCommitResult. Por eso el callback:
 * - debe ser idempotente: todo lo que escribe va dentro de la sesion y se
 *   descarta al abortar, y no debe mutar estado externo compartido;
 * - NO debe hacer llamadas externas (pasarela de pago, correo, HTTP): un
 *   reintento las repetiria. Esas operaciones van antes o despues.
 * Requiere un replica set o cluster sharded (las transacciones no existen en
 * un mongod standalone).
 */

/** Opciones de la transaccion: lectura consistente y escritura confirmada por mayoria. */
const TRANSACTION_OPTIONS = Object.freeze({
  readPreference: 'primary',
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
});

export class MongoTransactionRunner {
  /** @type {import('mongodb').MongoClient} */
  #client;

  /** @param {import('mongodb').MongoClient} client Cliente compartido (Database.getClient()). */
  constructor(client) {
    this.#client = client;
  }

  /**
   * Ejecuta el trabajo dentro de una transaccion y devuelve su resultado.
   * Si el callback lanza, la transaccion se aborta (rollback completo) y el
   * error se propaga sin cambios.
   * @template T
   * @param {(session: import('mongodb').ClientSession) => Promise<T>} work Callback idempotente y sin E/S externa.
   * @returns {Promise<T>}
   */
  async run(work) {
    const session = this.#client.startSession();
    try {
      // Driver mongodb v7: withTransaction devuelve el valor que resuelve el callback.
      return await session.withTransaction((activeSession) => work(activeSession), TRANSACTION_OPTIONS);
    } finally {
      await session.endSession();
    }
  }
}
