/**
 * Servicio de configuracion global de la tienda (Fase 4).
 *
 * Responsabilidad unica: leer y actualizar el documento 'global_config' de
 * system_settings (tasa de IVA por defecto, cuentas bancarias de la empresa y
 * modo mantenimiento).
 * - Lectura: si el documento aun no existe devuelve los valores por defecto.
 * - Actualizacion parcial: lectura previa, upsert y auditoria (before/after)
 *   en la misma transaccion. companyBankAccounts se reemplaza completo.
 * - Configuracion publica: solo IVA y cuentas activas (sin campo isActive).
 * - isMaintenanceMode alimenta el middleware createMaintenanceGuard.
 */
import { SETTINGS_DEFAULTS, SYSTEM_SETTINGS_ID, duplicateBankAccountIndexes } from '../constants/settings.js';
import { COLLECTIONS } from '../database/collections.js';
import { HttpError } from '../utils/http-error.js';
import { toObjectId } from '../utils/object-id.js';
import { AUDIT_ACTIONS } from './audit.service.js';

/** Campos que se pueden modificar con PATCH. */
export const MUTABLE_SETTINGS_FIELDS = Object.freeze(['defaultTaxRate', 'companyBankAccounts', 'maintenanceMode']);

/**
 * Configuracion efectiva: el documento guardado o los valores por defecto.
 * @param {object | null} doc
 * @returns {{ defaultTaxRate: number, companyBankAccounts: object[], maintenanceMode: boolean,
 *             updatedAt: Date | null, updatedBy: import('mongodb').ObjectId | null }}
 */
export function effectiveSettings(doc) {
  return {
    defaultTaxRate: doc?.defaultTaxRate ?? SETTINGS_DEFAULTS.defaultTaxRate,
    companyBankAccounts: (doc?.companyBankAccounts ?? SETTINGS_DEFAULTS.companyBankAccounts).map((account) => ({ ...account })),
    maintenanceMode: doc?.maintenanceMode ?? SETTINGS_DEFAULTS.maintenanceMode,
    updatedAt: doc?.updatedAt ?? null,
    updatedBy: doc?.updatedBy ?? null,
  };
}

/**
 * Estado auditable de la configuracion (null si el documento no existia).
 * @param {object | null} doc
 */
function settingsAuditState(doc) {
  if (!doc) return null;
  const { defaultTaxRate, companyBankAccounts, maintenanceMode } = effectiveSettings(doc);
  return { defaultTaxRate, companyBankAccounts, maintenanceMode };
}

export class SettingsService {
  #settings;
  #transactions;
  #audit;
  #now;

  /**
   * @param {{ systemSettingsRepository: import('../repositories/system-settings.repository.js').SystemSettingsRepository,
   *           transactionRunner: { run: (work: (session: object) => Promise<any>) => Promise<any> },
   *           auditService: import('./audit.service.js').AuditService, clock?: () => Date }} deps
   */
  constructor({ systemSettingsRepository, transactionRunner, auditService, clock = () => new Date() }) {
    this.#settings = systemSettingsRepository;
    this.#transactions = transactionRunner;
    this.#audit = auditService;
    this.#now = clock;
  }

  /**
   * Configuracion completa (o valores por defecto).
   * @returns {Promise<ReturnType<typeof effectiveSettings>>}
   */
  async getSettings() {
    return effectiveSettings(await this.#settings.findGlobal());
  }

  /**
   * Configuracion publica: tasa de IVA y solo las cuentas activas.
   * @returns {Promise<{ defaultTaxRate: number, companyBankAccounts: object[] }>}
   */
  async getPublicConfig() {
    const { defaultTaxRate, companyBankAccounts } = await this.getSettings();
    return { defaultTaxRate, companyBankAccounts: companyBankAccounts.filter((account) => account.isActive === true) };
  }

  /**
   * Indica si la tienda esta en modo mantenimiento.
   * @returns {Promise<boolean>}
   */
  async isMaintenanceMode() {
    return (await this.getSettings()).maintenanceMode === true;
  }

  /**
   * Actualizacion parcial con upsert y auditoria en la misma transaccion.
   * @param {{ id: string, role: string }} actor
   * @param {object} changes UpdateSettingsDTO (solo MUTABLE_SETTINGS_FIELDS).
   * @param {object} [context] requestContext(req)
   * @returns {Promise<ReturnType<typeof effectiveSettings>>}
   */
  async updateSettings(actor, changes, context = {}) {
    const fields = Object.keys(changes).filter((key) => MUTABLE_SETTINGS_FIELDS.includes(key));
    if (fields.length === 0 || fields.length !== Object.keys(changes).length) {
      throw HttpError.badRequest('Debes enviar al menos un campo de configuracion valido', 'EMPTY_UPDATE');
    }
    if (changes.companyBankAccounts && duplicateBankAccountIndexes(changes.companyBankAccounts).length > 0) {
      throw HttpError.badRequest('Hay cuentas bancarias repetidas (mismo banco y numero)', 'DUPLICATE_BANK_ACCOUNT');
    }
    const updatedBy = toObjectId(actor.id);

    return this.#transactions.run(async (session) => {
      const before = await this.#settings.findGlobal({ session });
      const after = await this.#settings.upsertGlobal(
        { ...changes, updatedAt: this.#now(), updatedBy },
        SETTINGS_DEFAULTS,
        { session },
      );
      await this.#audit.recordInTransaction(
        {
          action: AUDIT_ACTIONS.SETTINGS_UPDATED,
          entity: 'settings',
          entityId: SYSTEM_SETTINGS_ID,
          targetCollection: COLLECTIONS.SYSTEM_SETTINGS,
          actor,
          metadata: { fields, created: before === null, before: settingsAuditState(before), after: settingsAuditState(after) },
          context,
        },
        session,
      );
      return effectiveSettings(after);
    });
  }
}
