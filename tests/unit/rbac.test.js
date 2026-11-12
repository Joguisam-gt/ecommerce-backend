/**
 * Pruebas de la matriz RBAC y de la politica jerarquica entre usuarios.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS as P, hasPermission, permissionsOf } from '../../src/constants/permissions.js';
import { ROLES } from '../../src/constants/roles.js';
import { canAssignRole, canManageUser, isSelf, outranks } from '../../src/services/user-access.policy.js';
import { makeUser } from '../helpers/fixtures.js';

describe('Matriz de permisos', () => {
  it('superuser tiene todos los permisos', () => {
    for (const permission of Object.values(P)) {
      assert.ok(hasPermission(ROLES.SUPERUSER, permission), permission);
    }
  });

  it('admin opera el dia a dia pero sin borrado fisico, logs, admins ni configuracion', () => {
    for (const allowed of [P.USERS_READ, P.USERS_CREATE, P.USERS_DEACTIVATE, P.PRODUCTS_MANAGE, P.ORDERS_MANAGE]) {
      assert.ok(hasPermission(ROLES.ADMIN, allowed), allowed);
    }
    for (const denied of [P.USERS_DELETE, P.RECORDS_HARD_DELETE, P.AUDIT_READ, P.ADMINS_MANAGE, P.SETTINGS_MANAGE]) {
      assert.equal(hasPermission(ROLES.ADMIN, denied), false, denied);
    }
  });

  it('user solo tiene carrito, POS, catalogo, pedidos propios y perfil', () => {
    assert.deepEqual(permissionsOf(ROLES.USER).sort(), [
      P.CART_MANAGE,
      P.CATALOG_READ,
      P.ORDERS_OWN,
      P.POS_USE,
      P.PROFILE_READ,
      P.PROFILE_UPDATE,
    ].sort());
  });

  it('un rol desconocido o malicioso no tiene permisos', () => {
    assert.equal(hasPermission('root', P.AUDIT_READ), false);
    assert.equal(hasPermission('__proto__', P.AUDIT_READ), false);
    assert.deepEqual(permissionsOf('constructor'), []);
  });

  it('la matriz es inmutable', () => {
    assert.throws(() => {
      P.NEW = 'x';
    }, TypeError);
  });
});

describe('Politica de acceso entre usuarios', () => {
  const superuser = makeUser({ role: ROLES.SUPERUSER });
  const admin = makeUser({ role: ROLES.ADMIN });
  const otherAdmin = makeUser({ role: ROLES.ADMIN });
  const customer = makeUser({ role: ROLES.USER });

  it('outranks respeta la jerarquia', () => {
    assert.ok(outranks(ROLES.SUPERUSER, ROLES.ADMIN));
    assert.ok(outranks(ROLES.ADMIN, ROLES.USER));
    assert.equal(outranks(ROLES.ADMIN, ROLES.ADMIN), false);
    assert.equal(outranks(ROLES.USER, ROLES.ADMIN), false);
  });

  it('superuser gestiona a cualquiera', () => {
    assert.ok(canManageUser(superuser, admin));
    assert.ok(canManageUser(superuser, customer));
  });

  it('admin solo gestiona clientes', () => {
    assert.ok(canManageUser(admin, customer));
    assert.equal(canManageUser(admin, otherAdmin), false);
    assert.equal(canManageUser(admin, superuser), false);
  });

  it('user no gestiona a nadie', () => {
    assert.equal(canManageUser(customer, makeUser()), false);
  });

  it('asignacion de roles', () => {
    assert.ok(canAssignRole(ROLES.SUPERUSER, ROLES.ADMIN));
    assert.ok(canAssignRole(ROLES.ADMIN, ROLES.USER));
    assert.equal(canAssignRole(ROLES.ADMIN, ROLES.ADMIN), false);
    assert.equal(canAssignRole(ROLES.ADMIN, ROLES.SUPERUSER), false);
    assert.equal(canAssignRole(ROLES.USER, ROLES.USER), false);
    assert.equal(canAssignRole(ROLES.SUPERUSER, 'god'), false);
  });

  it('isSelf compara por identificador', () => {
    assert.ok(isSelf({ id: admin._id.toString() }, admin));
    assert.equal(isSelf({ id: admin._id.toString() }, customer), false);
  });
});
