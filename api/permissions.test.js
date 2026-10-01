import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERMISSIONS, PERMISSION_CODES, withDependencies, withoutDependents, permissionsOf, can, isSubset,
  validateRole, DEFAULT_ROLES, ADMIN_ROLE_ID
} from './permissions.js';

test('catálogo: códigos únicos y dependencias que existen', () => {
  assert.equal(new Set(PERMISSION_CODES).size, PERMISSIONS.length);
  for (const p of PERMISSIONS) for (const r of p.requires) assert.ok(PERMISSION_CODES.includes(r), `${p.code} → ${r}`);
  assert.ok(PERMISSIONS.every(p => p.name && p.help && p.area));
});

test('activar uno activa lo que necesita; apagar uno apaga lo que depende de él', () => {
  assert.deepEqual(withDependencies(['fees.manage']), ['members.view', 'fees.view', 'fees.manage']);
  assert.deepEqual(withDependencies(['nada', 'checkin.operate']), ['checkin.operate']);
  assert.deepEqual(withoutDependents(['members.view', 'fees.view', 'fees.manage', 'checkin.operate'], 'members.view'), ['checkin.operate']);
  assert.deepEqual(withoutDependents(['members.view', 'fees.view', 'fees.manage'], 'fees.view'), ['members.view']);
});

test('permisos de cada persona: owner y ADMIN_UIDS todo; con rol, los del rol; sin rol, nada', () => {
  assert.deepEqual(permissionsOf({ owner: true }), PERMISSION_CODES);
  assert.deepEqual(permissionsOf({ envAdmin: true }), PERMISSION_CODES);
  assert.deepEqual(permissionsOf({ role: { permissions: ['checkin.operate'] } }), ['checkin.operate']);
  assert.deepEqual(permissionsOf({ role: null }), []);
  assert.ok(can(['fees.view'], 'fees.view'));
  assert.ok(!can(['fees.view'], 'fees.manage'));
  assert.ok(isSubset(['fees.view'], ['members.view', 'fees.view']));
  assert.ok(!isSubset(['fees.manage'], ['fees.view']));
});

test('roles de fábrica: Administrador con todo menos asignar roles; ejemplos sin el de fábrica', () => {
  const admin = DEFAULT_ROLES.find(r => r.id === ADMIN_ROLE_ID);
  assert.equal(admin.builtin, true);
  assert.deepEqual(admin.permissions, PERMISSION_CODES.filter(c => c !== 'roles.assign'));
  assert.deepEqual(DEFAULT_ROLES.map(r => r.name), ['Administrador', 'Recepción', 'Nutricionista', 'Profesor/a']);
  for (const r of DEFAULT_ROLES) assert.deepEqual(r.permissions, withDependencies(r.permissions), r.name);
  assert.ok(DEFAULT_ROLES.filter(r => r.id !== ADMIN_ROLE_ID).every(r => !r.builtin));
});

test('validateRole: nombre, color, permisos del catálogo con sus dependencias, exento por defecto', () => {
  assert.deepEqual(validateRole({ name: '  Caja  ', color: '#0A84FF', permissions: ['fees.manage', 'otro'] }).value,
    { name: 'Caja', color: '#0a84ff', permissions: ['members.view', 'fees.view', 'fees.manage'], feeExempt: true });
  assert.equal(validateRole({ name: 'Caja', color: '#0a84ff', permissions: [], feeExempt: false }).value.feeExempt, false);
  assert.equal(validateRole({ name: '', color: '#0a84ff' }).field, 'name');
  assert.equal(validateRole({ name: 'x'.repeat(31), color: '#0a84ff' }).field, 'name');
  assert.equal(validateRole({ name: 'Recepción', color: '#0a84ff' }, { existingNames: ['recepción'] }).field, 'name');
  assert.equal(validateRole({ name: 'Caja', color: 'azul' }).field, 'color');
  assert.equal(validateRole({ name: 'Caja', color: '#0a84ff', permissions: 'todo' }).field, 'permissions');
});
