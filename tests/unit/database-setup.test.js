/**
 * Pruebas de las definiciones de colecciones y de la sincronizacion de esquema.
 * Se usa una base de datos falsa que registra las llamadas recibidas.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COLLECTIONS } from '../../src/database/collections.js';
import { COLLECTION_DEFINITIONS } from '../../src/database/schemas/index.js';
import { ensureCollections } from '../../src/database/setup.js';

/**
 * Crea un doble de Db con colecciones preexistentes.
 * @param {string[]} existing
 */
function makeFakeDb(existing = []) {
  const calls = { created: [], collMod: [], indexes: {} };
  return {
    calls,
    listCollections: () => ({ toArray: async () => existing.map((name) => ({ name })) }),
    createCollection: async (name, options) => calls.created.push({ name, options }),
    command: async (cmd) => calls.collMod.push(cmd),
    collection: (name) => ({
      updateMany: async (filter, update) => {
        calls.migrations = [...(calls.migrations ?? []), { name, filter, update }];
      },
      createIndexes: async (indexes) => {
        calls.indexes[name] = indexes;
      },
    }),
  };
}

/**
 * Busca el $jsonSchema dentro de un validador (puede venir dentro de $and).
 * @param {object} validator
 */
function jsonSchemaOf(validator) {
  return validator.$jsonSchema ?? validator.$and.find((rule) => rule.$jsonSchema).$jsonSchema;
}

/** Colecciones que solo se consultan por _id y no declaran indices propios. */
const ID_ONLY_COLLECTIONS = Object.freeze([COLLECTIONS.COUNTERS]);

describe('Definiciones de colecciones', () => {
  it('cubre todas las colecciones declaradas', () => {
    const names = COLLECTION_DEFINITIONS.map((definition) => definition.name).sort();
    assert.deepEqual(names, Object.values(COLLECTIONS).sort());
  });

  it('cada coleccion tiene $jsonSchema estricto, campos obligatorios e indices con nombre', () => {
    for (const definition of COLLECTION_DEFINITIONS) {
      const schema = jsonSchemaOf(definition.validator);
      assert.equal(schema.bsonType, 'object', definition.name);
      assert.equal(schema.additionalProperties, false, definition.name);
      assert.ok(schema.required.length > 0, definition.name);
      // counters solo usa el indice _id; el resto debe declarar indices propios.
      if (!ID_ONLY_COLLECTIONS.includes(definition.name)) assert.ok(definition.indexes.length > 0, definition.name);
      for (const index of definition.indexes) assert.ok(index.name, `${definition.name}: indice sin nombre`);
    }
  });

  it('users tiene indice unico sobre email y no permite roles desconocidos', () => {
    const users = COLLECTION_DEFINITIONS.find((definition) => definition.name === COLLECTIONS.USERS);
    const emailIndex = users.indexes.find((index) => index.key.email === 1);
    assert.equal(emailIndex.unique, true);
    assert.deepEqual(users.validator.$jsonSchema.properties.role.enum, ['superuser', 'admin', 'user']);
  });

  it('los nombres de indices son unicos por coleccion', () => {
    for (const definition of COLLECTION_DEFINITIONS) {
      const names = definition.indexes.map((index) => index.name);
      assert.equal(new Set(names).size, names.length, definition.name);
    }
  });
});

describe('ensureCollections', () => {
  it('crea las colecciones que no existen con validacion estricta', async () => {
    const db = makeFakeDb();
    const summary = await ensureCollections(db);

    assert.equal(summary.created.length, COLLECTION_DEFINITIONS.length);
    assert.equal(summary.updated.length, 0);
    for (const { options } of db.calls.created) {
      assert.equal(options.validationLevel, 'strict');
      assert.equal(options.validationAction, 'error');
    }
    assert.equal(Object.keys(db.calls.indexes).length, COLLECTION_DEFINITIONS.filter((d) => d.indexes.length > 0).length);
  });

  it('actualiza con collMod las colecciones existentes (idempotente)', async () => {
    const db = makeFakeDb([COLLECTIONS.USERS, COLLECTIONS.ORDERS]);
    const summary = await ensureCollections(db);

    assert.deepEqual(summary.updated.sort(), [COLLECTIONS.ORDERS, COLLECTIONS.USERS]);
    assert.equal(summary.created.length, COLLECTION_DEFINITIONS.length - 2);
    assert.ok(db.calls.collMod.every((cmd) => cmd.validator && cmd.validationLevel === 'strict'));
  });
});

describe('Migraciones previas al validador (Fase 3)', () => {
  it('marca como "cliente" las facturas antiguas sin entityType antes del collMod', async () => {
    const db = makeFakeDb([COLLECTIONS.INVOICES]);
    await ensureCollections(db);
    assert.deepEqual(db.calls.migrations, [
      {
        name: COLLECTIONS.INVOICES,
        filter: { entityType: { $exists: false } },
        update: { $set: { entityType: 'cliente' } },
      },
    ]);
  });

  it('no migra cuando la coleccion se crea desde cero', async () => {
    const db = makeFakeDb([]);
    await ensureCollections(db);
    assert.equal(db.calls.migrations, undefined);
  });
});
