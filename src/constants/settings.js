/**
 * Constantes de la configuracion global de la tienda (Fase 4, coleccion system_settings).
 *
 * Es la fuente unica para el $jsonSchema, los validadores, los DTOs y el
 * servicio de configuracion: anadir un tipo de cuenta o cambiar un limite
 * solo requiere editar este archivo.
 */
import { BANKS } from './commerce.js';

/** _id del unico documento de configuracion (patron singleton por documento). */
export const SYSTEM_SETTINGS_ID = 'global_config';

/** Valores admitidos para el _id de system_settings. */
export const ALL_SYSTEM_SETTINGS_IDS = Object.freeze([SYSTEM_SETTINGS_ID]);

/** Bancos admitidos para las cuentas de la empresa (los mismos de las transferencias). */
export const COMPANY_BANKS = BANKS;

/** Tipos de cuenta bancaria de la empresa. */
export const BANK_ACCOUNT_TYPES = Object.freeze({ MONETARIA: 'monetaria', AHORRO: 'ahorro' });

export const ALL_BANK_ACCOUNT_TYPES = Object.freeze(Object.values(BANK_ACCOUNT_TYPES));

/** Maximo de cuentas bancarias registradas. */
export const MAX_COMPANY_BANK_ACCOUNTS = 20;

/**
 * Numero de cuenta: solo digitos y guiones, de 5 a 30 caracteres, empezando y
 * terminando en digito (evita guiones sueltos en los extremos).
 */
export const ACCOUNT_NUMBER_PATTERN_SOURCE = '^[0-9][0-9-]{3,28}[0-9]$';
export const ACCOUNT_NUMBER_PATTERN = new RegExp(ACCOUNT_NUMBER_PATTERN_SOURCE);

/** Limites del titular de la cuenta. */
export const ACCOUNT_HOLDER_LIMITS = Object.freeze({ MIN: 3, MAX: 120 });

/** Limites de la tasa de IVA por defecto (fraccion: 0.12 = 12 %). */
export const TAX_RATE_LIMITS = Object.freeze({ MIN: 0, MAX: 1, MAX_DECIMALS: 4 });

/**
 * Valores por defecto de la configuracion: se devuelven cuando el documento
 * aun no existe y se insertan con $setOnInsert en el primer upsert.
 */
export const SETTINGS_DEFAULTS = Object.freeze({
  defaultTaxRate: 0.12,
  companyBankAccounts: Object.freeze([]),
  maintenanceMode: false,
});

/** Segundos de cache publica del endpoint GET /api/store/config/public. */
export const PUBLIC_CONFIG_MAX_AGE_SECONDS = 60;

/**
 * Clave de unicidad de una cuenta: banco + numero sin guiones, para que
 * "123-456" y "123456" del mismo banco se consideren la misma cuenta.
 * @param {{ bankName: string, accountNumber: string }} account
 * @returns {string}
 */
export function bankAccountKey(account) {
  return `${account.bankName}|${String(account.accountNumber).replace(/-/g, '')}`;
}

/**
 * Indices (posiciones) de las cuentas repetidas segun bankAccountKey.
 * @param {ReadonlyArray<{ bankName: string, accountNumber: string }>} accounts
 * @returns {number[]}
 */
export function duplicateBankAccountIndexes(accounts) {
  const seen = new Set();
  const duplicates = [];
  accounts.forEach((account, index) => {
    const key = bankAccountKey(account);
    if (seen.has(key)) duplicates.push(index);
    seen.add(key);
  });
  return duplicates;
}
