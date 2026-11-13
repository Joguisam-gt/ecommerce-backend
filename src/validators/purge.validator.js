/**
 * Esquema de validacion de la purga (Fase 4, DELETE /api/superuser/purge/:collection/:id).
 *
 * :collection debe pertenecer a la lista blanca centralizada
 * (constants/superuser.js); cualquier otra coleccion responde 400 antes de
 * llegar al servicio. :id debe ser un ObjectId en hexadecimal.
 */
import { ALL_PURGEABLE_COLLECTIONS } from '../constants/superuser.js';

export const purgeParamsSchema = Object.freeze({
  fields: {
    collection: { type: 'enum', required: true, values: ALL_PURGEABLE_COLLECTIONS },
    id: { type: 'objectId', required: true },
  },
});
