/**
 * Pruebas de UserService: jerarquia RBAC, auto-proteccion, ultimo superusuario y auditoria.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ROLES } from '../../src/constants/roles.js';
import { CreateUserDTO } from '../../src/dtos/user.dto.js';
import { AUDIT_ACTIONS } from '../../src/services/audit.service.js';
import { UserService } from '../../src/services/user.service.js';
import { actorOf, makeDeps, makeUser } from '../helpers/fixtures.js';

describe('UserService', () => {
  let deps;
  let service;
  let superuser;
  let admin;
  let otherAdmin;
  let customer;

  beforeEach(() => {
    superuser = makeUser({ role: ROLES.SUPERUSER });
    admin = makeUser({ role: ROLES.ADMIN });
    otherAdmin = makeUser({ role: ROLES.ADMIN });
    customer = makeUser({ role: ROLES.USER });
    deps = makeDeps([superuser, admin, otherAdmin, customer]);
    service = new UserService(deps);
  });

  /** DTO de alta con el rol indicado. */
  const newUser = (role) =>
    CreateUserDTO.from({ email: `nuevo-${role}@example.com`, password: 'Segura123', firstName: 'N', lastName: 'U', role });

  describe('createUser', () => {
    it('admin crea clientes', async () => {
      const user = await service.createUser(actorOf(admin), newUser(ROLES.USER));
      assert.equal(user.role, ROLES.USER);
      assert.equal(user.isActive, true);
      assert.equal(Object.hasOwn(user, 'password'), false);
      assert.deepEqual(deps.auditLogRepository.actions(), [AUDIT_ACTIONS.USER_CREATED]);
    });

    it('admin no puede crear administradores ni superusuarios', async () => {
      await assert.rejects(service.createUser(actorOf(admin), newUser(ROLES.ADMIN)), { status: 403, code: 'ROLE_NOT_ASSIGNABLE' });
      await assert.rejects(service.createUser(actorOf(admin), newUser(ROLES.SUPERUSER)), { status: 403 });
    });

    it('superuser crea administradores', async () => {
      const user = await service.createUser(actorOf(superuser), newUser(ROLES.ADMIN));
      assert.equal(user.role, ROLES.ADMIN);
    });

    it('rechaza correos duplicados', async () => {
      const dto = CreateUserDTO.from({ email: customer.email, password: 'Segura123', firstName: 'A', lastName: 'B', role: ROLES.USER });
      await assert.rejects(service.createUser(actorOf(superuser), dto), { status: 409 });
    });
  });

  describe('updateUser', () => {
    it('admin actualiza clientes', async () => {
      const updated = await service.updateUser(actorOf(admin), customer._id.toString(), { firstName: 'Maria' });
      assert.equal(updated.firstName, 'Maria');
    });

    it('admin no puede modificar a otro admin', async () => {
      await assert.rejects(service.updateUser(actorOf(admin), otherAdmin._id.toString(), { firstName: 'X' }), {
        status: 403,
        code: 'INSUFFICIENT_RANK',
      });
    });

    it('no permite usar un correo ya registrado', async () => {
      await assert.rejects(service.updateUser(actorOf(superuser), customer._id.toString(), { email: admin.email }), { status: 409 });
    });

    it('devuelve 404 si no existe y 400 con id invalido', async () => {
      await assert.rejects(service.updateUser(actorOf(superuser), '0'.repeat(24), { firstName: 'X' }), { status: 404 });
      await assert.rejects(service.updateUser(actorOf(superuser), 'no-es-un-id', { firstName: 'X' }), { status: 400 });
    });
  });

  describe('changeRole', () => {
    it('superuser promueve a admin y se revocan las sesiones del afectado', async () => {
      const before = customer.tokenVersion;
      const updated = await service.changeRole(actorOf(superuser), customer._id.toString(), ROLES.ADMIN);
      assert.equal(updated.role, ROLES.ADMIN);
      assert.equal(updated.tokenVersion, before + 1);
      assert.ok(deps.auditLogRepository.actions().includes(AUDIT_ACTIONS.USER_ROLE_CHANGED));
    });

    it('nadie cambia su propio rol', async () => {
      await assert.rejects(service.changeRole(actorOf(superuser), superuser._id.toString(), ROLES.USER), {
        code: 'SELF_MODIFICATION_FORBIDDEN',
      });
    });

    it('con dos superusuarios activos se puede degradar a uno', async () => {
      const second = makeUser({ role: ROLES.SUPERUSER });
      const local = new UserService(makeDeps([superuser, second]));
      const updated = await local.changeRole(actorOf(superuser), second._id.toString(), ROLES.ADMIN);
      assert.equal(updated.role, ROLES.ADMIN);
    });

    it('no se puede degradar ni desactivar al ultimo superusuario activo', async () => {
      // El actor es un superusuario inactivo: el objetivo queda como unico superusuario activo.
      const inactiveSuper = makeUser({ role: ROLES.SUPERUSER, isActive: false });
      const local = new UserService(makeDeps([superuser, inactiveSuper]));
      const target = superuser._id.toString();

      await assert.rejects(local.changeRole(actorOf(inactiveSuper), target, ROLES.ADMIN), { status: 409, code: 'LAST_SUPERUSER' });
      await assert.rejects(local.changeStatus(actorOf(inactiveSuper), target, false), { code: 'LAST_SUPERUSER' });
    });
  });

  describe('changeStatus (borrado logico)', () => {
    it('admin desactiva clientes y se revocan sus sesiones', async () => {
      const updated = await service.changeStatus(actorOf(admin), customer._id.toString(), false);
      assert.equal(updated.isActive, false);
      assert.equal(updated.tokenVersion, customer.tokenVersion + 1);
    });

    it('admin no puede desactivar a otro admin ni a si mismo', async () => {
      await assert.rejects(service.changeStatus(actorOf(admin), otherAdmin._id.toString(), false), { status: 403 });
      await assert.rejects(service.changeStatus(actorOf(admin), admin._id.toString(), false), {
        code: 'SELF_MODIFICATION_FORBIDDEN',
      });
    });

    it('es idempotente si el estado no cambia', async () => {
      await service.changeStatus(actorOf(admin), customer._id.toString(), true);
      assert.deepEqual(deps.auditLogRepository.actions(), []);
    });
  });

  describe('deleteUser (borrado fisico)', () => {
    it('admin no puede borrar fisicamente aunque llame al servicio directamente', async () => {
      await assert.rejects(service.deleteUser(actorOf(admin), customer._id.toString()), {
        status: 403,
        code: 'HARD_DELETE_FORBIDDEN',
      });
      assert.ok(await deps.userRepository.findById(customer._id));
    });

    it('superuser borra y deja constancia en auditoria', async () => {
      await service.deleteUser(actorOf(superuser), customer._id.toString());
      assert.equal(await deps.userRepository.findById(customer._id), null);
      const entry = deps.auditLogRepository.entries.at(-1);
      assert.equal(entry.action, AUDIT_ACTIONS.USER_DELETED);
      assert.equal(entry.metadata.email, customer.email);
    });

    it('superuser no puede borrarse a si mismo', async () => {
      await assert.rejects(service.deleteUser(actorOf(superuser), superuser._id.toString()), {
        code: 'SELF_MODIFICATION_FORBIDDEN',
      });
    });
  });

  it('listUsers pagina y filtra', async () => {
    const result = await service.listUsers({ page: 1, limit: 2, role: ROLES.ADMIN });
    assert.equal(result.total, 2);
    assert.equal(result.items.length, 2);
    assert.ok(result.items.every((user) => !Object.hasOwn(user, 'passwordHash')));
  });

  it('updateProfile actualiza solo los campos enviados', async () => {
    const updated = await service.updateProfile(actorOf(customer), { phone: '+57 300 1234567' });
    assert.equal(updated.phone, '+57 300 1234567');
    assert.equal(updated.firstName, customer.firstName);
  });
});
