/**
 * DTOs de entrada de autenticacion.
 *
 * Cada DTO toma solo los campos permitidos del cuerpo ya validado, los
 * normaliza y se congela. Asi el servicio nunca recibe propiedades extra.
 */
import { normalizeEmail, normalizePhone, normalizeText } from './normalizers.js';

export class RegisterUserDTO {
  /** @param {{ email: string, password: string, firstName: string, lastName: string, phone?: string | null }} body */
  constructor(body) {
    this.email = normalizeEmail(body.email);
    this.password = body.password;
    this.firstName = normalizeText(body.firstName);
    this.lastName = normalizeText(body.lastName);
    this.phone = normalizePhone(body.phone) ?? null;
    Object.freeze(this);
  }

  /** @param {object} body */
  static from(body) {
    return new RegisterUserDTO(body);
  }
}

export class LoginDTO {
  /** @param {{ email: string, password: string }} body */
  constructor(body) {
    this.email = normalizeEmail(body.email);
    this.password = body.password;
    Object.freeze(this);
  }

  /** @param {object} body */
  static from(body) {
    return new LoginDTO(body);
  }
}

export class ChangePasswordDTO {
  /** @param {{ currentPassword: string, newPassword: string }} body */
  constructor(body) {
    this.currentPassword = body.currentPassword;
    this.newPassword = body.newPassword;
    Object.freeze(this);
  }

  /** @param {object} body */
  static from(body) {
    return new ChangePasswordDTO(body);
  }
}
