/**
 * Pruebas del motor de validacion, de los esquemas de entrada y de los DTOs.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RegisterUserDTO } from '../../src/dtos/auth.dto.js';
import { ListUsersQueryDTO, UpdateProfileDTO, UserResponseDTO } from '../../src/dtos/user.dto.js';
import { changePasswordSchema, registerSchema } from '../../src/validators/auth.validator.js';
import { passwordPolicy } from '../../src/validators/common.rules.js';
import { validateSchema } from '../../src/validators/schema-validator.js';
import { listUsersQuerySchema, updateProfileSchema } from '../../src/validators/user.validator.js';
import { makeUser } from '../helpers/fixtures.js';

const validRegister = {
  email: 'Cliente@Example.com',
  password: 'Segura123',
  firstName: 'Jose',
  lastName: 'Rodriguez',
};

/** Devuelve los campos con error. */
const fieldsOf = (errors) => errors.map((error) => error.field);

describe('validateSchema', () => {
  it('acepta un registro valido', () => {
    assert.deepEqual(validateSchema(registerSchema, validRegister), []);
  });

  it('rechaza campos no declarados (evita asignacion masiva de role)', () => {
    const errors = validateSchema(registerSchema, { ...validRegister, role: 'superuser' });
    assert.deepEqual(fieldsOf(errors), ['role']);
  });

  it('rechaza operadores NoSQL en lugar de texto', () => {
    const errors = validateSchema(registerSchema, { ...validRegister, email: { $ne: null } });
    assert.deepEqual(fieldsOf(errors), ['email']);
  });

  it('marca obligatorios ausentes o vacios', () => {
    const errors = validateSchema(registerSchema, { email: '  ', password: 'Segura123' });
    assert.deepEqual(fieldsOf(errors).sort(), ['email', 'firstName', 'lastName']);
  });

  it('rechaza entradas que no son objetos', () => {
    assert.deepEqual(fieldsOf(validateSchema(registerSchema, [])), ['_root']);
    assert.deepEqual(fieldsOf(validateSchema(registerSchema, null)), ['_root']);
  });

  it('exige al menos un campo en actualizaciones parciales', () => {
    assert.deepEqual(fieldsOf(validateSchema(updateProfileSchema, {})), ['_root']);
    assert.deepEqual(validateSchema(updateProfileSchema, { phone: null }), []);
  });

  it('valida query strings convirtiendo tipos', () => {
    assert.deepEqual(validateSchema(listUsersQuerySchema, { page: '2', limit: '10', isActive: 'true' }), []);
    assert.deepEqual(fieldsOf(validateSchema(listUsersQuerySchema, { limit: '1000' })), ['limit']);
    assert.deepEqual(fieldsOf(validateSchema(listUsersQuerySchema, { role: 'root' })), ['role']);
  });

  it('aplica reglas entre campos (refine)', () => {
    const errors = validateSchema(changePasswordSchema, { currentPassword: 'Segura123', newPassword: 'Segura123' });
    assert.deepEqual(fieldsOf(errors), ['newPassword']);
  });
});

describe('passwordPolicy', () => {
  it('acepta contrasenas robustas', () => {
    assert.equal(passwordPolicy('Segura123'), null);
  });

  it('rechaza contrasenas debiles', () => {
    for (const weak of ['corta1A', 'sinmayuscula1', 'SINMINUSCULA1', 'SinNumeros']) {
      assert.ok(passwordPolicy(weak), weak);
    }
  });

  it('rechaza mas de 72 bytes (limite de bcrypt)', () => {
    assert.match(passwordPolicy(`Aa1${'x'.repeat(70)}`), /72 bytes/);
  });
});

describe('DTOs', () => {
  it('RegisterUserDTO normaliza y congela', () => {
    const dto = RegisterUserDTO.from({ ...validRegister, firstName: '  Jose   Guillermo ' });
    assert.equal(dto.email, 'cliente@example.com');
    assert.equal(dto.firstName, 'Jose Guillermo');
    assert.equal(dto.phone, null);
    assert.ok(Object.isFrozen(dto));
  });

  it('UserResponseDTO nunca expone datos sensibles', () => {
    const output = UserResponseDTO.from(makeUser({ lockUntil: new Date() }));
    for (const secret of ['passwordHash', 'tokenVersion', 'failedLoginAttempts', 'lockUntil', '_id']) {
      assert.equal(Object.hasOwn(output, secret), false, secret);
    }
    assert.equal(typeof output.id, 'string');
  });

  it('withPermissions incluye los permisos efectivos', () => {
    const output = UserResponseDTO.withPermissions(makeUser());
    assert.ok(output.permissions.includes('cart:manage'));
  });

  it('UpdateProfileDTO solo incluye los campos enviados', () => {
    assert.deepEqual(UpdateProfileDTO.from({ lastName: ' Lopez ' }), { lastName: 'Lopez' });
  });

  it('ListUsersQueryDTO aplica valores por defecto', () => {
    assert.deepEqual(ListUsersQueryDTO.from({}), {
      page: 1,
      limit: 20,
      role: undefined,
      isActive: undefined,
      search: undefined,
    });
    assert.equal(ListUsersQueryDTO.from({ isActive: 'false' }).isActive, false);
  });
});
