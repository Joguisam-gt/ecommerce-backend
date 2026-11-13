/**
 * Definicion de la coleccion audit_logs: validador $jsonSchema e indices.
 *
 * Es una coleccion de solo escritura (append-only): el repositorio no expone
 * operaciones de actualizacion ni borrado. Los indices cubren las consultas
 * tipicas de auditoria: por fecha, por actor, por entidad y por accion.
 *
 * Fase 3: las mutaciones del panel de administracion registran ademas el
 * contrato de cambio completo: role, targetCollection, targetId,
 * previousState, newState y timestamp (ver AuditService.recordChange).
 *
 * Fase 4 (extension retrocompatible, todos los campos nuevos son opcionales):
 * - snapshot: copia redactada del documento purgado (accion record.purged).
 * - AuditService escribe siempre timestamp (= createdAt) y targetCollection.
 * - ix_audit_collection_timestamp y ix_audit_timestamp sirven la consulta del
 *   superusuario (filtro por coleccion y/o rango de fechas, orden timestamp desc).
 *   El nombre ix_audit_target_timestamp ya lo usa el indice de la Fase 3
 *   (targetCollection + targetId + timestamp), por eso el nuevo lleva otro nombre.
 * - backfill: tras el collMod, las entradas antiguas sin timestamp reciben el
 *   valor de su createdAt (campo derivado e identico), para que el filtro y el
 *   orden por timestamp las incluyan. Es idempotente y no altera otros campos.
 */
import { COLLECTIONS } from '../collections.js';
import * as t from './schema-types.js';

export const AUDIT_OUTCOMES = Object.freeze(['success', 'failure']);

export const auditLogsCollection = Object.freeze({
  name: COLLECTIONS.AUDIT_LOGS,
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'audit_logs',
      additionalProperties: false,
      required: ['action', 'entity', 'outcome', 'createdAt'],
      properties: {
        _id: t.objectId,
        action: { bsonType: 'string', pattern: '^[a-z_]+\\.[a-z_]+$', maxLength: 80 },
        entity: t.string(1, 60),
        entityId: t.nullableString(64),
        outcome: t.enumOf(AUDIT_OUTCOMES),
        actorId: t.nullableObjectId,
        actorRole: t.nullableString(30),
        metadata: { bsonType: 'object' },
        ip: t.nullableString(64),
        userAgent: t.nullableString(512),
        createdAt: t.date,
        role: t.nullableString(30),
        targetCollection: t.nullableString(60),
        targetId: t.nullableString(64),
        previousState: { bsonType: ['object', 'null'] },
        newState: { bsonType: ['object', 'null'] },
        timestamp: t.nullableDate,
        snapshot: { bsonType: ['object', 'null'] },
      },
    },
  },
  indexes: [
    { key: { createdAt: -1 }, name: 'ix_audit_created' },
    { key: { actorId: 1, createdAt: -1 }, name: 'ix_audit_actor_created' },
    { key: { entity: 1, entityId: 1, createdAt: -1 }, name: 'ix_audit_entity_created' },
    { key: { action: 1, createdAt: -1 }, name: 'ix_audit_action_created' },
    {
      key: { targetCollection: 1, targetId: 1, timestamp: -1 },
      name: 'ix_audit_target_timestamp',
      partialFilterExpression: { targetCollection: { $type: 'string' } },
    },
    { key: { targetCollection: 1, timestamp: -1 }, name: 'ix_audit_collection_timestamp' },
    { key: { timestamp: -1 }, name: 'ix_audit_timestamp' },
  ],
  /**
   * Relleno idempotente posterior al collMod (ver setup.js): copia createdAt en
   * timestamp cuando falta o es null. Se ejecuta despues de actualizar el
   * validador para que un esquema anterior sin "timestamp" no lo rechace.
   * @param {import('mongodb').Db} db
   */
  backfill: (db) =>
    db
      .collection(COLLECTIONS.AUDIT_LOGS)
      .updateMany({ timestamp: null, createdAt: { $type: 'date' } }, [{ $set: { timestamp: '$createdAt' } }]),
});
