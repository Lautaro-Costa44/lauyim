// Cierres del gimnasio sobre server.js de verdad: permisos, cerrar sin clases con aviso programado,
// la lista del socio, extender vencimientos y devolverlos al reabrir, la hora de avisos de cierre y
// anular un pago después de correr vencimientos.
// Puertos 51000–51900.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-closures-'));
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
process.env.DATA_DIR = dataDir;

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
for (const id of ['recep', 'jefa', 'ana', 'beto']) db.createUser({ id, name: id, created: Date.now() });
db.setUserRole('recep', 'reception');                 // fees.manage, sin gym.closures
const jefa = db.saveRole({ name: 'Jefa', color: '#123456', permissions: ['gym.closures'] });
db.setUserRole('jefa', jefa.id);                       // gym.closures, sin fees.manage
db.getDatabase().prepare("INSERT INTO plans (id, name, price, duration_days, active, created_at, updated_at) VALUES (1, 'Mensual', 100, 30, 1, 0, 0)").run();
db.closeDatabase();

const PORT = 51000 + Math.floor(Math.random() * 900);
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

const dayAfter = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
let today;

test('socio: GET /api/closures da hoy y la lista pública, sin módulo de clases', async () => {
  const r = await call('ana', 'GET', '/api/closures');
  assert.equal(r.status, 200);
  assert.match(r.body.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(r.body.closures, []);
  today = r.body.today;
  assert.equal((await call(null, 'GET', '/api/closures')).status, 401);
});

test('permisos: sin gym.closures no cierra; extender pide cuotas prendido y fees.manage', async () => {
  const day = dayAfter(today, 10);
  assert.equal((await call('recep', 'POST', '/api/admin/closures', { from: day })).status, 403);
  assert.equal((await call('ana', 'GET', '/api/admin/closures')).status, 403);
  const pv = await call('jefa', 'GET', `/api/admin/closures/preview?from=${day}&to=${day}`);
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.equal(pv.body.days, 1);
  assert.equal(pv.body.extend, undefined);
  assert.equal((await call('jefa', 'POST', '/api/admin/closures', { from: day, extendDays: 1 })).status, 403);
  assert.equal((await call('owner', 'POST', '/api/admin/closures', { from: day, extendDays: 2 })).status, 400);
});

test('cerrar: sin clases, con aviso general programado; la lista del socio lo trae; reabrir lo borra', async () => {
  const day = dayAfter(today, 5);
  const made = await call('jefa', 'POST', '/api/admin/closures', { from: day, to: day, reason: 'Feriado' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.deepEqual([made.body.notified, made.body.classes, made.body.extended], [0, 0, 0]);
  assert.ok(made.body.announceAt > Date.now());
  const list = await call('owner', 'GET', '/api/admin/closures');
  assert.deepEqual(list.body.closures.map(c => [c.from, c.notifyAll, c.announcedAt, c.extended]), [[day, true, null, 0]]);
  const pub = await call('ana', 'GET', '/api/closures');
  assert.deepEqual(pub.body.closures, [{ id: made.body.closure.id, from: day, to: day, reason: 'Feriado' }]);
  assert.equal((await call('owner', 'POST', '/api/admin/closures', { from: day })).body.error, 'closure_overlap');
  assert.equal((await call('jefa', 'POST', '/api/admin/closures/delete', { id: made.body.closure.id })).status, 200);
  assert.deepEqual((await call('ana', 'GET', '/api/closures')).body.closures, []);
  assert.equal((await call('jefa', 'POST', '/api/admin/closures/delete', { id: made.body.closure.id })).status, 404);
});

test('extender: con cuotas prendido corre el vencimiento; reabrir lo devuelve (y pide fees.manage)', async () => {
  assert.equal((await call('owner', 'PUT', '/api/owner/billing/enabled', { enabled: true })).status, 200);
  const due = dayAfter(today, 25);
  assert.equal((await call('owner', 'PUT', '/api/admin/users/ana/billing', { planId: 1, dueDate: due })).status, 200);
  const from = dayAfter(today, 2), to = dayAfter(today, 4);
  const pv = await call('owner', 'GET', `/api/admin/closures/preview?from=${from}&to=${to}`);
  assert.deepEqual([pv.body.days, pv.body.extend], [3, { members: 1, trials: 0 }]);
  const made = await call('owner', 'POST', '/api/admin/closures', { from, to, reason: 'Vacaciones', notifyAll: false, extendDays: 3 });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.extended, 1);
  assert.equal(made.body.announceAt, null);
  const billing = async () => (await call('owner', 'GET', '/api/admin/users/ana/billing')).body.billing.dueDate;
  assert.equal(await billing(), dayAfter(due, 3));
  assert.equal((await call('jefa', 'POST', '/api/admin/closures/delete', { id: made.body.closure.id, revert: true })).status, 403);
  const del = await call('owner', 'POST', '/api/admin/closures/delete', { id: made.body.closure.id, revert: true });
  assert.deepEqual([del.status, del.body.reverted], [200, 1]);
  assert.equal(await billing(), due);
});

test('GET /api/admin/user trae los cierres de alrededor de hoy (para la adherencia)', async () => {
  const made = await call('owner', 'POST', '/api/admin/closures', { from: today, to: today, reason: 'Feriado', notifyAll: false });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const u = await call('owner', 'GET', '/api/admin/user?id=ana');
  assert.deepEqual(u.body.closures, [{ from: today, to: today, reason: 'Feriado' }]);
  assert.equal((await call('owner', 'POST', '/api/admin/closures/delete', { id: made.body.closure.id })).status, 200);
});

test('hora de avisos de cierre: 08:00 por defecto, se cambia sola sin tocar la de cuotas', async () => {
  const g = await call('owner', 'GET', '/api/admin/notifications/settings');
  assert.equal(g.body.closure_notify_hour, '08:00');
  const before = g.body.billing_notify_hour;
  const p = await call('owner', 'PUT', '/api/admin/notifications/settings', { closure_notify_hour: '07:30' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.deepEqual([p.body.closure_notify_hour, p.body.billing_notify_hour], ['07:30', before]);
  assert.equal((await call('owner', 'PUT', '/api/admin/notifications/settings', { closure_notify_hour: '7:30' })).status, 400);
  assert.equal((await call('owner', 'PUT', '/api/admin/notifications/settings', {})).status, 400);
  assert.equal((await call('owner', 'PUT', '/api/admin/notifications/settings', { closure_notify_hour: '08:00' })).status, 200);
});

test('anular el último pago después de correr vencimientos: se acepta y vuelve al anterior + los días', async () => {
  const due = dayAfter(today, 25);
  assert.equal((await call('owner', 'PUT', '/api/admin/users/beto/billing', { planId: 1, dueDate: due })).status, 200);
  const pay = await call('owner', 'POST', '/api/admin/users/beto/payments', { planId: 1, amount: 100, method: 'efectivo' });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  const { id: paymentId, previousDueDate, periodEnd } = pay.body.payment;
  assert.equal(previousDueDate, due);
  const from = dayAfter(today, 20);
  const made = await call('owner', 'POST', '/api/admin/closures', { from, to: dayAfter(from, 1), notifyAll: false, extendDays: 2 });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.ok(made.body.extended >= 1);
  const billing = async () => (await call('owner', 'GET', '/api/admin/users/beto/billing')).body.billing.dueDate;
  assert.equal(await billing(), dayAfter(periodEnd, 2));
  const v = await call('owner', 'POST', `/api/admin/users/beto/payments/${paymentId}/void`, { reason: 'error' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(await billing(), dayAfter(due, 2));
  assert.equal((await call('owner', 'POST', '/api/admin/closures/delete', { id: made.body.closure.id, revert: false })).status, 200);
});
