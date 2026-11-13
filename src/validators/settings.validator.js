/**
 * Esquema de validacion de la configuracion global (Fase 4, PATCH /api/superuser/settings).
 *
 * Primera barrera, coherente con el $jsonSchema de system_settings:
 * - defaultTaxRate: numero entre 0 y 1 (fraccion: 0.12 = 12 %), maximo 4 decimales.
 * - companyBankAccounts: lista (maximo 20) que REEMPLAZA la actual; cada cuenta
 *   con banco de la lista cerrada, numero de digitos y guiones, titular, tipo
 *   e isActive opcional (por defecto true). Sin repetir banco + numero.
 * - maintenanceMode: booleano.
 * - Cuerpo vacio o sin campos conocidos: 400.
 * El motor no tiene tipo "array": la lista se valida en refine con las ayudas
 * de purchase.validator.js (mismo patron que proveedores y compras).
 */
import {
  ACCOUNT_HOLDER_LIMITS,
  ACCOUNT_NUMBER_PATTERN,
  ALL_BANK_ACCOUNT_TYPES,
  COMPANY_BANKS,
  MAX_COMPANY_BANK_ACCOUNTS,
  TAX_RATE_LIMITS,
  duplicateBankAccountIndexes,
} from '../constants/settings.js';
import { objectArrayErrors, unknownFieldErrors } from './purchase.validator.js';

/** Cuenta bancaria de la empresa. */
export const bankAccountSchema = Object.freeze({
  fields: {
    bankName: { type: 'enum', required: true, values: COMPANY_BANKS },
    accountNumber: {
      type: 'string',
      required: true,
      pattern: ACCOUNT_NUMBER_PATTERN,
      patternMessage: 'Numero de cuenta invalido: solo digitos y guiones (5 a 30 caracteres)',
    },
    accountHolder: { type: 'string', required: true, minLength: ACCOUNT_HOLDER_LIMITS.MIN, maxLength: ACCOUNT_HOLDER_LIMITS.MAX },
    accountType: { type: 'enum', required: true, values: ALL_BANK_ACCOUNT_TYPES },
    isActive: { type: 'boolean' },
  },
});

/** Campos escalares de la configuracion. */
const scalarFields = Object.freeze({
  defaultTaxRate: { type: 'number', min: TAX_RATE_LIMITS.MIN, max: TAX_RATE_LIMITS.MAX, maxDecimals: TAX_RATE_LIMITS.MAX_DECIMALS },
  maintenanceMode: { type: 'boolean' },
});

/** Todos los campos admitidos en el PATCH. */
const ALLOWED_FIELDS = Object.freeze([...Object.keys(scalarFields), 'companyBankAccounts']);

/**
 * Valida la lista de cuentas (forma de cada elemento y duplicados banco + numero).
 * @param {object} input
 * @returns {Array<{ field: string, message: string }>}
 */
function bankAccountErrors(input) {
  const errors = objectArrayErrors(input.companyBankAccounts, 'companyBankAccounts', bankAccountSchema, {
    maxItems: MAX_COMPANY_BANK_ACCOUNTS,
  });
  if (errors.length > 0 || input.companyBankAccounts === undefined) return errors;

  const normalized = input.companyBankAccounts.map((account) => ({ ...account, accountNumber: account.accountNumber.trim() }));
  return duplicateBankAccountIndexes(normalized).map((index) => ({
    field: `companyBankAccounts[${index}].accountNumber`,
    message: 'Cuenta repetida: el mismo banco y numero ya estan en la lista',
  }));
}

export const updateSettingsSchema = Object.freeze({
  fields: scalarFields,
  allowUnknown: true,
  refine: (input) => {
    const errors = [...unknownFieldErrors(input, ALLOWED_FIELDS), ...bankAccountErrors(input)];
    if (!ALLOWED_FIELDS.some((key) => input[key] !== undefined)) {
      errors.push({ field: '_root', message: 'Debes enviar al menos 1 campo(s) a modificar' });
    }
    return errors;
  },
});
