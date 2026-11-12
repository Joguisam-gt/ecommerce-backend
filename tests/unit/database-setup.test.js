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

describe('Definiciones de colecciones', () => {
  it('cubre las 7 colecciones requeridas', () => {
    const names = COLLECTION_DEFINITIONS.map((definition) => definition.name).sort();
    assert.deepEqual(names, Object.values(COLLECTIONS).sort());
  });

  it('cada coleccion tiene $jsonSchema estricto, campos obligatorios e indices con nombre', () => {
    for (const definition of COLLECTION_DEFINITIONS) {
      const schema = jsonSchemaOf(definition.validator);
      assert.equal(schema.bsonType, 'object', definition.name);
      assert.equal(schema.additionalProperties, false, definition.name);
      assert.ok(schema.required.length > 0, definition.name);
      assert.ok(definition.indexes.length > 0, definition.name);
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

    assert.equal(summary.created.length, 7);
    assert.equal(summary.updated.length, 0);
    for (const { options } of db.calls.created) {
      assert.equal(options.validationLevel, 'strict');
      assert.equal(options.validationAction, 'error');
    }
    assert.equal(Object.keys(db.calls.indexes).length, 7);
  });

  it('actualiza con collMod las colecciones existentes (idempotente)', async () => {
    const db = makeFakeDb([COLLECTIONS.USERS, COLLECTIONS.ORDERS]);
    const summary = await ensureCollections(db);

    assert.deepEqual(summary.updated.sort(), [COLLECTIONS.ORDERS, COLLECTIONS.USERS]);
    assert.equal(summary.created.length, 5);
    assert.ok(db.calls.collMod.every((cmd) => cmd.validator && cmd.validationLevel === 'strict'));
  });
});
