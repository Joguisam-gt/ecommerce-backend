/**
 * DTOs de la configuracion global (Fase 4): entrada del PATCH y formas de
 * salida privada (superusuario) y publica (tienda).
 *
 * Las salidas se construyen campo a campo (lista blanca): la configuracion
 * publica nunca expone maintenanceMode, updatedBy ni el campo isActive de las cuentas.
 */
import { compact, normalizeText } from './normalizers.js';

/**
 * Cuenta bancaria normalizada para guardar (isActive por defecto true).
 * @param {{ bankName: string, accountNumber: string, accountHolder: string, accountType: string, isActive?: boolean }} account
 */
const toStoredAccount = (account) => ({
  bankName: account.bankName,
  accountNumber: account.accountNumber.trim(),
  accountHolder: normalizeText(account.accountHolder),
  accountType: account.accountType,
  isActive: account.isActive ?? true,
});

/**
 * Cuenta bancaria en respuestas privadas.
 * @param {object} account
 */
const toPrivateAccount = (account) => ({
  bankName: account.bankName,
  accountNumber: account.accountNumber,
  accountHolder: account.accountHolder,
  accountType: account.accountType,
  isActive: account.isActive,
});

/**
 * Cuenta bancaria en la respuesta publica (sin isActive).
 * @param {object} account
 */
const toPublicAccount = (account) => ({
  bankName: account.bankName,
  accountNumber: account.accountNumber,
  accountHolder: account.accountHolder,
  accountType: account.accountType,
});

/** Actualizacion parcial: solo los campos enviados; la lista de cuentas reemplaza la actual. */
export class UpdateSettingsDTO {
  /** @param {object} body Cuerpo ya validado con updateSettingsSchema. */
  static from(body) {
    return Object.freeze(
      compact({
        defaultTaxRate: body.defaultTaxRate,
        maintenanceMode: body.maintenanceMode,
        companyBankAccounts: body.companyBankAccounts?.map(toStoredAccount),
      }),
    );
  }
}

/** Configuracion completa para el superusuario. */
export class SettingsResponseDTO {
  /** @param {{ defaultTaxRate: number, companyBankAccounts: object[], maintenanceMode: boolean, updatedAt: Date | null, updatedBy: unknown }} settings */
  static from(settings) {
    return {
      defaultTaxRate: settings.defaultTaxRate,
      companyBankAccounts: settings.companyBankAccounts.map(toPrivateAccount),
      maintenanceMode: settings.maintenanceMode,
      updatedAt: settings.updatedAt ?? null,
      updatedBy: settings.updatedBy ? settings.updatedBy.toString() : null,
    };
  }
}

/** Configuracion publica de la tienda: solo IVA y cuentas (ya filtradas como activas por el servicio). */
export class PublicStoreConfigDTO {
  /** @param {{ defaultTaxRate: number, companyBankAccounts: object[] }} config */
  static from(config) {
    return {
      defaultTaxRate: config.defaultTaxRate,
      companyBankAccounts: config.companyBankAccounts.map(toPublicAccount),
    };
  }
}
