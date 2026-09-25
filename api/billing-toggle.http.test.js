// Interruptor de cuotas y horario de avisos por HTTP, sobre server.js de verdad (igual que
// billing.http.test.js): con cuotas apagado nadie queda bloqueado, /api/me no trae cuota,
// las escrituras de cuotas responden 409 y ningún dato de cuotas se toca.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, gymToday } from './billing.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-billing-toggle-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);

const today = gymToday(Date.now(), 'America/Argentina/Buenos_Aires');
const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });   // el primer usuario es owner
db.createUser({ id: 'staff', name: 'Admin', admin: true, created: Date.now() });
for (const id of ['blocked', 'late', 'soon', 'fine', 'off']) db.createUser({ id, name: id, created: Date.now() });
db.updateUser('off', { disabled: true });
const plan = db.createPlan({ name: 'Mensual', price: 20000, durationDays: 30 });
// Default: 5 días de tolerancia y "por vencer" dentro de 5 días.
for (const [id, due] of [['owner', -10], ['staff', -10], ['off', -10], ['blocked', -10], ['late', -2], ['soon', 2], ['fine', 20]]) {
  db.setMemberBilling(id, { planId: plan.id, dueDate: addDays(today, due) });
}
db.closeDatabase();

const PORT = 44000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

function cookie(uid) {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
async function call(uid, method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(uid ? { Cookie: cookie(uid) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const auditEvents = () => fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l).ev);

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '' },
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

test('por defecto cuotas está encendido: el socio vencido > tolerancia queda bloqueado', async () => {
  assert.equal((await call('owner', 'GET', '/api/admin/users')).body.billing_enabled, true);
  const me = await call('blocked', 'GET', '/api/me');
  assert.equal(me.body.billingEnabled, true);
  assert.equal(me.body.billing.blocked, true);
  assert.equal((await call('blocked', 'GET', '/api/data')).body.error, 'membership_blocked');
});

test('PUT enabled: solo el owner, con booleano', async () => {
  assert.equal((await call('staff', 'PUT', '/api/owner/billing/enabled', { enabled: false })).status, 403);
  assert.equal((await call('blocked', 'PUT', '/api/owner/billing/enabled', { enabled: false })).status, 403);
  assert.equal((await call('owner', 'PUT', '/api/owner/billing/enabled', { enabled: 'no' })).status, 400);
  assert.equal((await call('owner', 'GET', '/api/admin/users')).body.billing_enabled, true);
});

test('apagado: nadie queda bloqueado y /api/me no trae cuota', async () => {
  const off = await call('owner', 'PUT', '/api/owner/billing/enabled', { enabled: false });
  assert.deepEqual(off.body, { enabled: false });
  assert.equal((await call('staff', 'GET', '/api/admin/users')).body.billing_enabled, false);

  const me = await call('blocked', 'GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.billingEnabled, false);
  assert.equal(me.body.billing, null);
  for (const [method, url, body] of [['GET', '/api/data'], ['POST', '/api/data/sync', { operations: [] }], ['GET', '/api/nutrition/goals']]) {
    assert.equal((await call('blocked', method, url, body)).status, 200, `${method} ${url}`);
  }
  assert.ok(auditEvents().includes('owner.billing.disabled'));
});

test('apagado: escrituras de cuotas y el panel responden 409 billing_disabled', async () => {
  const calls = [
    ['GET', '/api/admin/billing'],
    ['POST', '/api/admin/billing/plans', { name: 'Anual', price: 1, durationDays: 365 }],
    ['PUT', `/api/admin/billing/plans/${plan.id}`, { price: 1 }],
    ['PUT', '/api/admin/billing/settings', { grace_days: 1 }],
    ['PUT', '/api/admin/users/fine/billing', { planId: null }],
    ['POST', '/api/admin/users/fine/payments', { method: 'efectivo' }],
    ['POST', '/api/admin/users/fine/payments/1/void', {}],
    ['POST', '/api/admin/members', { fullName: 'Ana Pérez', dni: '30111222', phone: '1155556666', planId: plan.id, dueDate: today }]
  ];
  for (const [method, url, body] of calls) {
    const r = await call('staff', method, url, body);
    assert.equal(r.status, 409, `${method} ${url}`);
    assert.equal(r.body.error, 'billing_disabled', `${method} ${url}`);
  }
  // Nada cambió: el plan y los vencimientos siguen como estaban.
  db.initDatabase();
  try {
    assert.equal(db.getPlanById(plan.id).price, 20000);
    assert.equal(db.getMemberBilling('fine').dueDate, addDays(today, 20));
    assert.equal(db.getMemberBilling('blocked').dueDate, addDays(today, -10));
    assert.equal(db.getPlans().length, 1);
  } finally { db.closeDatabase(); }
});

test('enable-preview: cuenta socios activos no staff por estado; solo owner', async () => {
  assert.equal((await call('staff', 'GET', '/api/owner/billing/enable-preview')).status, 403);
  const preview = await call('owner', 'GET', '/api/owner/billing/enable-preview');
  assert.equal(preview.status, 200);
  // owner, staff y el desactivado también están bloqueados, pero no cuentan.
  assert.deepEqual(preview.body, { today, bloqueado: 1, vencido: 1, por_vencer: 1 });
});

test('volver a encender restaura el bloqueo con los mismos datos', async () => {
  assert.deepEqual((await call('owner', 'PUT', '/api/owner/billing/enabled', { enabled: true })).body, { enabled: true });
  const me = await call('blocked', 'GET', '/api/me');
  assert.deepEqual(me.body.billing, { hasPlan: true, status: 'bloqueado', dueDate: addDays(today, -10), planName: 'Mensual', blocked: true, trialUntil: null, trialEnded: false });
  assert.equal((await call('blocked', 'GET', '/api/data')).status, 403);
  assert.equal((await call('staff', 'GET', '/api/admin/billing')).status, 200);
  assert.ok(auditEvents().includes('owner.billing.enabled'));
});

test('horario de avisos: default 12:00, validación HH:MM, solo admins', async () => {
  const initial = await call('staff', 'GET', '/api/admin/notifications/settings');
  assert.equal(initial.status, 200);
  assert.equal(initial.body.billing_notify_hour, '12:00');
  assert.equal((await call('blocked', 'GET', '/api/admin/notifications/settings')).status, 403);
  assert.equal((await call('fine', 'PUT', '/api/admin/notifications/settings', { billing_notify_hour: '09:00' })).status, 403);
  for (const bad of ['9:00', '24:00', '12:60', '12', '', null, 900]) {
    assert.equal((await call('staff', 'PUT', '/api/admin/notifications/settings', { billing_notify_hour: bad })).status, 400, String(bad));
  }
  const saved = await call('staff', 'PUT', '/api/admin/notifications/settings', { billing_notify_hour: '09:30' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.billing_notify_hour, '09:30');
  assert.equal((await call('owner', 'GET', '/api/admin/notifications/settings')).body.billing_notify_hour, '09:30');
  assert.ok(auditEvents().includes('admin.notifications.settings'));
});
