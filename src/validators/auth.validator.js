/**
 * Esquemas de validacion de los endpoints de autenticacion.
 *
 * El registro no acepta "role": todo alta publica es un cliente. El login no
 * aplica la politica de contrasenas (solo limites de tamano) para no revelar
 * reglas ni rechazar contrasenas antiguas validas.
 */
import { emailRule, nameRule, passwordRule, phoneRule } from './common.rules.js';

export const registerSchema = Object.freeze({
  fields: {
    email: emailRule(true),
    password: passwordRule(true),
    firstName: nameRule(true),
    lastName: nameRule(true),
    phone: phoneRule(),
  },
});

export const loginSchema = Object.freeze({
  fields: {
    email: { type: 'string', required: true, maxLength: 254 },
    password: { type: 'string', required: true, trim: false, maxLength: 200 },
  },
});

export const changePasswordSchema = Object.freeze({
  fields: {
    currentPassword: { type: 'string', required: true, trim: false, maxLength: 200 },
    newPassword: passwordRule(true),
  },
  refine: (input) =>
    input.currentPassword === input.newPassword
      ? [{ field: 'newPassword', message: 'La nueva contrasena debe ser distinta de la actual' }]
      : [],
});
