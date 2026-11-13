/**
 * Pruebas de la auditoria de la Fase 4: validador y DTO de la consulta del
 * superusuario, filtro del repositorio, AuditService (timestamp,
 * targetCollection, recordInTransaction, search, compatibilidad de
 * recordChange) y garantia de que el repositorio no actualiza ni borra.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { ROLES } from '../../src/constants/roles.js';
import { SuperuserAuditLogQueryDTO, SuperuserAuditLogResponseDTO } from '../../src/dtos/superuser-audit-log.dto.js';
import { AUDIT_SEARCH_SORT, AuditLogRepository, buildAuditSearchFilter } from '../../src/repositories/audit-log.repository.js';
import { AUDIT_ACTIONS, AuditService, targetCollectionOf } from '../../src/services/audit.service.js';
import { silentLogger } from '../../src/utils/logger.js';
import { validateSchema } from '../../src/validators/schema-validator.js';
import { superuserAuditLogsQuerySchema } from '../../src/validators/superuser-audit-log.validator.js';
import { NOW, TransactionalAuditLogRepository } from '../helpers/superuser-fakes.js';

/** Campos con error de una validacion. */
const fieldsOf = (query) => validateSchema(superuserAuditLogsQuerySchema, query).map((error) => error.field);

/** Actor de prueba. */
const actor = Object.freeze({ id: new ObjectId().toString(), role: ROLES.SUPERUSER });

describe('superuserAuditLogsQuerySchema', () => {
  it('acepta todos los filtros validos (valores de query string)', () => {
    assert.deepEqual(
      fieldsOf({
        page: '2',
        limit: '100',
        actorId: new ObjectId().toString(),
        role: 'admin',
        action: 'record.purged',
        targetCollection: 'users',
        startDate: '2026-01-01',
        endDate: '2026-01-31T23:59:59Z',
      }),
      [],
    );
  });

  it('limita la paginacion (limit maximo 100) y valida cada filtro', () => {
    assert.deepEqual(fieldsOf({ limit: '101' }), ['limit']);
    assert.deepEqual(fieldsOf({ page: '0' }), ['page']);
    assert.deepEqual(fieldsOf({ actorId: 'abc' }), ['actorId']);
    assert.deepEqual(fieldsOf({ role: 'root' }), ['role']);
    assert.deepEqual(fieldsOf({ action: 'DROP TABLE' }), ['action']);
    assert.deepEqual(fieldsOf({ targetCollection: 'secret_collection' }), ['targetCollection']);
    assert.deepEqual(fieldsOf({ entity: 'user' }), ['entity']);
  });

  it('exige ISO 8601 y fechas reales', () => {
    assert.deepEqual(fieldsOf({ startDate: '31/01/2026' }), ['startDate']);
    assert.deepEqual(fieldsOf({ startDate: 'March 1, 2026' }), ['startDate']);
    assert.deepEqual(fieldsOf({ endDate: '2026-02-30' }), ['endDate']);
  });

  it('400 si startDate es posterior a endDate; el mismo dia es valido', () => {
    assert.deepEqual(fieldsOf({ startDate: '2026-02-01', endDate: '2026-01-31' }), ['startDate']);
    assert.deepEqual(fieldsOf({ startDate: '2026-01-31T10:00:00Z', endDate: '2026-01-31' }), []);
  });
});

describe('SuperuserAuditLogQueryDTO y filtro del repositorio', () => {
  it('convierte role en actorRole, aplica valores por defecto y amplia el dia final', () => {
    const dto = SuperuserAuditLogQueryDTO.from({ role: 'admin', startDate: '2026-01-01', endDate: '2026-01-31' });
    assert.equal(dto.page, 1);
    assert.equal(dto.limit, 20);
    assert.equal(dto.actorRole, 'admin');
    assert.deepEqual(dto.startDate, new Date('2026-01-01T00:00:00.000Z'));
    assert.deepEqual(dto.endDate, new Date('2026-01-31T23:59:59.999Z'));
  });

  it('buildAuditSearchFilter filtra sobre timestamp y actorRole', () => {
    const actorId = new ObjectId();
    const startDate = new Date('2026-01-01T00:00:00Z');
    const endDate = new Date('2026-01-31T00:00:00Z');
    assert.deepEqual(
      buildAuditSearchFilter({ actorId, actorRole: 'superuser', action: 'record.purged', targetCollection: 'users', startDate, endDate, page: 1 }),
      { actorId, actorRole: 'superuser', action: 'record.purged', targetCollection: 'users', timestamp: { $gte: startDate, $lte: endDate } },
    );
    assert.deepEqual(buildAuditSearchFilter({}), {});
    assert.deepEqual(AUDIT_SEARCH_SORT, { timestamp: -1, _id: -1 });
  });
});

describe('AuditLogRepository (append-only)', () => {
  it('el codigo fuente no contiene operaciones de actualizacion ni borrado', () => {
    const source = readFileSync(new URL('../../src/repositories/audit-log.repository.js', import.meta.url), 'utf8');
    const forbidden = /\.(updateOne|updateMany|deleteOne|deleteMany|findOneAndUpdate|findOneAndDelete|findOneAndReplace|replaceOne|bulkWrite|drop|remove)\s*\(/;
    assert.equal(forbidden.test(source), false);
  });

  it('solo expone create, list y search', () => {
    const methods = Object.getOwnPropertyNames(AuditLogRepository.prototype).filter((name) => name !== 'constructor');
    assert.deepEqual(methods.sort(), ['create', 'list', 'search']);
  });

  it('create propaga la sesion y search ordena por timestamp y _id', async () => {
    const calls = [];
    const cursor = {
      sort(sort) {
        calls.push({ sort });
        return this;
      },
      skip(skip) {
        calls.push({ skip });
        return this;
      },
      limit(limit) {
        calls.push({ limit });
        return this;
      },
      toArray: async () => [],
    };
    const db = {
      collection: () => ({
        insertOne: async (doc, options) => {
          calls.push({ insertOptions: options });
          return { insertedId: new ObjectId() };
        },
        find: (filter) => {
          calls.push({ filter });
          return cursor;
        },
        countDocuments: async () => 0,
      }),
    };
    const repository = new AuditLogRepository(db);
    const session = { id: 's' };
    await repository.create({ action: 'record.purged' }, { session });
    await repository.search({ page: 3, limit: 10, targetCollection: 'users' });

    assert.deepEqual(calls[0], { insertOptions: { session } });
    assert.deepEqual(calls[1], { filter: { targetCollection: 'users' } });
    assert.deepEqual(calls[2], { sort: { timestamp: -1, _id: -1 } });
    assert.deepEqual(calls[3], { skip: 20 });
    assert.deepEqual(calls[4], { limit: 10 });
  });
});

describe('AuditService (Fase 4)', () => {
  /** Servicio con repositorio en memoria y reloj fijo. */
  const makeService = () => {
    const repository = new TransactionalAuditLogRepository();
    return { repository, service: new AuditService({ auditLogRepository: repository, logger: silentLogger, clock: () => NOW }) };
  };

  it('record escribe siempre timestamp (= createdAt) y deriva targetCollection de entity', async () => {
    const { repository, service } = makeService();
    await service.record({ action: AUDIT_ACTIONS.AUTH_LOGIN, entity: 'user', entityId: 'x', actor });
    await service.record({ action: AUDIT_ACTIONS.PAYMENT_DECLINED, entity: 'payment', outcome: 'failure' });
    await service.record({ action: 'misc.event', entity: 'desconocida' });
    await service.record({ action: 'misc.event', entity: 'user', targetCollection: 'carts' });

    const [login, payment, unknown, explicit] = repository.entries;
    assert.deepEqual(login.timestamp, NOW);
    assert.deepEqual(login.createdAt, NOW);
    assert.equal(login.targetCollection, 'users');
    assert.equal(payment.targetCollection, 'orders');
    assert.equal(unknown.targetCollection, null);
    assert.equal(explicit.targetCollection, 'carts');
    assert.equal(Object.hasOwn(login, 'snapshot'), false, 'snapshot solo cuando se indica');
    assert.equal(repository.sessions[0], null, 'record no usa sesion');
  });

  it('targetCollectionOf acepta nombres de coleccion y devuelve null para valores desconocidos', () => {
    assert.equal(targetCollectionOf('suppliers'), 'suppliers');
    assert.equal(targetCollectionOf('settings'), 'system_settings');
    assert.equal(targetCollectionOf('__proto__'), null);
    assert.equal(targetCollectionOf(undefined), null);
  });

  it('record nunca lanza; recordInTransaction propaga el error y exige la sesion', async () => {
    const { repository, service } = makeService();
    repository.failOnCreate = true;
    await service.record({ action: AUDIT_ACTIONS.AUTH_LOGIN, entity: 'user' });
    await assert.rejects(service.recordInTransaction({ action: AUDIT_ACTIONS.RECORD_PURGED, entity: 'users' }, { id: 's' }), /fallo simulado/);
    repository.failOnCreate = false;
    await assert.rejects(service.recordInTransaction({ action: AUDIT_ACTIONS.RECORD_PURGED, entity: 'users' }), /sesion/);
  });

  it('recordInTransaction inserta con la sesion y devuelve la entrada con _id y snapshot', async () => {
    const { repository, service } = makeService();
    const session = { id: 'tx' };
    const entry = await service.recordInTransaction(
      { action: AUDIT_ACTIONS.RECORD_PURGED, entity: 'users', entityId: 'abc', targetCollection: 'users', actor, snapshot: { email: 'a@b.co' } },
      session,
    );
    assert.ok(entry._id instanceof ObjectId);
    assert.equal(repository.sessions[0], session);
    assert.deepEqual(entry.snapshot, { email: 'a@b.co' });
    assert.equal(entry.actorRole, ROLES.SUPERUSER);
  });

  it('recordChange conserva el contrato de la Fase 3', async () => {
    const { repository, service } = makeService();
    const targetId = new ObjectId();
    await service.recordChange({
      actor,
      action: AUDIT_ACTIONS.SUPPLIER_UPDATED,
      targetCollection: 'suppliers',
      targetId,
      previousState: { name: 'A', passwordHash: 'x' },
      newState: { name: 'B' },
    });
    const [entry] = repository.entries;
    assert.equal(entry.entity, 'suppliers');
    assert.equal(entry.targetCollection, 'suppliers');
    assert.equal(entry.targetId, targetId.toString());
    assert.equal(entry.entityId, targetId.toString());
    assert.equal(entry.role, ROLES.SUPERUSER);
    assert.deepEqual(entry.previousState, { name: 'A' });
    assert.deepEqual(entry.newState, { name: 'B' });
    assert.deepEqual(entry.timestamp, entry.createdAt);
  });

  it('las acciones nuevas cumplen el patron del $jsonSchema', () => {
    for (const action of ['STAFF_CREATED', 'STAFF_ROLE_CHANGED', 'STAFF_STATUS_CHANGED', 'SETTINGS_UPDATED', 'RECORD_PURGED']) {
      assert.match(AUDIT_ACTIONS[action], /^[a-z_]+\.[a-z_]+$/, action);
    }
    assert.equal(AUDIT_ACTIONS.RECORD_PURGED, 'record.purged');
  });

  it('search filtra, ordena por timestamp descendente y pagina', async () => {
    const repository = new TransactionalAuditLogRepository();
    let tick = 0;
    const clock = () => new Date(Date.UTC(2026, 0, 1 + tick++));
    const service = new AuditService({ auditLogRepository: repository, logger: silentLogger, clock });
    const admin = { id: new ObjectId().toString(), role: ROLES.ADMIN };
    await service.record({ action: AUDIT_ACTIONS.USER_UPDATED, entity: 'user', actor: admin }); // 01-01
    await service.record({ action: AUDIT_ACTIONS.RECORD_PURGED, entity: 'users', actor }); // 01-02
    await service.record({ action: AUDIT_ACTIONS.RECORD_PURGED, entity: 'products', actor }); // 01-03
    await service.record({ action: AUDIT_ACTIONS.RECORD_PURGED, entity: 'users', actor }); // 01-04

    const purges = await service.search(SuperuserAuditLogQueryDTO.from({ action: 'record.purged', targetCollection: 'users' }));
    assert.equal(purges.total, 2);
    assert.ok(purges.items[0].timestamp > purges.items[1].timestamp);

    const byRole = await service.search(SuperuserAuditLogQueryDTO.from({ role: 'admin' }));
    assert.equal(byRole.total, 1);

    const byActor = await service.search(SuperuserAuditLogQueryDTO.from({ actorId: actor.id, limit: '2', page: '2' }));
    assert.equal(byActor.total, 3);
    assert.equal(byActor.items.length, 1);

    const byDate = await service.search(SuperuserAuditLogQueryDTO.from({ startDate: '2026-01-02', endDate: '2026-01-03' }));
    assert.equal(byDate.total, 2);
  });
});

describe('SuperuserAuditLogResponseDTO', () => {
  it('incluye targetCollection, timestamp y snapshot (con valores por defecto para entradas antiguas)', () => {
    const createdAt = new Date('2025-01-01T00:00:00Z');
    const legacy = SuperuserAuditLogResponseDTO.from({ _id: new ObjectId(), action: 'auth.login', outcome: 'success', entity: 'user', createdAt });
    assert.equal(legacy.targetCollection, null);
    assert.deepEqual(legacy.timestamp, createdAt);
    assert.equal(legacy.snapshot, null);

    const actorId = new ObjectId();
    const purged = SuperuserAuditLogResponseDTO.from({
      _id: new ObjectId(),
      action: 'record.purged',
      outcome: 'success',
      entity: 'users',
      entityId: 'abc',
      targetCollection: 'users',
      actorId,
      actorRole: 'superuser',
      snapshot: { email: 'x@y.com' },
      timestamp: NOW,
      createdAt: NOW,
    });
    assert.equal(purged.actorId, actorId.toString());
    assert.equal(purged.targetId, 'abc');
    assert.deepEqual(purged.snapshot, { email: 'x@y.com' });
  });
});
