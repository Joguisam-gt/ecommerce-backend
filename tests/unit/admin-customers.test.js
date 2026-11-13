/**
 * Pruebas del directorio de clientes (Fase 3, PARTE C1): regla del metodo de
 * pago preferido, estructura del pipeline, servicio (auditoria, soft/hard
 * delete, alcance solo clientes), validadores, DTOs y rutas con autorizacion.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { REVENUE_ORDER_STATUSES } from '../../src/constants/commerce.js';
import { ROLES } from '../../src/constants/roles.js';
import { CustomerController } from '../../src/controllers/customer.controller.js';
import { CustomerDTO, ListCustomersQueryDTO, UpdateCustomerDTO } from '../../src/dtos/customer.dto.js';
import {
  buildCustomerDetailPipeline,
  buildCustomerDirectoryPipeline,
  buildCustomerMatch,
  customerMetricsStages,
  escapeRegex,
  pickPreferredPaymentMethod,
  preferredPaymentMethodStage,
} from '../../src/repositories/pipelines/customer.pipeline.js';
import { createCustomerRoutes } from '../../src/routes/customer.routes.js';
import { AUDIT_ACTIONS } from '../../src/services/audit.service.js';
import { CustomerService } from '../../src/services/customer.service.js';
import { validateSchema } from '../../src/validators/schema-validator.js';
import { listCustomersQuerySchema, updateCustomerSchema } from '../../src/validators/customer.validator.js';
import { RecordingAuditService, adminActor, superuserActor } from '../helpers/admin-fakes.js';
import { InMemoryCustomerRepository, startRouterApp } from '../helpers/customer-report-fakes.js';
import { makeUser } from '../helpers/fixtures.js';

/**
 * Recorre un pipeline (incluidas sub-pipelines de $facet y $lookup) y devuelve
 * las etapas que usan el operador indicado.
 * @param {object[]} pipeline
 * @param {string} operator
 * @returns {object[]}
 */
function findStages(pipeline, operator) {
  const found = [];
  for (const stage of pipeline) {
    if (Object.hasOwn(stage, operator)) found.push(stage);
    if (stage.$facet) for (const sub of Object.values(stage.$facet)) found.push(...findStages(sub, operator));
    if (stage.$lookup?.pipeline) found.push(...findStages(stage.$lookup.pipeline, operator));
  }
  return found;
}

/** Indice de la primera etapa de nivel superior con el operador. */
const indexOf = (pipeline, operator) => pipeline.findIndex((stage) => Object.hasOwn(stage, operator));

describe('pickPreferredPaymentMethod (regla del metodo preferido)', () => {
  const at = (iso) => new Date(iso);

  it('gana el metodo con mas pedidos', () => {
    const orders = [
      { method: 'card', createdAt: at('2026-01-01') },
      { method: 'card', createdAt: at('2026-01-02') },
      { method: 'bank_transfer', createdAt: at('2026-03-01') },
    ];
    assert.equal(pickPreferredPaymentMethod(orders), 'card');
  });

  it('empate: gana el metodo con el pedido mas reciente', () => {
    const orders = [
      { method: 'card', createdAt: at('2026-01-01') },
      { method: 'cash_on_delivery', createdAt: at('2026-01-05') },
      { method: 'card', createdAt: at('2026-02-01') },
      { method: 'cash_on_delivery', createdAt: at('2026-02-10') },
    ];
    assert.equal(pickPreferredPaymentMethod(orders), 'cash_on_delivery');
  });

  it('sin pedidos devuelve null', () => {
    assert.equal(pickPreferredPaymentMethod([]), null);
    assert.equal(pickPreferredPaymentMethod(undefined), null);
  });

  it('cuenta pedidos en cualquier estado (rechazados y reembolsados incluidos)', () => {
    const orders = [
      { payment: { method: 'bank_transfer' }, status: 'rejected', createdAt: at('2026-01-01') },
      { payment: { method: 'bank_transfer' }, status: 'refunded', createdAt: at('2026-01-02') },
      { payment: { method: 'card' }, status: 'paid', createdAt: at('2026-01-03') },
    ];
    assert.equal(pickPreferredPaymentMethod(orders), 'bank_transfer');
  });

  it('empate total (misma fecha) se resuelve por orden alfabetico, de forma determinista', () => {
    const orders = [
      { method: 'card', createdAt: at('2026-01-01') },
      { method: 'bank_transfer', createdAt: at('2026-01-01') },
    ];
    assert.equal(pickPreferredPaymentMethod(orders), 'bank_transfer');
    assert.equal(pickPreferredPaymentMethod([...orders].reverse()), 'bank_transfer');
  });

  it('la etapa del pipeline aplica la misma regla con $reduce (mas pedidos, mas reciente, alfabetico)', () => {
    const stage = preferredPaymentMethodStage();
    const expression = stage.$addFields.preferredPaymentMethod.$let;
    const reduce = expression.vars.best.$reduce;
    assert.deepEqual(reduce.input.$filter.cond, { $ne: ['$$entry.method', null] });
    const criteria = reduce.in.$cond[0].$or;
    assert.deepEqual(criteria[1], { $gt: ['$$this.orders', '$$value.orders'] });
    assert.deepEqual(criteria[2].$and[1], { $gt: ['$$this.lastOrderAt', '$$value.lastOrderAt'] });
    assert.deepEqual(criteria[3].$and[2], { $lt: ['$$this.method', '$$value.method'] });
    assert.deepEqual(expression.in, { $ifNull: ['$$best.method', null] });
  });
});

describe('Pipeline del directorio de clientes', () => {
  it('metricas: $lookup correlacionado a orders con proyeccion minima y dos $group', () => {
    const stages = customerMetricsStages();
    const lookup = stages[indexOf(stages, '$lookup')].$lookup;
    assert.equal(lookup.from, 'orders');
    assert.deepEqual(lookup.let, { customerId: '$_id' });
    assert.deepEqual(lookup.pipeline[0], { $match: { $expr: { $eq: ['$userId', '$$customerId'] } } });
    assert.deepEqual(Object.keys(lookup.pipeline[1].$project).sort(), ['_id', 'createdAt', 'grandTotalCents', 'itemsCount', 'method', 'status']);

    const groups = findStages(stages, '$group');
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].$group._id, { customerId: '$_id', method: { $ifNull: ['$orders.method', null] } });
    // Las compras solo suman pedidos de venta efectiva.
    const purchased = groups[0].$group.purchasedItems.$sum.$cond[0].$in[1];
    assert.deepEqual(purchased, [...REVENUE_ORDER_STATUSES]);
    assert.deepEqual(groups[0].$group.returnedItems.$sum.$cond[0].$in[1], ['refunded']);
    assert.ok(stages.some((stage) => stage.$addFields?.preferredPaymentMethod));
  });

  it('sin filtros de metricas: $match de users primero y $lookup/$group solo en la pagina', () => {
    const pipeline = buildCustomerDirectoryPipeline({}, { page: 2, limit: 10 });
    assert.deepEqual(pipeline[0], { $match: { role: ROLES.USER, isActive: true } });
    assert.equal(indexOf(pipeline, '$lookup'), -1, 'el $lookup no debe ejecutarse sobre todos los clientes');
    const facet = pipeline[indexOf(pipeline, '$facet')].$facet;
    assert.deepEqual(facet.items.slice(0, 2), [{ $skip: 10 }, { $limit: 10 }]);
    assert.equal(findStages(facet.items, '$lookup').length, 1);
    assert.equal(findStages(facet.items, '$group').length, 2);
    assert.deepEqual(facet.total, [{ $count: 'total' }]);
  });

  it('con filtros de metricas: se filtran tras el $group y antes de paginar', () => {
    const pipeline = buildCustomerDirectoryPipeline(
      { email: 'ana', preferredPaymentMethod: 'card', minTotalSpentCents: 1000, maxTotalSpentCents: 5000, minPurchasedItems: 2 },
      { page: 1, limit: 20 },
    );
    // Filtros de contacto en la etapa inicial (sin metricas).
    assert.deepEqual(pipeline[0].$match.email, { $regex: 'ana', $options: 'i' });
    assert.equal(pipeline[0].$match.totalSpentCents, undefined);

    const lastGroup = pipeline.findLastIndex((stage) => stage.$group);
    const metricsMatchIndex = pipeline.findIndex((stage, index) => index > lastGroup && stage.$match);
    assert.ok(indexOf(pipeline, '$lookup') > 0 && lastGroup > indexOf(pipeline, '$lookup'));
    assert.ok(metricsMatchIndex > lastGroup);
    assert.deepEqual(pipeline[metricsMatchIndex].$match, {
      preferredPaymentMethod: 'card',
      totalSpentCents: { $gte: 1000, $lte: 5000 },
      purchasedItems: { $gte: 2 },
    });
    assert.ok(indexOf(pipeline, '$facet') > metricsMatchIndex);
  });

  it('filtros de users: nombre escapado sobre el nombre completo, includeInactive, isActive y codigo', () => {
    const match = buildCustomerMatch({ name: 'Ana (.*)', includeInactive: true });
    assert.equal(match.isActive, undefined);
    assert.equal(match.$expr.$regexMatch.regex, 'Ana \\(\\.\\*\\)');
    assert.deepEqual(match.$expr.$regexMatch.input, { $concat: ['$firstName', ' ', '$lastName'] });

    assert.equal(buildCustomerMatch({ isActive: false }).isActive, false);

    const id = new ObjectId();
    const byId = buildCustomerMatch({ userCode: id.toString() });
    assert.equal(byId.$or.length, 2);
    assert.ok(byId.$or[1]._id.equals(id));
    assert.deepEqual(buildCustomerMatch({ userCode: 'CLI-001' }).$or, [{ userCode: 'CLI-001' }]);
    assert.equal(escapeRegex('a+b'), 'a\\+b');
  });

  it('detalle: un solo cliente con rol user y las mismas metricas', () => {
    const id = new ObjectId();
    const pipeline = buildCustomerDetailPipeline(id);
    assert.deepEqual(pipeline[0], { $match: { _id: id, role: ROLES.USER } });
    assert.equal(findStages(pipeline, '$group').length, 2);
  });
});

describe('CustomerService', () => {
  let repository;
  let audit;
  let service;
  let customer;
  let admin;
  const now = new Date('2026-06-01T00:00:00Z');

  beforeEach(() => {
    customer = makeUser({ role: ROLES.USER, userCode: null });
    admin = makeUser({ role: ROLES.ADMIN });
    repository = new InMemoryCustomerRepository([customer, admin]);
    audit = new RecordingAuditService();
    service = new CustomerService({ customerRepository: repository, auditService: audit, clock: () => now });
  });

  it('soft delete por admin: isActive false, revoca sesiones y audita previous/new', async () => {
    const before = customer.tokenVersion;
    const context = { ip: '127.0.0.1', userAgent: 'test' };
    const updated = await service.deactivateCustomer(adminActor, customer._id.toString(), context);

    assert.equal(updated.isActive, false);
    assert.equal(repository.peek(customer._id).tokenVersion, before + 1);
    assert.equal(audit.changes.length, 1);
    const [change] = audit.changes;
    assert.equal(change.action, AUDIT_ACTIONS.CUSTOMER_DEACTIVATED);
    assert.equal(change.targetCollection, 'users');
    assert.equal(change.targetId, customer._id.toString());
    assert.equal(change.previousState.isActive, true);
    assert.equal(change.newState.isActive, false);
    assert.deepEqual(change.context, context);
    assert.equal(change.actor.id, adminActor.id);
  });

  it('desactivar un cliente ya inactivo no escribe ni audita', async () => {
    await service.deactivateCustomer(adminActor, customer._id.toString());
    await service.deactivateCustomer(adminActor, customer._id.toString());
    assert.equal(audit.changes.length, 1);
  });

  it('borrado fisico por admin: 403 y el cliente sigue existiendo', async () => {
    await assert.rejects(service.deleteCustomer(adminActor, customer._id.toString()), { status: 403, code: 'HARD_DELETE_FORBIDDEN' });
    assert.ok(repository.peek(customer._id));
    assert.equal(audit.changes.length, 0);
  });

  it('borrado fisico por superusuario: elimina y audita con newState null', async () => {
    await service.deleteCustomer(superuserActor, customer._id.toString());
    assert.equal(repository.peek(customer._id), undefined);
    const [change] = audit.changes;
    assert.equal(change.action, AUDIT_ACTIONS.CUSTOMER_DELETED);
    assert.equal(change.previousState.email, customer.email);
    assert.equal(change.newState, null);
  });

  it('no gestiona cuentas admin/superuser: 403 NOT_A_CUSTOMER en mutaciones y 404 en el detalle', async () => {
    const adminId = admin._id.toString();
    await assert.rejects(service.updateCustomer(superuserActor, adminId, { firstName: 'X' }), { status: 403, code: 'NOT_A_CUSTOMER' });
    await assert.rejects(service.deactivateCustomer(superuserActor, adminId), { status: 403, code: 'NOT_A_CUSTOMER' });
    await assert.rejects(service.deleteCustomer(superuserActor, adminId), { status: 403, code: 'NOT_A_CUSTOMER' });
    await assert.rejects(service.getCustomer(adminId), { status: 404 });
    assert.equal(repository.peek(admin._id).isActive, true);
    assert.equal(audit.changes.length, 0);
  });

  it('actualiza datos basicos y audita los campos cambiados', async () => {
    const updated = await service.updateCustomer(adminActor, customer._id.toString(), { firstName: 'Maria', userCode: 'CLI-001' });
    assert.equal(updated.firstName, 'Maria');
    assert.equal(updated.userCode, 'CLI-001');
    const [change] = audit.changes;
    assert.equal(change.action, AUDIT_ACTIONS.CUSTOMER_UPDATED);
    assert.equal(change.previousState.firstName, 'Ana');
    assert.equal(change.newState.firstName, 'Maria');
    assert.deepEqual(change.metadata.fields, ['firstName', 'userCode']);
  });

  it('userCode duplicado: 409 (comprobacion previa y carrera con E11000)', async () => {
    const other = makeUser({ role: ROLES.USER, userCode: 'CLI-777' });
    repository.docs.set(other._id.toString(), other);
    await assert.rejects(service.updateCustomer(adminActor, customer._id.toString(), { userCode: 'CLI-777' }), {
      status: 409,
      code: 'USER_CODE_IN_USE',
    });

    repository.failWithDuplicateKey = true;
    await assert.rejects(service.updateCustomer(adminActor, customer._id.toString(), { userCode: 'CLI-888' }), { status: 409 });
    assert.equal(audit.changes.length, 0);
  });

  it('id inexistente o mal formado: 404', async () => {
    await assert.rejects(service.getCustomer(new ObjectId().toString()), { status: 404 });
    await assert.rejects(service.deactivateCustomer(adminActor, 'no-es-id'), { status: 404 });
  });

  it('listado: separa paginacion de filtros', async () => {
    const result = await service.listCustomers({ page: 3, limit: 5, email: 'a' });
    assert.deepEqual(repository.lastListCall, { filters: { email: 'a' }, pagination: { page: 3, limit: 5 } });
    assert.equal(result.page, 3);
  });
});

describe('Validadores y DTOs de clientes', () => {
  it('actualizacion: rechaza correo, rol y estado; exige al menos un campo', () => {
    const errors = validateSchema(updateCustomerSchema, { email: 'x@y.com', role: 'admin', isActive: false });
    assert.deepEqual(errors.map((error) => error.field).sort(), ['_root', 'email', 'isActive', 'role']);
    assert.deepEqual(validateSchema(updateCustomerSchema, { userCode: null }), []);
    assert.ok(validateSchema(updateCustomerSchema, { userCode: new ObjectId().toString() }).length > 0);
  });

  it('listado: valida rango de gasto y convierte a centavos', () => {
    assert.equal(validateSchema(listCustomersQuerySchema, { minTotalSpent: '50', maxTotalSpent: '10' })[0].field, 'minTotalSpent');
    const dto = ListCustomersQueryDTO.from({ minTotalSpent: '10.5', includeInactive: 'true', minPurchasedItems: '3' });
    assert.equal(dto.minTotalSpentCents, 1050);
    assert.equal(dto.includeInactive, true);
    assert.equal(dto.minPurchasedItems, 3);
    assert.equal(dto.page, 1);
  });

  it('UpdateCustomerDTO normaliza el codigo y CustomerDTO expone unidades y codigo por defecto', () => {
    assert.deepEqual({ ...UpdateCustomerDTO.from({ userCode: ' cli-01 ', firstName: ' Ana  Maria ' }) }, {
      firstName: 'Ana Maria',
      userCode: 'CLI-01',
    });
    const id = new ObjectId();
    const dto = CustomerDTO.from({ _id: id, userCode: id.toString(), name: 'A B', totalSpentCents: 12345, paymentMethods: [] });
    assert.equal(dto.totalSpent, 123.45);
    assert.equal(dto.userCode, id.toString());
    assert.equal(dto.preferredPaymentMethod, null);
  });
});

describe('Rutas /admin/customers (autorizacion por permiso)', () => {
  let app;
  let customer;
  let repository;
  let audit;

  before(async () => {
    customer = makeUser({ role: ROLES.USER });
    repository = new InMemoryCustomerRepository([customer]);
    audit = new RecordingAuditService();
    const customerService = new CustomerService({ customerRepository: repository, auditService: audit });
    const router = createCustomerRoutes({ customerController: new CustomerController({ customerService }) });
    app = await startRouterApp(router, { admin: adminActor, superuser: superuserActor, user: { id: new ObjectId().toString(), role: ROLES.USER } });
  });

  after(() => app.close());

  it('DELETE por admin responde 403 desde authorize (records:hard_delete)', async () => {
    const response = await app.call(`/${customer._id}`, { method: 'DELETE', role: 'admin' });
    assert.equal(response.status, 403);
    assert.ok(repository.peek(customer._id));
  });

  it('PATCH valida el cuerpo y responde la cuenta actualizada', async () => {
    const invalid = await app.call(`/${customer._id}`, { method: 'PATCH', role: 'admin', body: { role: 'admin' } });
    assert.equal(invalid.status, 400);
    const ok = await app.call(`/${customer._id}`, { method: 'PATCH', role: 'admin', body: { phone: '+502 5555-1234' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.phone, '+502 5555-1234');
    assert.equal(ok.body.data.passwordHash, undefined);
  });

  it('PATCH /:id/deactivate y DELETE por superusuario', async () => {
    const deactivated = await app.call(`/${customer._id}/deactivate`, { method: 'PATCH', role: 'admin' });
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.data.isActive, false);
    const removed = await app.call(`/${customer._id}`, { method: 'DELETE', role: 'superuser' });
    assert.equal(removed.status, 204);
    assert.deepEqual(
      audit.changes.map((change) => change.action),
      [AUDIT_ACTIONS.CUSTOMER_UPDATED, AUDIT_ACTIONS.CUSTOMER_DEACTIVATED, AUDIT_ACTIONS.CUSTOMER_DELETED],
    );
  });

  it('un cliente (rol user) no tiene customers:manage', async () => {
    const response = await app.call('/', { role: 'user' });
    assert.equal(response.status, 403);
  });

  it('GET / valida la query', async () => {
    const response = await app.call('/?preferredPaymentMethod=bitcoin', { role: 'admin' });
    assert.equal(response.status, 400);
  });
});
