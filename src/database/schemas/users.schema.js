/**
 * Definicion de la coleccion users: validador $jsonSchema e indices.
 *
 * El correo se normaliza a minusculas antes de guardar, por lo que un indice
 * unico simple basta para impedir duplicados sin distinguir mayusculas.
 */
import { COLLECTIONS } from '../collections.js';
import { ALL_ROLES } from '../../constants/roles.js';
import * as t from './schema-types.js';

export const usersCollection = Object.freeze({
  name: COLLECTIONS.USERS,
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'users',
      additionalProperties: false,
      required: [
        'email',
        'passwordHash',
        'firstName',
        'lastName',
        'role',
        'isActive',
        'tokenVersion',
        'failedLoginAttempts',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        _id: t.objectId,
        email: t.email,
        passwordHash: { bsonType: 'string', minLength: 60, maxLength: 60, description: 'Hash bcrypt' },
        firstName: t.string(1, 80),
        lastName: t.string(1, 80),
        phone: t.nullableString(20),
        role: t.enumOf(ALL_ROLES),
        isActive: t.bool,
        tokenVersion: t.nonNegativeInt,
        failedLoginAttempts: t.nonNegativeInt,
        lockUntil: t.nullableDate,
        lastLoginAt: t.nullableDate,
        ...t.timestamps,
      },
    },
  },
  indexes: [
    { key: { email: 1 }, name: 'uq_users_email', unique: true },
    { key: { role: 1, isActive: 1, createdAt: -1 }, name: 'ix_users_role_active_created' },
    { key: { createdAt: -1 }, name: 'ix_users_created' },
  ],
});
