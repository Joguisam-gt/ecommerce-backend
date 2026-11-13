/**
 * Pruebas de la configuracion global (Fase 4): validador, DTOs, construccion
 * del upsert, SettingsService (IVA, cuentas bancarias, auditoria y $jsonSchema)
 * y configuracion publica.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ROLES } from '../../src/constants/roles.js';
import { SETTINGS_DEFAULTS, bankAccountKey, duplicateBankAccountIndexes } from '../../src/constants/settings.js';
import { PublicStoreConfigDTO, SettingsResponseDTO, UpdateSettingsDTO } from '../../src/dtos/settings.dto.js';
import { buildSettingsUpsert } from '../../src/repositories/system-settings.repository.js';
import { AUDIT_ACTIONS } from '../../src/services/audit.service.js';
import { validateSchema } from '../../src/validators/schema-validator.js';
import { updateSettingsSchema } from '../../src/validators/settings.validator.js';
import { actorOf, makeUser } from '../helpers/fixtures.js';
import { NOW, makeSuperuserHarness } from '../helpers/superuser-fakes.js';

/** Cuenta bancaria valida. */
const account = (overrides = {}) => ({
  bankName: 'Banco Industrial',
  accountNumber: '123-456789-0',
  accountHolder: 'Tienda S.A.',
  accountType: 'monetaria',
  isActive: true,
  ...overrides,
});

/** Campos con error de una validacion. */
const fieldsOf = (body) => validateSchema(updateSettingsSchema, body).map((error) => error.field);

describe('updateSettingsSchema', () => {
  it('acepta una actualizacion completa valida', () => {
    assert.deepEqual(
      validateSchema(updateSettingsSchema, {
        defaultTaxRate: 0.12,
        maintenanceMode: false,
        companyBankAccounts: [account(), account({ bankName: 'BAC', accountType: 'ahorro', isActive: false })],
      }),
      [],
    );
  });

  it('rechaza una tasa de IVA mayor que 1 o negativa', () => {
    assert.deepEqual(fieldsOf({ defaultTaxRate: 1.2 }), ['defaultTaxRate']);
    assert.deepEqual(fieldsOf({ defaultTaxRate: -0.01 }), ['defaultTaxRate']);
    assert.deepEqual(fieldsOf({ defaultTaxRate: '0.12' }), ['defaultTaxRate']);
    assert.deepEqual(fieldsOf({ defaultTaxRate: 0.123456 }), ['defaultTaxRate']);
    assert.deepEqual(fieldsOf({ defaultTaxRate: 1 }), []);
    assert.deepEqual(fieldsOf({ defaultTaxRate: 0 }), []);
  });

  it('rechaza un banco fuera de la lista cerrada', () => {
    assert.deepEqual(fieldsOf({ companyBankAccounts: [account({ bankName: 'Banco Ficticio' })] }), ['companyBankAccounts[0].bankName']);
  });

  it('valida numero de cuenta, titular, tipo y campos desconocidos de cada cuenta', () => {
    assert.deepEqual(fieldsOf({ companyBankAccounts: [account({ accountNumber: 'ABC-123' })] }), ['companyBankAccounts[0].accountNumber']);
    assert.deepEqual(fieldsOf({ companyBankAccounts: [account({ accountNumber: '-12345' })] }), ['companyBankAccounts[0].accountNumber']);
    assert.deepEqual(fieldsOf({ companyBankAccounts: [account({ accountNumber: '1234' })] }), ['companyBankAccounts[0].accountNumber']);
    assert.deepEqual(fieldsOf({ companyBankAccounts: [account({ accountHolder: 'AB' })] }), ['companyBankAccounts[0].accountHolder']);
    assert.deepEqual(fieldsOf({ companyBankAccounts: [account({ accountType: 'corriente' })] }), ['companyBankAccounts[0].accountType']);
    assert.deepEqual(fieldsOf({ companyBankAccounts: [{ ...account(), swift: 'X' }] }), ['companyBankAccounts[0].swift']);
  });

  it('rechaza cuentas repetidas (mismo banco y numero, aunque cambien los guiones)', () => {
    const fields = fieldsOf({ companyBankAccounts: [account({ accountNumber: '123-456' }), account({ accountNumber: '123456' })] });
    assert.deepEqual(fields, ['companyBankAccounts[1].accountNumber']);
    // Mismo numero en otro banco si es valido.
    assert.deepEqual(fieldsOf({ companyBankAccounts: [account(), account({ bankName: 'BAC' })] }), []);
  });

  it('rechaza mas de 20 cuentas, una lista que no es arreglo y campos desconocidos', () => {
    const many = Array.from({ length: 21 }, (_, index) => account({ accountNumber: `10000${index}` }));
    assert.deepEqual(fieldsOf({ companyBankAccounts: many }), ['companyBankAccounts']);
    assert.deepEqual(fieldsOf({ companyBankAccounts: null }), ['companyBankAccounts']);
    assert.deepEqual(fieldsOf({ maintenanceMode: true, theme: 'dark' }), ['theme']);
  });

  it('cuerpo vacio: 400 (al menos un campo)', () => {
    assert.deepEqual(fieldsOf({}), ['_root']);
  });
});

describe('DTOs y utilidades de configuracion', () => {
  it('UpdateSettingsDTO solo incluye lo enviado y normaliza las cuentas', () => {
    assert.deepEqual(UpdateSettingsDTO.from({ maintenanceMode: true }), { maintenanceMode: true });
    const dto = UpdateSettingsDTO.from({ companyBankAccounts: [{ ...account({ accountHolder: '  Tienda   S.A. ' }), isActive: undefined }] });
    assert.deepEqual(dto.companyBankAccounts, [account({ accountHolder: 'Tienda S.A.' })]);
  });

  it('PublicStoreConfigDTO no expone isActive ni otros campos', () => {
    const dto = PublicStoreConfigDTO.from({ defaultTaxRate: 0.12, companyBankAccounts: [account()], maintenanceMode: true });
    assert.deepEqual(Object.keys(dto).sort(), ['companyBankAccounts', 'defaultTaxRate']);
    assert.deepEqual(Object.keys(dto.companyBankAccounts[0]).sort(), ['accountHolder', 'accountNumber', 'accountType', 'bankName']);
  });

  it('bankAccountKey ignora los guiones y duplicateBankAccountIndexes marca las repeticiones', () => {
    assert.equal(bankAccountKey(account({ accountNumber: '12-34-56' })), bankAccountKey(account({ accountNumber: '123456' })));
    assert.deepEqual(duplicateBankAccountIndexes([account(), account({ bankName: 'BAC' }), account()]), [2]);
  });

  it('buildSettingsUpsert nunca repite un campo en $set y $setOnInsert', () => {
    const update = buildSettingsUpsert({ maintenanceMode: true, updatedAt: NOW }, SETTINGS_DEFAULTS);
    assert.deepEqual(Object.keys(update.$setOnInsert).sort(), ['companyBankAccounts', 'defaultTaxRate']);
    assert.equal(Object.keys(update.$set).some((key) => Object.hasOwn(update.$setOnInsert, key)), false);
    const full = buildSettingsUpsert({ defaultTaxRate: 0.1, companyBankAccounts: [], maintenanceMode: false }, SETTINGS_DEFAULTS);
    assert.equal(full.$setOnInsert, undefined);
  });
});

describe('SettingsService', () => {
  let h;
  let root;

  beforeEach(() => {
    root = makeUser({ role: ROLES.SUPERUSER });
    h = makeSuperuserHarness({ users: [root] });
  });

  it('sin documento devuelve los valores por defecto (0.12, [], false)', async () => {
    const settings = await h.settingsService.getSettings();
    assert.deepEqual(settings, { defaultTaxRate: 0.12, companyBankAccounts: [], maintenanceMode: false, updatedAt: null, updatedBy: null });
    assert.equal(await h.settingsService.isMaintenanceMode(), false);
  });

  it('actualiza IVA y cuentas: upsert valido contra el $jsonSchema y auditoria before/after', async () => {
    const dto = UpdateSettingsDTO.from({ defaultTaxRate: 0.15, companyBankAccounts: [account(), account({ bankName: 'G&T', isActive: false })] });
    const result = await h.settingsService.updateSettings(actorOf(root), dto, { ip: '127.0.0.1' });

    assert.equal(result.defaultTaxRate, 0.15);
    assert.equal(result.companyBankAccounts.length, 2);
    assert.equal(result.maintenanceMode, false, 'valor por defecto insertado con $setOnInsert');
    assert.equal(result.updatedBy.toString(), root._id.toString());
    assert.deepEqual(result.updatedAt, NOW);
    assert.deepEqual(h.systemSettingsRepository.schemaErrors(), []);

    const [entry] = h.auditLogRepository.entries;
    assert.equal(entry.action, AUDIT_ACTIONS.SETTINGS_UPDATED);
    assert.equal(entry.targetCollection, 'system_settings');
    assert.equal(entry.entityId, 'global_config');
    assert.equal(entry.metadata.created, true);
    assert.equal(entry.metadata.before, null);
    assert.equal(entry.metadata.after.defaultTaxRate, 0.15);
    assert.deepEqual(entry.metadata.fields.sort(), ['companyBankAccounts', 'defaultTaxRate']);
    assert.ok(h.auditLogRepository.sessions[0]);
  });

  it('una segunda actualizacion parcial conserva el resto y audita el estado previo', async () => {
    await h.settingsService.updateSettings(actorOf(root), { defaultTaxRate: 0.15, companyBankAccounts: [account()] });
    const result = await h.settingsService.updateSettings(actorOf(root), { maintenanceMode: true });

    assert.equal(result.defaultTaxRate, 0.15);
    assert.equal(result.companyBankAccounts.length, 1);
    assert.equal(result.maintenanceMode, true);
    const last = h.auditLogRepository.entries.at(-1);
    assert.equal(last.metadata.before.maintenanceMode, false);
    assert.equal(last.metadata.after.maintenanceMode, true);
    assert.equal(await h.settingsService.isMaintenanceMode(), true);
  });

  it('companyBankAccounts reemplaza la lista completa', async () => {
    await h.settingsService.updateSettings(actorOf(root), { companyBankAccounts: [account(), account({ bankName: 'BAC' })] });
    const result = await h.settingsService.updateSettings(actorOf(root), { companyBankAccounts: [account({ bankName: 'Banrural' })] });
    assert.deepEqual(result.companyBankAccounts.map((item) => item.bankName), ['Banrural']);
  });

  it('el $jsonSchema es la ultima barrera: una tasa > 1 se rechaza y se revierte sin auditoria', async () => {
    await assert.rejects(h.settingsService.updateSettings(actorOf(root), { defaultTaxRate: 1.5 }), { code: 121 });
    assert.equal(h.systemSettingsRepository.doc, null);
    assert.equal(h.auditLogRepository.entries.length, 0);
  });

  it('rechaza cuentas repetidas y actualizaciones vacias aunque se salte el validador', async () => {
    await assert.rejects(h.settingsService.updateSettings(actorOf(root), { companyBankAccounts: [account(), account()] }), {
      status: 400,
      code: 'DUPLICATE_BANK_ACCOUNT',
    });
    await assert.rejects(h.settingsService.updateSettings(actorOf(root), {}), { status: 400, code: 'EMPTY_UPDATE' });
    await assert.rejects(h.settingsService.updateSettings(actorOf(root), { theme: 'dark' }), { code: 'EMPTY_UPDATE' });
  });

  it('configuracion publica: solo IVA y cuentas activas, sin isActive', async () => {
    await h.settingsService.updateSettings(actorOf(root), {
      defaultTaxRate: 0.12,
      maintenanceMode: true,
      companyBankAccounts: [account(), account({ bankName: 'BAC', isActive: false })],
    });
    const publicConfig = PublicStoreConfigDTO.from(await h.settingsService.getPublicConfig());
    assert.deepEqual(publicConfig, {
      defaultTaxRate: 0.12,
      companyBankAccounts: [{ bankName: 'Banco Industrial', accountNumber: '123-456789-0', accountHolder: 'Tienda S.A.', accountType: 'monetaria' }],
    });
  });

  it('SettingsResponseDTO expone updatedBy como texto', async () => {
    const settings = await h.settingsService.updateSettings(actorOf(root), { maintenanceMode: false });
    const dto = SettingsResponseDTO.from(settings);
    assert.equal(dto.updatedBy, root._id.toString());
    assert.deepEqual(dto.companyBankAccounts, []);
  });
});
