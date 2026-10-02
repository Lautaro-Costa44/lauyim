// Roles sobre server.js de verdad: cada ruta del panel pide su permiso, el owner administra los
// roles, asignar solo da roles incluidos en los propios y sin "ver datos de salud" no llegan las
// lesiones. Puertos 40000–40900 (license 41000+, el resto más arriba).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-roles-'));
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
process.env.DATA_DIR = dataDir;

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
db.createUser({ id: 'admin', name: 'Admin', admin: true, created: Date.now() });
for (const id of ['recep', 'nutri', 'nutri2', 'socio', 'otro']) db.createUser({ id, name: id, created: Date.now(), healthConsent: true });
db.setUserRole('recep', 'reception');
db.setUserRole('nutri', 'nutrition');
const sinSalud = db.saveRole({ name: 'Nutri sin salud', color: '#123456', permissions: ['nutrition.manage'] });
db.setUserRole('nutri2', sinSalud.id);
db.saveLesiones('socio', ['rodilla']);
db.closeDatabase();

const PORT = 40000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
const cookie = uid => {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
async function call(uid, method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Cookie = cookie(uid);
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '', LICENSE_PAID_UNTIL: '', ADMIN_UIDS: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  server.stderr.on('data', d => { log += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('el server no arrancó:\n' + log)), 15000);
    server.stdout.on('data', d => { if (String(d).includes('gym-api on')) { clearTimeout(timer); resolve(); } });
    server.on('exit', code => reject(new Error(`el server terminó (${code}):\n${log}`)));
  });
});
after(async () => {
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('/api/me: rol, permisos, staff y exento', async () => {
  const recep = (await call('recep', 'GET', '/api/me')).body;
  assert.deepEqual(recep.user.role, { id: 'reception', name: 'Recepción', color: '#0a84ff' });
  assert.ok(recep.user.permissions.includes('fees.manage'));
  assert.ok(!recep.user.permissions.includes('nutrition.manage'));
  assert.equal(recep.user.admin, true);
  assert.deepEqual(Object.keys(recep.panel).sort(), ['auditEnabled', 'billingEnabled', 'checkinEnabled', 'classesEnabled']);
  const socio = (await call('socio', 'GET', '/api/me')).body;
  assert.deepEqual([socio.user.role, socio.user.permissions, socio.user.admin], [null, [], false]);
  assert.equal(socio.panel, null);
  const owner = (await call('owner', 'GET', '/api/me')).body;
  assert.ok(owner.user.permissions.includes('roles.assign'));
});

test('cada ruta pide su permiso: recepción cobra y no ve nutrición; un socio no entra', async () => {
  assert.equal((await call('recep', 'GET', '/api/admin/billing')).status, 200);
  assert.equal((await call('recep', 'GET', '/api/admin/users/socio/nutrition')).status, 403);
  assert.equal((await call('nutri', 'GET', '/api/admin/users/socio/nutrition')).status, 200);
  assert.equal((await call('nutri', 'GET', '/api/admin/billing')).status, 403);
  assert.equal((await call('socio', 'GET', '/api/admin/users')).status, 403);
  assert.equal((await call('admin', 'GET', '/api/admin/roles')).status, 403);   // Administrador no asigna roles de entrada
  assert.equal((await call('owner', 'GET', '/api/admin/roles')).status, 200);
});

test('sin "ver datos de salud" no llegan las lesiones', async () => {
  await call('owner', 'POST', '/api/owner/roles/save', { id: sinSalud.id, name: 'Nutri sin salud', color: '#123456', permissions: ['nutrition.manage', 'training.manage'] });
  assert.deepEqual((await call('nutri2', 'GET', '/api/admin/users/socio/routines')).body.lesiones, []);
  await call('owner', 'POST', '/api/owner/roles/save', { id: sinSalud.id, name: 'Nutri sin salud', color: '#123456', permissions: ['nutrition.manage', 'training.manage', 'health.view'] });
  assert.deepEqual((await call('nutri2', 'GET', '/api/admin/users/socio/routines')).body.lesiones, ['rodilla']);
});

test('roles: el owner crea, edita y borra; Administrador no se borra ni se renombra', async () => {
  assert.equal((await call('admin', 'POST', '/api/owner/roles/save', { name: 'X', color: '#000000' })).status, 403);
  const created = await call('owner', 'POST', '/api/owner/roles/save', { name: 'Caja', color: '#112233', permissions: ['fees.manage'], feeExempt: false });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.deepEqual(created.body.role.permissions, ['members.view', 'fees.view', 'fees.manage']);
  assert.equal(created.body.role.feeExempt, false);
  const dup = await call('owner', 'POST', '/api/owner/roles/save', { name: 'caja', color: '#112233' });
  assert.equal(dup.body.field, 'name');
  const renamed = await call('owner', 'POST', '/api/owner/roles/save', { id: 'admin', name: 'Jefe', color: '#000000', permissions: ['members.view'] });
  assert.equal(renamed.body.role.name, 'Administrador');
  assert.deepEqual(renamed.body.role.permissions, ['members.view']);
  // Vuelve a tener todo menos asignar roles, para los tests que siguen.
  const all = (await call('owner', 'GET', '/api/admin/roles')).body;
  await call('owner', 'POST', '/api/owner/roles/save', { id: 'admin', name: 'Administrador', color: '#ff453a', permissions: all.catalog.map(p => p.code).filter(c => c !== 'roles.assign') });
  assert.equal((await call('owner', 'POST', '/api/owner/roles/delete', { id: 'admin' })).status, 400);
  await call('owner', 'POST', '/api/admin/users/role', { userId: 'otro', roleId: created.body.role.id });
  assert.equal((await call('owner', 'POST', '/api/owner/roles/delete', { id: created.body.role.id })).status, 200);
  assert.equal((await call('otro', 'GET', '/api/me')).body.user.role, null);
});

test('asignar: solo roles con permisos que quien asigna tiene; nunca al owner', async () => {
  // Recepción con "asignar roles": puede dar Recepción, no Administrador ni Nutricionista.
  await call('owner', 'POST', '/api/owner/roles/save', { id: 'reception', name: 'Recepción', color: '#0a84ff', permissions: ['members.edit', 'members.approve', 'fees.manage', 'checkin.operate', 'roles.assign'] });
  assert.equal((await call('recep', 'POST', '/api/admin/users/role', { userId: 'socio', roleId: 'reception' })).status, 200);
  assert.equal((await call('recep', 'POST', '/api/admin/users/role', { userId: 'otro', roleId: 'admin' })).status, 403);
  assert.equal((await call('recep', 'POST', '/api/admin/users/role', { userId: 'otro', roleId: 'nutrition' })).status, 403);
  // Tampoco le saca el rol a alguien con más permisos.
  assert.equal((await call('recep', 'POST', '/api/admin/users/role', { userId: 'nutri', roleId: null })).status, 403);
  assert.equal((await call('owner', 'POST', '/api/admin/users/role', { userId: 'owner', roleId: 'admin' })).status, 400);
  assert.equal((await call('recep', 'POST', '/api/admin/users/role', { userId: 'socio', roleId: null })).status, 200);
  assert.equal((await call('socio', 'GET', '/api/me')).body.user.role, null);
  const roles = (await call('recep', 'GET', '/api/admin/roles')).body;
  assert.ok(roles.roles.find(r => r.id === 'reception').members >= 1);
});

test('lista de usuarios con su rol; a alguien con rol no se lo desactiva', async () => {
  const users = (await call('owner', 'GET', '/api/admin/users')).body.users;
  assert.deepEqual(users.find(u => u.id === 'nutri').role, { id: 'nutrition', name: 'Nutricionista', color: '#30d158' });
  assert.equal(users.find(u => u.id === 'socio').role, null);
  assert.equal(users.find(u => u.id === 'nutri').feeExempt, true);
  assert.equal(users.find(u => u.id === 'socio').feeExempt, false);
  assert.equal((await call('owner', 'POST', '/api/admin/user/disable', { id: 'nutri', disabled: true })).body.error, 'staff_undisableable');
});

test('borrar el registro de actividad: solo el owner', async () => {
  assert.equal((await call('admin', 'POST', '/api/owner/audit/clear', {})).status, 403);
  assert.equal((await call('owner', 'POST', '/api/owner/audit/clear', {})).status, 200);
  assert.equal((await call('owner', 'POST', '/api/admin/audit/clear', {})).status, 404);
});
