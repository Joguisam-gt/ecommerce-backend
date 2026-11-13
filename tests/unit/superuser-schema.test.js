/**
 * Pruebas de esquema de la Fase 4: coleccion system_settings registrada con
 * $jsonSchema estricto, extension retrocompatible de audit_logs (snapshot,
 * indices nuevos y relleno de timestamp tras el collMod) e indices de
 * bloqueo fiscal en invoices.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { BANKS } from '../../src/constants/commerce.js';
import { COLLECTIONS } from '../../src/database/collections.js';
import { COLLECTION_DEFINITIONS } from '../../src/database/schemas/index.js';
import { ensureCollections } from '../../src/database/setup.js';
import { jsonSchemaErrors } from '../helpers/checkout-fakes.js';

/** Definicion registrada por nombre. */
const definitionOf = (name) => COLLECTION_DEFINITIONS.find((definition) => definition.name === name);

/** Documento de configuracion valido. */
const validSettings = (overrides = {}) => ({
  _id: 'global_config',
  defaultTaxRate: 0.12,
  companyBankAccounts: [
    { bankName: 'BAC', accountNumber: '900-123456-7', accountHolder: 'Tienda S.A.', accountType: 'ahorro', isActive: true },
  ],
  maintenanceMode: false,
  updatedAt: new Date(),
  updatedBy: null,
  ...overrides,
});

describe('system_settings ($jsonSchema)', () => {
  const definition = definitionOf(COLLECTIONS.SYSTEM_SETTINGS);
  const schema = definition?.validator.$jsonSchema;

  it('esta registrada en COLLECTIONS y en COLLECTION_DEFINITIONS', () => {
    assert.equal(COLLECTIONS.SYSTEM_SETTINGS, 'system_settings');
    assert.ok(definition);
    assert.equal(COLLECTION_DEFINITIONS.length, Object.keys(COLLECTIONS).length);
  });

  it('es estricta: additionalProperties false, _id fijo y enums de banco y tipo de cuenta', () => {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.properties._id, { bsonType: 'string', enum: ['global_config'] });
    assert.deepEqual(schema.properties.defaultTaxRate, { bsonType: ['double', 'int'], minimum: 0, maximum: 1 });
    assert.equal(schema.properties.companyBankAccounts.maxItems, 20);
    const account = schema.properties.companyBankAccounts.items;
    assert.equal(account.additionalProperties, false);
    assert.deepEqual(account.properties.bankName.enum, [...BANKS]);
    assert.deepEqual(account.properties.accountType.enum, ['monetaria', 'ahorro']);
    assert.deepEqual(schema.properties.updatedBy.bsonType, ['objectId', 'null']);
  });

  it('acepta un documento valido y rechaza tasa > 1, banco fuera del enum, otro _id y campos extra', () => {
    assert.deepEqual(jsonSchemaErrors(validSettings(), schema), []);
    assert.deepEqual(jsonSchemaErrors(validSettings({ updatedBy: new ObjectId() }), schema), []);
    assert.ok(jsonSchemaErrors(validSettings({ defaultTaxRate: 1.2 }), schema).length > 0);
    assert.ok(jsonSchemaErrors(validSettings({ _id: 'otra_config' }), schema).length > 0);
    assert.ok(jsonSchemaErrors(validSettings({ theme: 'dark' }), schema).length > 0);
    const badBank = validSettings({
      companyBankAccounts: [{ bankName: 'Banco X', accountNumber: '12345', accountHolder: 'Tienda', accountType: 'ahorro', isActive: true }],
    });
    assert.ok(jsonSchemaErrors(badBank, schema).some((error) => error.includes('bankName')));
    const badNumber = validSettings({
      companyBankAccounts: [{ bankName: 'BAC', accountNumber: '12a45', accountHolder: 'Tienda', accountType: 'ahorro', isActive: true }],
    });
    assert.ok(jsonSchemaErrors(badNumber, schema).some((error) => error.includes('accountNumber')));
  });

  it('se crea con validacion estricta en ensureCollections', async () => {
    const created = [];
    const db = {
      listCollections: () => ({ toArray: async () => [] }),
      createCollection: async (name, options) => created.push({ name, options }),
      command: async () => {},
      collection: () => ({ createIndexes: async () => {} }),
    };
    await ensureCollections(db);
    const settings = created.find((entry) => entry.name === COLLECTIONS.SYSTEM_SETTINGS);
    assert.equal(settings.options.validationLevel, 'strict');
    assert.equal(settings.options.validationAction, 'error');
  });
});

describe('audit_logs (extension retrocompatible)', () => {
  const definition = definitionOf(COLLECTIONS.AUDIT_LOGS);
  const schema = definition.validator.$jsonSchema;

  it('anade snapshot opcional y conserva createdAt obligatorio', () => {
    assert.deepEqual(schema.properties.snapshot, { bsonType: ['object', 'null'] });
    assert.deepEqual(schema.properties.targetCollection.bsonType, ['string', 'null']);
    assert.deepEqual(schema.properties.timestamp.bsonType, ['date', 'null']);
    assert.ok(schema.required.includes('createdAt'));
    assert.equal(schema.required.includes('snapshot'), false);
    assert.equal(schema.required.includes('timestamp'), false);
  });

  it('declara el indice compuesto por coleccion y fecha, el de fecha y conserva los anteriores', () => {
    const byName = Object.fromEntries(definition.indexes.map((index) => [index.name, index.key]));
    assert.deepEqual(byName.ix_audit_collection_timestamp, { targetCollection: 1, timestamp: -1 });
    assert.deepEqual(byName.ix_audit_timestamp, { timestamp: -1 });
    for (const name of ['ix_audit_created', 'ix_audit_actor_created', 'ix_audit_entity_created', 'ix_audit_action_created', 'ix_audit_target_timestamp']) {
      assert.ok(byName[name], name);
    }
  });

  it('una entrada antigua (sin campos nuevos) y una de purga cumplen el esquema', () => {
    const legacy = { _id: new ObjectId(), action: 'auth.login', entity: 'user', outcome: 'success', createdAt: new Date() };
    assert.deepEqual(jsonSchemaErrors(legacy, schema), []);
    const purge = {
      ...legacy,
      action: 'record.purged',
      entity: 'users',
      targetCollection: 'users',
      timestamp: new Date(),
      snapshot: { email: 'a@b.co', _id: new ObjectId() },
      metadata: { cascade: {} },
    };
    assert.deepEqual(jsonSchemaErrors(purge, schema), []);
  });

  it('rellena timestamp con createdAt DESPUES del collMod (solo si la coleccion existe)', async () => {
    const calls = [];
    const db = {
      listCollections: () => ({ toArray: async () => [{ name: COLLECTIONS.AUDIT_LOGS }] }),
      createCollection: async () => {},
      command: async (cmd) => calls.push({ type: 'collMod', name: cmd.collMod }),
      collection: (name) => ({
        updateMany: async (filter, update) => calls.push({ type: 'updateMany', name, filter, update }),
        createIndexes: async () => {},
      }),
    };
    await ensureCollections(db);
    const auditCalls = calls.filter((call) => call.name === COLLECTIONS.AUDIT_LOGS);
    assert.deepEqual(auditCalls.map((call) => call.type), ['collMod', 'updateMany']);
    assert.deepEqual(auditCalls[1].filter, { timestamp: null, createdAt: { $type: 'date' } });
    assert.deepEqual(auditCalls[1].update, [{ $set: { timestamp: '$createdAt' } }]);
  });
});

describe('invoices (indices del bloqueo fiscal)', () => {
  it('indexa items.productId y supplierId (parcial)', () => {
    const byName = Object.fromEntries(definitionOf(COLLECTIONS.INVOICES).indexes.map((index) => [index.name, index]));
    assert.deepEqual(byName.ix_invoices_items_product.key, { 'items.productId': 1 });
    assert.deepEqual(byName.ix_invoices_supplier.key, { supplierId: 1 });
    assert.deepEqual(byName.ix_invoices_supplier.partialFilterExpression, { supplierId: { $type: 'objectId' } });
  });
});
