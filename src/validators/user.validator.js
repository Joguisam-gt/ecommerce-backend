/**
 * Esquemas de validacion de la gestion de usuarios.
 *
 * Los cambios de rol y de estado tienen esquemas propios y endpoints
 * separados: asi cada operacion se protege con su permiso especifico y no se
 * puede escalar privilegios a traves de una actualizacion generica.
 */
import { ALL_ROLES } from '../constants/roles.js';
import { emailRule, nameRule, paginationFields, passwordRule, phoneRule } from './common.rules.js';

export const createUserSchema = Object.freeze({
  fields: {
    email: emailRule(true),
    password: passwordRule(true),
    firstName: nameRule(true),
    lastName: nameRule(true),
    phone: phoneRule(),
    role: { type: 'enum', required: true, values: ALL_ROLES },
  },
});

export const updateProfileSchema = Object.freeze({
  fields: {
    firstName: nameRule(false),
    lastName: nameRule(false),
    phone: phoneRule(),
  },
  minFields: 1,
});

export const updateUserSchema = Object.freeze({
  fields: {
    email: emailRule(false),
    firstName: nameRule(false),
    lastName: nameRule(false),
    phone: phoneRule(),
  },
  minFields: 1,
});

export const changeRoleSchema = Object.freeze({
  fields: {
    role: { type: 'enum', required: true, values: ALL_ROLES },
  },
});

export const changeStatusSchema = Object.freeze({
  fields: {
    isActive: { type: 'boolean', required: true },
  },
});

export const listUsersQuerySchema = Object.freeze({
  fields: {
    ...paginationFields(),
    role: { type: 'enum', values: ALL_ROLES },
    isActive: { type: 'boolean', fromString: true },
    search: { type: 'string', minLength: 1, maxLength: 100 },
  },
});
