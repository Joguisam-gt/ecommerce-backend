/**
 * Definicion de la coleccion counters: secuencias atomicas para numeracion
 * correlativa (pedidos y facturas). Cada documento es { _id: nombre, seq }.
 * Se incrementa con $inc dentro de la transaccion de checkout, de modo que un
 * rollback tambien revierte el numero consumido (sin huecos en la numeracion fiscal).
 */
import { COLLECTIONS } from '../collections.js';
import * as t from './schema-types.js';

export const countersCollection = Object.freeze({
  name: COLLECTIONS.COUNTERS,
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'counters',
      additionalProperties: false,
      required: ['_id', 'seq'],
      properties: {
        _id: { bsonType: 'string', pattern: '^[a-z_]{2,40}$' },
        seq: t.nonNegativeInt,
      },
    },
  },
  indexes: [],
});
