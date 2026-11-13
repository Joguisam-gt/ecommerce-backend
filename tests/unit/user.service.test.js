/**
 * Pruebas de UserService: jerarquia RBAC, auto-proteccion, ultimo superusuario y auditoria.
 *
 * Cambios de rol/estado y borrado fisico pasan por la ruta transaccional de la
 * Fase 4 (StaffService y PurgeService reales con FakeTransactionRunner).
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { ROLES } from '../../src/constants/roles.js';
import { SUPERUSER_GOVERNANCE_LOCK } from '../../src/constants/superuser.js';
import { CreateUserDTO } from '../../src/dtos/user.dto.js';
import { AUDIT_ACTIONS, AuditService } from '../../src/services/audit.service.js';
import { PurgeService } from '../../src/services/purge.service.js';
import { StaffService } from '../../src/services/staff.service.js';
import { UserService } from '../../src/services/user.service.js';
import { silentLogger } from '../../src/utils/logger.js';
import { InMemorySequenceRepository } from '../helpers/checkout-fakes.js';
import { actorOf, makeDeps, makeUser } from '../helpers/fixtures.js';
import {
  FakeTransactionRunner,
  InMemoryFiscalReferenceRepository,
  InMemoryPurgeDatabase,
  InMemoryPurgeRepository,
  TransactionalAuditLogRepository,
} from '../helpers/superuser-fakes.js';

/**
 * Monta UserService con sus dependencias reales de las Fases 1 y 4 sobre dobles
 * en memoria. La "base de datos" de purga es independiente del repositorio de
 * usuarios (igual que en las pruebas de PurgeService).
 * @param {object[]} users
 */
function makeHarness(users) {
  const deps = makeDeps(users);
  const auditLogRepository = new TransactionalAuditLogRepository();
  const auditService = new AuditService({ auditLogRepository, logger: silentLogger });
  const sequenceRepository = new InMemorySequenceRepository();
  const purgeDatabase = new InMemoryPurgeDatabase();
  const transactionRunner = new FakeTransactionRunner([deps.userRepository, auditLogRepository, sequenceRepository, purgeDatabase]);
  const shared = { transactionRunner, auditService };
  const staffService = new StaffService({ ...deps, sequenceRepository, ...shared });
  const purgeService = new PurgeService({
    purgeRepository: new InMemoryPurgeRepository(purgeDatabase),
    fiscalReferenceRepository: new InMemoryFiscalReferenceRepository(purgeDatabase),
    ...shared,
  });
  const service = new UserService({ ...deps, auditService, staffService, purgeService });
  return { ...deps, auditLogRepository, auditService, sequenceRepository, purgeDatabase, transactionRunner, service };
}

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
    deps = makeHarness([superuser, admin, otherAdmin, customer]);
    service = deps.service;
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
      const { service: local } = makeHarness([superuser, second]);
      const updated = await local.changeRole(actorOf(superuser), second._id.toString(), ROLES.ADMIN);
      assert.equal(updated.role, ROLES.ADMIN);
    });

    it('no se puede degradar ni desactivar al ultimo superusuario activo', async () => {
      // El actor es un superusuario inactivo: el objetivo queda como unico superusuario activo.
      const inactiveSuper = makeUser({ role: ROLES.SUPERUSER, isActive: false });
      const { service: local } = makeHarness([superuser, inactiveSuper]);
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

  describe('ruta transaccional anti-bloqueo (StaffService)', () => {
    it('changeRole escribe el centinela y audita en la misma transaccion', async () => {
      const second = makeUser({ role: ROLES.SUPERUSER });
      const h = makeHarness([superuser, second]);
      await h.service.changeRole(actorOf(superuser), second._id.toString(), ROLES.ADMIN);

      assert.equal(h.sequenceRepository.peek(SUPERUSER_GOVERNANCE_LOCK), 1, 'centinela escrito');
      assert.equal(h.transactionRunner.stats.committed, 1);
      const [entry] = h.auditLogRepository.entries;
      assert.equal(entry.action, AUDIT_ACTIONS.USER_ROLE_CHANGED);
      assert.deepEqual(entry.metadata.before.role, ROLES.SUPERUSER);
      assert.deepEqual(entry.metadata.after.role, ROLES.ADMIN);
      assert.ok(h.auditLogRepository.sessions[0], 'auditoria dentro de la transaccion');
    });

    it('changeStatus de un admin sobre un cliente tambien pasa por la transaccion', async () => {
      await service.changeStatus(actorOf(admin), customer._id.toString(), false);
      assert.equal(deps.sequenceRepository.peek(SUPERUSER_GOVERNANCE_LOCK), 1);
      assert.deepEqual(deps.auditLogRepository.actions(), [AUDIT_ACTIONS.USER_STATUS_CHANGED]);
      assert.ok(deps.auditLogRepository.sessions[0]);
    });

    it('write skew: dos superusuarios degradandose a la vez no dejan el sistema sin ninguno', async () => {
      // A degrada a B mientras B degrada a A. El conflicto en el centinela aborta
      // la transaccion de A; antes del reintento se confirma la de B.
      const rootA = makeUser({ role: ROLES.SUPERUSER });
      const rootB = makeUser({ role: ROLES.SUPERUSER });
      const h = makeHarness([rootA, rootB]);
      h.transactionRunner.conflictsBeforeCommit = 1;
      h.transactionRunner.beforeRetry = () => {
        h.userRepository.peek(rootA._id).role = ROLES.ADMIN;
      };

      await assert.rejects(h.service.changeRole(actorOf(rootA), rootB._id.toString(), ROLES.ADMIN), {
        status: 409,
        code: 'LAST_SUPERUSER',
      });
      assert.equal(h.transactionRunner.stats.retries, 1);
      assert.equal(h.userRepository.peek(rootB._id).role, ROLES.SUPERUSER, 'B sigue siendo superusuario');
      assert.equal(await h.userRepository.countActiveByRole(ROLES.SUPERUSER), 1);
      assert.equal(h.auditLogRepository.entries.length, 0, 'el intento abortado no deja auditoria');
    });

    it('write skew en changeStatus: el reintento recuenta y bloquea la desactivacion', async () => {
      const rootA = makeUser({ role: ROLES.SUPERUSER });
      const rootB = makeUser({ role: ROLES.SUPERUSER });
      const h = makeHarness([rootA, rootB]);
      h.transactionRunner.conflictsBeforeCommit = 1;
      h.transactionRunner.beforeRetry = () => {
        h.userRepository.peek(rootA._id).isActive = false;
      };

      await assert.rejects(h.service.changeStatus(actorOf(rootA), rootB._id.toString(), false), { code: 'LAST_SUPERUSER' });
      assert.equal(h.userRepository.peek(rootB._id).isActive, true);
    });

    it('las reglas de jerarquia se evaluan sobre la lectura fresca dentro de la transaccion', async () => {
      // El cliente es promovido a admin justo antes de que la transaccion del admin lo lea.
      deps.transactionRunner.conflictsBeforeCommit = 1;
      deps.transactionRunner.beforeRetry = () => {
        deps.userRepository.peek(customer._id).role = ROLES.ADMIN;
      };
      await assert.rejects(service.changeStatus(actorOf(admin), customer._id.toString(), false), {
        status: 403,
        code: 'INSUFFICIENT_RANK',
      });
      assert.equal(deps.userRepository.peek(customer._id).isActive, true);
    });

    it('si la auditoria falla, el cambio de rol se revierte', async () => {
      deps.auditLogRepository.failOnCreate = true;
      await assert.rejects(service.changeRole(actorOf(superuser), customer._id.toString(), ROLES.ADMIN), /fallo simulado/);
      assert.equal(deps.userRepository.peek(customer._id).role, ROLES.USER);
    });
  });

  describe('deleteUser (borrado fisico via PurgeService)', () => {
    it('admin no puede borrar fisicamente aunque llame al servicio directamente', async () => {
      deps.purgeDatabase.insert('users', { ...customer, isActive: false });
      await assert.rejects(service.deleteUser(actorOf(admin), customer._id.toString()), {
        status: 403,
        code: 'HARD_DELETE_FORBIDDEN',
      });
      assert.ok(deps.purgeDatabase.find('users', customer._id));
    });

    it('400 NOT_SOFT_DELETED si la cuenta sigue activa', async () => {
      deps.purgeDatabase.insert('users', customer);
      await assert.rejects(service.deleteUser(actorOf(superuser), customer._id.toString()), {
        status: 400,
        code: 'NOT_SOFT_DELETED',
      });
      assert.ok(deps.purgeDatabase.find('users', customer._id));
    });

    it('409 FISCAL_INTEGRITY_LOCK si la cuenta tiene facturas', async () => {
      deps.purgeDatabase
        .insert('users', { ...customer, isActive: false })
        .insert('invoices', { _id: new ObjectId(), userId: customer._id, entityType: 'cliente', items: [] });
      await assert.rejects(service.deleteUser(actorOf(superuser), customer._id.toString()), {
        status: 409,
        code: 'FISCAL_INTEGRITY_LOCK',
      });
      assert.ok(deps.purgeDatabase.find('users', customer._id));
    });

    it('superuser purga una cuenta desactivada: cascada de carrito y snapshot en auditoria', async () => {
      deps.purgeDatabase
        .insert('users', { ...customer, isActive: false })
        .insert('carts', { _id: new ObjectId(), userId: customer._id, items: [] });
      const result = await service.deleteUser(actorOf(superuser), customer._id.toString());

      assert.equal(result.purged, true);
      assert.equal(deps.purgeDatabase.find('users', customer._id), null);
      assert.equal(deps.purgeDatabase.collections.carts.length, 0);
      const entry = deps.auditLogRepository.entries.at(-1);
      assert.equal(entry.action, AUDIT_ACTIONS.RECORD_PURGED);
      assert.equal(entry.snapshot.email, customer.email);
      assert.equal(Object.hasOwn(entry.snapshot, 'passwordHash'), false);
      assert.equal(entry.metadata.cascade.cartsDeleted, 1);
    });

    it('404 USER_NOT_FOUND si no existe (codigo de la Fase 1)', async () => {
      await assert.rejects(service.deleteUser(actorOf(superuser), new ObjectId().toString()), {
        status: 404,
        code: 'USER_NOT_FOUND',
      });
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
