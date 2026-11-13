/**
 * Definicion de la coleccion system_settings (Fase 4): configuracion global.
 *
 * Contiene un unico documento con _id fijo 'global_config' (el enum del _id
 * impide crear otros). Guarda la tasa de IVA por defecto (fraccion 0..1), las
 * cuentas bancarias de la empresa para transferencias y el modo mantenimiento.
 * No declara indices propios: solo se consulta por _id (indice primario).
 */
import { COLLECTIONS } from '../collections.js';
import {
  ACCOUNT_HOLDER_LIMITS,
  ACCOUNT_NUMBER_PATTERN_SOURCE,
  ALL_BANK_ACCOUNT_TYPES,
  ALL_SYSTEM_SETTINGS_IDS,
  COMPANY_BANKS,
  MAX_COMPANY_BANK_ACCOUNTS,
  TAX_RATE_LIMITS,
} from '../../constants/settings.js';
import * as t from './schema-types.js';

/** Cuenta bancaria de la empresa. */
const companyBankAccount = {
  bsonType: 'object',
  additionalProperties: false,
  required: ['bankName', 'accountNumber', 'accountHolder', 'accountType', 'isActive'],
  properties: {
    bankName: t.enumOf(COMPANY_BANKS),
    accountNumber: { bsonType: 'string', pattern: ACCOUNT_NUMBER_PATTERN_SOURCE },
    accountHolder: t.string(ACCOUNT_HOLDER_LIMITS.MIN, ACCOUNT_HOLDER_LIMITS.MAX),
    accountType: t.enumOf(ALL_BANK_ACCOUNT_TYPES),
    isActive: t.bool,
  },
};

export const systemSettingsCollection = Object.freeze({
  name: COLLECTIONS.SYSTEM_SETTINGS,
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'system_settings',
      additionalProperties: false,
      required: ['_id', 'defaultTaxRate', 'companyBankAccounts', 'maintenanceMode', 'updatedAt', 'updatedBy'],
      properties: {
        _id: { bsonType: 'string', enum: [...ALL_SYSTEM_SETTINGS_IDS] },
        defaultTaxRate: { bsonType: ['double', 'int'], minimum: TAX_RATE_LIMITS.MIN, maximum: TAX_RATE_LIMITS.MAX },
        companyBankAccounts: { bsonType: 'array', maxItems: MAX_COMPANY_BANK_ACCOUNTS, items: companyBankAccount },
        maintenanceMode: t.bool,
        updatedAt: t.date,
        updatedBy: t.nullableObjectId,
      },
    },
  },
  indexes: [],
});
