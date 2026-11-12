/**
 * Servicio de contrasenas basado en bcrypt.
 *
 * Encapsula el algoritmo de hash (principio de inversion de dependencias: los
 * servicios dependen de esta abstraccion, no de bcrypt). Incluye una
 * comparacion contra un hash ficticio para igualar el tiempo de respuesta
 * cuando el correo no existe y dificultar la enumeracion de cuentas.
 */
import bcrypt from 'bcrypt';

export class PasswordService {
  #saltRounds;

  /** @type {Promise<string> | null} Hash ficticio calculado una sola vez. */
  #dummyHash = null;

  /** @param {{ saltRounds?: number }} [options] */
  constructor({ saltRounds = 12 } = {}) {
    this.#saltRounds = saltRounds;
  }

  /**
   * @param {string} plain
   * @returns {Promise<string>} Hash bcrypt de 60 caracteres.
   */
  hash(plain) {
    return bcrypt.hash(plain, this.#saltRounds);
  }

  /**
   * Comparacion en tiempo constante proporcionada por bcrypt.
   * @param {string} plain
   * @param {string} hash
   * @returns {Promise<boolean>}
   */
  compare(plain, hash) {
    return bcrypt.compare(plain, hash);
  }

  /**
   * Realiza una comparacion con coste real que siempre falla.
   * @param {string} plain
   * @returns {Promise<false>}
   */
  async compareWithDummy(plain) {
    this.#dummyHash ??= bcrypt.hash('timing-equalizer-not-a-real-password', this.#saltRounds);
    await bcrypt.compare(plain, await this.#dummyHash);
    return false;
  }
}
