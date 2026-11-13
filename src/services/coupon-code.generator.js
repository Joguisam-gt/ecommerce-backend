/**
 * Generador de codigos de cupon aleatorios y seguros (Fase 3).
 *
 * Usa node:crypto.randomInt (CSPRNG, sin sesgo de modulo) para elegir cada
 * caracter de un alfabeto en mayusculas sin caracteres ambiguos (0/O, 1/I/L).
 * Con 31 simbolos y 10 posiciones hay 31^10 (~8.2e14) combinaciones, por lo
 * que una colision es improbable; aun asi la unicidad real la garantiza el
 * indice unico uq_coupons_code y AdminCouponService reintenta ante colision.
 * Se inyecta en el servicio para poder sustituirlo en pruebas.
 */
import { randomInt as cryptoRandomInt } from 'node:crypto';

/** Alfabeto sin caracteres ambiguos: excluye 0, O, 1, I y L. */
export const COUPON_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Longitud por defecto de un codigo generado. */
export const COUPON_CODE_LENGTH = 10;

export class CouponCodeGenerator {
  #alphabet;
  #length;
  #randomInt;

  /**
   * @param {{ length?: number, alphabet?: string, randomInt?: (min: number, max: number) => number }} [options]
   *   randomInt(min, max) debe devolver un entero en [min, max); por defecto crypto.randomInt.
   */
  constructor({ length = COUPON_CODE_LENGTH, alphabet = COUPON_CODE_ALPHABET, randomInt = cryptoRandomInt } = {}) {
    if (!Number.isInteger(length) || length < 3 || length > 30) {
      throw new Error('La longitud del codigo de cupon debe estar entre 3 y 30');
    }
    if (!/^[A-Z0-9_-]{2,}$/.test(alphabet)) {
      throw new Error('El alfabeto del codigo de cupon debe cumplir ^[A-Z0-9_-]+$ y tener al menos 2 simbolos');
    }
    this.#alphabet = alphabet;
    this.#length = length;
    this.#randomInt = randomInt;
  }

  /**
   * Genera un codigo nuevo (no comprueba unicidad: eso lo hace el indice unico).
   * @returns {string}
   */
  generate() {
    let code = '';
    for (let index = 0; index < this.#length; index += 1) {
      code += this.#alphabet[this.#randomInt(0, this.#alphabet.length)];
    }
    return code;
  }
}
