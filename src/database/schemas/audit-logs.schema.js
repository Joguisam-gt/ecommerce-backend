/**
 * Definicion de la coleccion audit_logs: validador $jsonSchema e indices.
 *
 * Es una coleccion de solo escritura (append-only): el repositorio no expone
 * operaciones de actualizacion ni borrado. Los indices cubren las consultas
 * tipicas de auditoria: por fecha, por actor, por entidad y por accion.
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
      },
    },
  },
  indexes: [
    { key: { createdAt: -1 }, name: 'ix_audit_created' },
    { key: { actorId: 1, createdAt: -1 }, name: 'ix_audit_actor_created' },
    { key: { entity: 1, entityId: 1, createdAt: -1 }, name: 'ix_audit_entity_created' },
    { key: { action: 1, createdAt: -1 }, name: 'ix_audit_action_created' },
  ],
});
