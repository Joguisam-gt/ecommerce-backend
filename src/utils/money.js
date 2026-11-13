/**
 * Utilidades monetarias.
 *
 * Internamente todos los importes son enteros en centavos. La API publica
 * expone importes decimales (por ejemplo 49.99) y los convierte solo en el
 * borde (DTOs). Las funciones de redondeo usan "half up" sobre enteros para
 * no acumular errores de coma flotante.
 */

/**
 * Convierte un importe decimal (maximo 2 decimales) a centavos.
 * @param {number} amount
 * @returns {number}
 */
export function toCents(amount) {
  return Math.round(amount * 100);
}

/**
 * Convierte centavos a importe decimal con 2 decimales.
 * @param {number} cents
 * @returns {number}
 */
export function fromCents(cents) {
  return Math.round(cents) / 100;
}

/**
 * Aplica un porcentaje (puede tener hasta 2 decimales, p. ej. 12.5) a un importe en centavos.
 * Trabaja en puntos basicos (1% = 100 pb) para operar solo con enteros.
 * @param {number} cents
 * @param {number} percent
 * @returns {number} Centavos redondeados half up.
 */
export function percentOf(cents, percent) {
  const basisPoints = Math.round(percent * 100);
  return Math.round((cents * basisPoints) / 10000);
}

/**
 * Reparte un total entero entre varios pesos de forma proporcional, sin perder
 * centavos (metodo del mayor resto). La suma del resultado es exactamente total.
 * @param {number} total Centavos a repartir.
 * @param {number[]} weights Pesos no negativos.
 * @returns {number[]}
 */
export function allocateProportionally(total, weights) {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);

  const raw = weights.map((weight) => (total * weight) / sum);
  const shares = raw.map(Math.floor);
  let remainder = total - shares.reduce((acc, share) => acc + share, 0);

  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const { index } of order) {
    if (remainder <= 0) break;
    shares[index] += 1;
    remainder -= 1;
  }
  return shares;
}
