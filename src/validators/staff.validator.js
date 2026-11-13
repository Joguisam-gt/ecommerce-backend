/**
 * Esquemas de validacion de la gestion de personal (Fase 4, /api/superuser/staff).
 *
 * Reutilizan las reglas de user.validator.js; la diferencia es que el alta y
 * el filtro de listado solo admiten roles de personal (admin o superuser).
 * El cambio de rol admite cualquier rol de ALL_ROLES (por ejemplo, degradar a user).
 */
import { STAFF_ROLES } from '../constants/superuser.js';
import { idParamSchema, paginationFields } from './common.rules.js';
import { changeRoleSchema, changeStatusSchema, createUserSchema } from './user.validator.js';

export const createStaffSchema = Object.freeze({
  fields: {
    ...createUserSchema.fields,
    role: { type: 'enum', required: true, values: STAFF_ROLES },
  },
});

export const listStaffQuerySchema = Object.freeze({
  fields: {
    ...paginationFields(),
    role: { type: 'enum', values: STAFF_ROLES },
    isActive: { type: 'boolean', fromString: true },
    search: { type: 'string', minLength: 1, maxLength: 100 },
  },
});

/** PATCH /:id/role { role } con cualquier rol valido. */
export const changeStaffRoleSchema = changeRoleSchema;

/** PATCH /:id/status { isActive: boolean }. */
export const changeStaffStatusSchema = changeStatusSchema;

export { idParamSchema };
