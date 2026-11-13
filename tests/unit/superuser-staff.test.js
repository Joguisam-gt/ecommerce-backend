/**
 * Pruebas de StaffService (Fase 4): altas de personal, listado, regla
 * anti-bloqueo (SELF_LOCKOUT / LAST_SUPERUSER), centinela de gobierno contra
 * el write skew (reintento con recuento fresco) y auditoria dentro de la
 * misma transaccion.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { ROLES } from '../../src/constants/roles.js';
import { SUPERUSER_GOVERNANCE_LOCK } from '../../src/constants/superuser.js';
import { CreateUserDTO } from '../../src/dtos/user.dto.js';
import { AUDIT_ACTIONS } from '../../src/services/audit.service.js';
import { createStaffSchema, listStaffQuerySchema } from '../../src/validators/staff.validator.js';
import { validateSchema } from '../../src/validators/schema-validator.js';
import { actorOf, makeUser } from '../helpers/fixtures.js';
import { makeSuperuserHarness } from '../helpers/superuser-fakes.js';

/** DTO de alta de personal. */
const staffDto = (overrides = {}) =>
  CreateUserDTO.from({ email: 'nuevo.admin@example.com', password: 'Segura123', firstName: 'Nuevo', lastName: 'Admin', role: ROLES.ADMIN, ...overrides });

describe('StaffService', () => {
  let h;
  let rootA;
  let rootB;
  let admin;
  let customer;

  beforeEach(() => {
    rootA = makeUser({ role: ROLES.SUPERUSER, email: 'root.a@example.com' });
    rootB = makeUser({ role: ROLES.SUPERUSER, email: 'root.b@example.com' });
    admin = makeUser({ role: ROLES.ADMIN, email: 'admin@example.com' });
    customer = makeUser({ role: ROLES.USER, email: 'cliente@example.com' });
    h = makeSuperuserHarness({ users: [rootA, rootB, admin, customer] });
  });

  describe('createStaff', () => {
    it('crea un admin con hash bcrypt y lo audita en la misma transaccion', async () => {
      const user = await h.staffService.createStaff(actorOf(rootA), staffDto(), { ip: '10.0.0.1', userAgent: 'test' });

      assert.equal(user.role, ROLES.ADMIN);
      assert.equal(user.isActive, true);
      assert.equal(Object.hasOwn(user, 'password'), false);
      assert.match(user.passwordHash, /^\$2[aby]\$/);
      assert.notEqual(user.passwordHash, 'Segura123');

      const [entry] = h.auditLogRepository.entries;
      assert.equal(entry.action, AUDIT_ACTIONS.STAFF_CREATED);
      assert.equal(entry.targetCollection, 'users');
      assert.equal(entry.entityId, user._id.toString());
      assert.deepEqual(entry.metadata, { before: null, after: { email: user.email, role: ROLES.ADMIN, isActive: true } });
      assert.equal(entry.actorId.toString(), rootA._id.toString());
      assert.equal(entry.ip, '10.0.0.1');
      assert.ok(h.auditLogRepository.sessions[0], 'la auditoria debe ir dentro de la transaccion');
      assert.deepEqual(entry.timestamp, entry.createdAt);
    });

    it('crea superusuarios', async () => {
      const user = await h.staffService.createStaff(actorOf(rootA), staffDto({ email: 'otro.root@example.com', role: ROLES.SUPERUSER }));
      assert.equal(user.role, ROLES.SUPERUSER);
    });

    it('rechaza el rol user (solo personal) aunque se llame al servicio directamente', async () => {
      await assert.rejects(h.staffService.createStaff(actorOf(rootA), staffDto({ role: ROLES.USER })), {
        status: 400,
        code: 'ROLE_NOT_STAFF',
      });
    });

    it('409 EMAIL_IN_USE con un correo ya registrado', async () => {
      await assert.rejects(h.staffService.createStaff(actorOf(rootA), staffDto({ email: customer.email })), {
        status: 409,
        code: 'EMAIL_IN_USE',
      });
      assert.equal(h.auditLogRepository.entries.length, 0);
    });

    it('409 EMAIL_IN_USE si el indice unico detecta la carrera (E11000)', async () => {
      // Simula otra alta concurrente: findByEmail no lo ve, pero el insert choca con el indice.
      const original = h.userRepository.findByEmail.bind(h.userRepository);
      h.userRepository.findByEmail = async () => null;
      await assert.rejects(h.staffService.createStaff(actorOf(rootA), staffDto({ email: admin.email })), { code: 'EMAIL_IN_USE' });
      h.userRepository.findByEmail = original;
    });

    it('el validador solo admite roles de personal en el alta y en el filtro', () => {
      const body = { email: 'a@example.com', password: 'Segura123', firstName: 'A', lastName: 'B', role: ROLES.USER };
      assert.ok(validateSchema(createStaffSchema, body).some((error) => error.field === 'role'));
      assert.deepEqual(validateSchema(createStaffSchema, { ...body, role: ROLES.ADMIN }), []);
      assert.ok(validateSchema(listStaffQuerySchema, { role: ROLES.USER }).some((error) => error.field === 'role'));
    });
  });

  describe('listStaff', () => {
    it('solo devuelve admin y superuser, sin passwordHash', async () => {
      const result = await h.staffService.listStaff({ page: 1, limit: 20 });
      assert.equal(result.total, 3);
      assert.ok(result.items.every((user) => [ROLES.ADMIN, ROLES.SUPERUSER].includes(user.role)));
      assert.ok(result.items.every((user) => user.passwordHash === undefined));
    });

    it('filtra por rol', async () => {
      const result = await h.staffService.listStaff({ page: 1, limit: 20, role: ROLES.SUPERUSER });
      assert.equal(result.total, 2);
    });
  });

  describe('regla anti-bloqueo', () => {
    it('SELF_LOCKOUT: un superusuario no puede degradarse', async () => {
      await assert.rejects(h.staffService.changeRole(actorOf(rootA), rootA._id.toString(), ROLES.ADMIN), {
        status: 409,
        code: 'SELF_LOCKOUT',
      });
      assert.equal(h.userRepository.peek(rootA._id).role, ROLES.SUPERUSER);
      assert.equal(h.auditLogRepository.entries.length, 0);
      assert.equal(h.transactionRunner.stats.rolledBack, 1);
    });

    it('SELF_LOCKOUT: un superusuario no puede desactivarse', async () => {
      await assert.rejects(h.staffService.changeStatus(actorOf(rootA), rootA._id.toString(), false), { code: 'SELF_LOCKOUT' });
      assert.equal(h.userRepository.peek(rootA._id).isActive, true);
    });

    it('LAST_SUPERUSER: no se degrada al unico superusuario activo restante', async () => {
      // El actor fue degradado por otra peticion ya confirmada: B es el unico superusuario activo.
      h.userRepository.force(rootA._id, { role: ROLES.ADMIN });
      await assert.rejects(h.staffService.changeRole(actorOf(rootA), rootB._id.toString(), ROLES.ADMIN), {
        status: 409,
        code: 'LAST_SUPERUSER',
      });
      assert.equal(h.userRepository.peek(rootB._id).role, ROLES.SUPERUSER);
      assert.equal(h.auditLogRepository.entries.length, 0);
    });

    it('LAST_SUPERUSER: tampoco se desactiva', async () => {
      h.userRepository.force(rootA._id, { isActive: false });
      await assert.rejects(h.staffService.changeStatus(actorOf(rootA), rootB._id.toString(), false), { code: 'LAST_SUPERUSER' });
      assert.equal(h.userRepository.peek(rootB._id).isActive, true);
    });

    it('caso feliz: con otro superusuario activo se degrada, se revocan sus sesiones y se audita', async () => {
      const before = h.userRepository.peek(rootB._id).tokenVersion;
      const updated = await h.staffService.changeRole(actorOf(rootA), rootB._id.toString(), ROLES.ADMIN, { ip: '1.1.1.1' });

      assert.equal(updated.role, ROLES.ADMIN);
      assert.equal(h.userRepository.peek(rootB._id).tokenVersion, before + 1);
      assert.equal(h.sequenceRepository.peek(SUPERUSER_GOVERNANCE_LOCK), 1, 'centinela escrito');

      const [entry] = h.auditLogRepository.entries;
      assert.equal(entry.action, AUDIT_ACTIONS.STAFF_ROLE_CHANGED);
      assert.equal(entry.targetCollection, 'users');
      assert.equal(entry.entityId, rootB._id.toString());
      assert.deepEqual(entry.metadata.before, { email: rootB.email, role: ROLES.SUPERUSER, isActive: true });
      assert.deepEqual(entry.metadata.after, { email: rootB.email, role: ROLES.ADMIN, isActive: true });
      assert.equal(entry.metadata.sessionsRevoked, true);
      assert.ok(h.auditLogRepository.sessions[0]);
    });

    it('caso feliz: desactiva a otro superusuario si queda uno activo', async () => {
      const updated = await h.staffService.changeStatus(actorOf(rootA), rootB._id.toString(), false);
      assert.equal(updated.isActive, false);
      const [entry] = h.auditLogRepository.entries;
      assert.equal(entry.action, AUDIT_ACTIONS.STAFF_STATUS_CHANGED);
      assert.deepEqual(entry.metadata.after, { email: rootB.email, role: ROLES.SUPERUSER, isActive: false });
      assert.equal(entry.metadata.sessionsRevoked, true);
    });

    it('write skew: si la transaccion concurrente gana, el reintento recuenta y bloquea', async () => {
      // A degrada a B mientras B degrada a A. El conflicto en el centinela aborta la
      // transaccion de A; antes del reintento se aplica la de B (ya confirmada).
      h.transactionRunner.conflictsBeforeCommit = 1;
      h.transactionRunner.beforeRetry = () => h.userRepository.force(rootA._id, { role: ROLES.ADMIN });

      await assert.rejects(h.staffService.changeRole(actorOf(rootA), rootB._id.toString(), ROLES.ADMIN), { code: 'LAST_SUPERUSER' });

      assert.equal(h.transactionRunner.stats.retries, 1);
      assert.equal(h.userRepository.peek(rootB._id).role, ROLES.SUPERUSER, 'B sigue siendo superusuario');
      assert.equal(h.auditLogRepository.entries.length, 0, 'el intento abortado no deja auditoria');
      assert.equal(await h.userRepository.countActiveByRole(ROLES.SUPERUSER), 1);
    });

    it('un conflicto transitorio sin cambios concurrentes se reintenta y confirma una sola vez', async () => {
      h.transactionRunner.conflictsBeforeCommit = 2;
      await h.staffService.changeRole(actorOf(rootA), rootB._id.toString(), ROLES.ADMIN);
      assert.equal(h.transactionRunner.stats.retries, 2);
      assert.equal(h.auditLogRepository.entries.length, 1, 'sin auditoria duplicada');
      assert.equal(h.userRepository.peek(rootB._id).tokenVersion, rootB.tokenVersion + 1, 'sin doble incremento');
      assert.equal(h.sequenceRepository.peek(SUPERUSER_GOVERNANCE_LOCK), 1);
    });

    it('si la auditoria falla, el cambio se revierte (recordInTransaction propaga)', async () => {
      h.auditLogRepository.failOnCreate = true;
      await assert.rejects(h.staffService.changeRole(actorOf(rootA), rootB._id.toString(), ROLES.ADMIN), /fallo simulado/);
      assert.equal(h.userRepository.peek(rootB._id).role, ROLES.SUPERUSER);
    });

    it('promover o degradar cuentas que no son superusuario activo no exige recuento', async () => {
      const promoted = await h.staffService.changeRole(actorOf(rootA), customer._id.toString(), ROLES.ADMIN);
      assert.equal(promoted.role, ROLES.ADMIN);
      const inactiveRoot = makeUser({ role: ROLES.SUPERUSER, isActive: false });
      const harness = makeSuperuserHarness({ users: [rootA, inactiveRoot] });
      const demoted = await harness.staffService.changeRole(actorOf(rootA), inactiveRoot._id.toString(), ROLES.USER);
      assert.equal(demoted.role, ROLES.USER);
    });

    it('sin cambios (mismo rol o estado) no escribe ni audita', async () => {
      await h.staffService.changeRole(actorOf(rootA), admin._id.toString(), ROLES.ADMIN);
      await h.staffService.changeStatus(actorOf(rootA), admin._id.toString(), true);
      assert.equal(h.auditLogRepository.entries.length, 0);
      assert.equal(h.userRepository.peek(admin._id).tokenVersion, admin.tokenVersion);
    });

    it('404 USER_NOT_FOUND si la cuenta no existe', async () => {
      await assert.rejects(h.staffService.changeRole(actorOf(rootA), new ObjectId().toString(), ROLES.ADMIN), {
        status: 404,
        code: 'USER_NOT_FOUND',
      });
      await assert.rejects(h.staffService.changeStatus(actorOf(rootA), new ObjectId().toString(), false), { status: 404 });
    });

    it('rechaza roles o estados invalidos aunque se salte el validador', async () => {
      await assert.rejects(h.staffService.changeRole(actorOf(rootA), admin._id.toString(), 'root'), { code: 'INVALID_ROLE' });
      await assert.rejects(h.staffService.changeStatus(actorOf(rootA), admin._id.toString(), 'false'), { code: 'INVALID_STATUS' });
    });
  });
});
