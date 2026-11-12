/**
 * Sincronizacion idempotente del esquema de base de datos.
 *
 * Para cada definicion: crea la coleccion con su validador si no existe, o
 * actualiza el validador con collMod si ya existe; despues crea los indices
 * (createIndexes no hace nada si el indice ya existe con la misma definicion).
 * Puede ejecutarse en cada arranque o con el script npm run db:init.
 */
import { COLLECTION_DEFINITIONS } from './schemas/index.js';

/** Opciones de validacion comunes: rechazar cualquier documento invalido. */
const VALIDATION_OPTIONS = Object.freeze({ validationLevel: 'strict', validationAction: 'error' });

/**
 * Crea o actualiza colecciones, validadores e indices.
 * @param {import('mongodb').Db} db
 * @param {ReadonlyArray<{ name: string, validator: object, indexes: object[] }>} [definitions]
 * @param {{ info: Function }} [logger]
 * @returns {Promise<{ created: string[], updated: string[] }>} Resumen de lo realizado.
 */
export async function ensureCollections(db, definitions = COLLECTION_DEFINITIONS, logger = undefined) {
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((collection) => collection.name),
  );
  const summary = { created: [], updated: [] };

  for (const definition of definitions) {
    const options = { validator: definition.validator, ...VALIDATION_OPTIONS };

    if (existing.has(definition.name)) {
      await db.command({ collMod: definition.name, ...options });
      summary.updated.push(definition.name);
    } else {
      await db.createCollection(definition.name, options);
      summary.created.push(definition.name);
    }

    if (definition.indexes.length > 0) {
      await db.collection(definition.name).createIndexes(definition.indexes);
    }
  }

  logger?.info('Esquema de base de datos sincronizado', summary);
  return summary;
}
