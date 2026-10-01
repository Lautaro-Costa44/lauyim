// Roles en la base: siembra única, migración de los admins de antes, alta/edición/baja y asignación.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lauyim-roles-db-'));
process.env.DATA_DIR = tmpDir;
const db = await import('./database.js');

test('migración: crea los cuatro roles una sola vez y pasa a Administrador a los admins de antes', () => {
  db.initDatabase();
  db.createUser({ id: 'owner', name: 'Dueña' });
  db.createUser({ id: 'socio', name: 'Socio' });
  // Un admin de antes de los roles: admin = 1 y sin rol.
  db.getDatabase().prepare("INSERT INTO users (id, name, admin, owner, disabled, created_at) VALUES ('viejo', 'Admin viejo', 1, 0, 0, ?)").run(new Date().toISOString());
  db.closeDatabase();
  db.initDatabase();
  assert.deepEqual(db.getRoles().map(r => r.name), ['Administrador', 'Recepción', 'Nutricionista', 'Profesor/a']);
  assert.equal(db.getUserById('viejo').role_id, 'admin');
  assert.equal(db.getUserById('owner').role_id, null);     // el owner no lleva rol
  assert.equal(db.getUserById('socio').role_id, null);
  // Borrar uno de ejemplo y reiniciar no lo recrea.
  db.deleteRole('coach');
  db.closeDatabase();
  db.initDatabase();
  assert.deepEqual(db.getRoles().map(r => r.id), ['admin', 'reception', 'nutrition']);
});

test('alta y edición: permisos con dependencias, exento, cantidad de personas', () => {
  const caja = db.saveRole({ name: 'Caja', color: '#123456', permissions: ['fees.view', 'members.view'], feeExempt: false });
  assert.match(caja.id, /^[a-z0-9-]+$/);
  assert.deepEqual(db.getRole(caja.id), { id: caja.id, name: 'Caja', color: '#123456', permissions: ['members.view', 'fees.view'], feeExempt: false, builtin: false, members: 0 });
  db.setUserRole('socio', caja.id);
  assert.equal(db.getRoles().find(r => r.id === caja.id).members, 1);
  const edited = db.saveRole({ id: caja.id, name: 'Caja chica', color: '#654321', permissions: [], feeExempt: true });
  assert.deepEqual({ name: edited.name, permissions: edited.permissions, feeExempt: edited.feeExempt, members: edited.members }, { name: 'Caja chica', permissions: [], feeExempt: true, members: 1 });
  assert.equal(db.saveRole({ id: 'no-existe', name: 'X', color: '#000000', permissions: [] }), null);
});

test('baja: sus personas quedan sin rol; el de fábrica no se borra', () => {
  const tmp = db.saveRole({ name: 'Temporal', color: '#111111', permissions: [] });
  db.setUserRole('socio', tmp.id);
  assert.equal(db.deleteRole(tmp.id), true);
  assert.equal(db.getUserById('socio').role_id, null);
  assert.equal(db.getRole(tmp.id), null);
  assert.equal(db.deleteRole('admin'), false);
  assert.ok(db.getRole('admin'));
});

test('quitarle el rol a un admin de antes dura: reiniciar no lo vuelve a hacer Administrador', () => {
  db.setUserRole('viejo', null);
  db.closeDatabase();
  db.initDatabase();
  assert.equal(db.getUserById('viejo').role_id, null);
});

test('createUser con admin: true lleva el rol Administrador (demo y altas viejas)', () => {
  db.createUser({ id: 'staff2', name: 'Staff', admin: true });
  assert.equal(db.getUserById('staff2').role_id, 'admin');
});

test('migración de clases: suma los permisos de clases a Administrador y Profesor/a una sola vez', () => {
  const dbh = db.getDatabase();
  if (!db.getRole('coach')) dbh.prepare("INSERT INTO roles (id, name, color, permissions, fee_exempt, builtin, created_at) VALUES ('coach', 'Profesor/a', '#ff9f0a', '[]', 1, 0, ?)").run(new Date().toISOString());
  // Una instancia con roles de antes de las clases: sin esos permisos y sin la marca.
  const strip = id => { const r = db.getRole(id); db.getDatabase().prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(JSON.stringify(r.permissions.filter(c => !c.startsWith('classes.'))), id); };
  strip('admin'); strip('coach');
  dbh.prepare("DELETE FROM admin_settings WHERE key = 'classes_perms_seeded'").run();
  db.closeDatabase();
  db.initDatabase();
  for (const id of ['admin', 'coach']) assert.ok(db.getRole(id).permissions.includes('classes.manage'), id);
  assert.ok(!db.getRole('reception').permissions.includes('classes.manage'));
  // Ya migrada: si el owner se los saca a Profesor/a, reiniciar no los vuelve a poner.
  strip('coach');
  db.closeDatabase();
  db.initDatabase();
  assert.ok(!db.getRole('coach').permissions.includes('classes.manage'));
});
