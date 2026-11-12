/**
 * Fabrica del documento de usuario.
 *
 * Unico lugar donde se define la forma inicial de un usuario. Lo usan tanto el
 * registro publico como el alta administrativa y el script de semilla, asi los
 * campos coinciden siempre con el $jsonSchema de users.
 */

/**
 * @param {{ email: string, passwordHash: string, firstName: string, lastName: string,
 *           phone?: string | null, role: string }} data
 * @param {Date} now
 * @returns {object}
 */
export function buildUserDocument({ email, passwordHash, firstName, lastName, phone = null, role }, now) {
  return {
    email,
    passwordHash,
    firstName,
    lastName,
    phone,
    role,
    isActive: true,
    tokenVersion: 0,
    failedLoginAttempts: 0,
    lockUntil: null,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
