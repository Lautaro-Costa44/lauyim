// Suplementos para el staff (etapa 2) sobre server.js de verdad: el Nutricionista ve lo mínimo (tomas
// sin hora ni fuente, cafeína solo de los días con exceso) y deshabilita con motivo; sin permiso 403,
// sin consentimiento 409, y con el módulo apagado no hay nada. Puertos 53000–53900.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gymToday } from './billing.js';
import { addDays } from './classes.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-supp-staff-'));
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
process.env.DATA_DIR = dataDir;
const today = gymToday(Date.now(), 'America/Argentina/Buenos_Aires');
const db = await import('./database.js');
const sdb = await import('./supplements-db.js');
const { SUPP_ACK_VERSION } = await import('./supplements.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
for (const id of ['nutri', 'recep', 'ana']) db.createUser({ id, name: id, created: Date.now(), healthConsent: true });
db.createUser({ id: 'nosalud', name: 'nosalud', created: Date.now(), healthConsent: false });
db.setUserRole('nutri', 'nutrition');
db.setUserRole('recep', 'reception');
sdb.setAck('ana', SUPP_ACK_VERSION, 1);
sdb.saveItem('ana', { id: 'crea0001', catalogId: 'creatina', dose: 5, unit: 'g', doses: 1, slot: 'morning', days: 'daily', reminderTimes: [] });
sdb.addLog('ana', { id: 'l0000001', itemId: 'crea0001', date: addDays(today, -2), amount: 15 });
sdb.addLog('ana', { id: 'l0000002', itemId: 'crea0001', date: addDays(today, -2), amount: 10 });
sdb.addLog('ana', { id: 'l0000003', itemId: 'crea0001', date: addDays(today, -1), amount: 5 });
for (let i = 0; i < 4; i++) sdb.addLog('ana', { id: 'mate000' + i, itemId: null, source: 'mate', date: addDays(today, -3), amount: 130 });
sdb.addLog('ana', { id: 'mate0009', itemId: null, source: 'mate', date: addDays(today, -1), amount: 130 });
db.closeDatabase();

const PORT = 53000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
const cookie = uid => { const payload = `${uid}:${Date.now() + 3600000}:0`; return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url'); };
async function call(uid, method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Cookie = cookie(uid);
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
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

test('nutricionista: items, tomas sin hora ni fuente y cafeína solo de días con exceso', async () => {
  const r = await call('nutri', 'GET', '/api/admin/users/ana/supplements');
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true);
  assert.equal(r.body.items[0].catalogId, 'creatina');
  assert.equal(r.body.logs.length, 3);
  assert.ok(r.body.logs.every(l => Object.keys(l).sort().join() === 'amount,date,itemId'));
  assert.deepEqual(r.body.caffeine, [{ date: addDays(today, -3), mg: 520 }]);
  assert.ok(Array.isArray(r.body.plan.workoutDates));
  assert.deepEqual(r.body.access, { disabled: false, reason: null, at: null });
});

test('sin permiso 403; sin consentimiento 409', async () => {
  assert.equal((await call('recep', 'GET', '/api/admin/users/ana/supplements')).status, 403);
  assert.equal((await call('recep', 'PUT', '/api/admin/users/ana/supplements/access', { enabled: false })).status, 403);
  assert.equal((await call('nutri', 'GET', '/api/admin/users/nosalud/supplements')).body.error, 'no_health_consent');
});

test('deshabilitar con motivo: el socio lo ve y no puede escribir; habilitar borra el motivo', async () => {
  const off = await call('nutri', 'PUT', '/api/admin/users/ana/supplements/access', { enabled: false, reason: 'Por indicación médica' });
  assert.equal(off.status, 200);
  assert.equal(off.body.access.disabled, true);
  assert.deepEqual((await call('ana', 'GET', '/api/supplements')).body.disabled, { reason: 'Por indicación médica' });
  assert.equal((await call('ana', 'POST', '/api/supplements/log', { id: 'logoff01', source: 'mate', date: today, amount: 130 })).body.error, 'supplements_disabled');
  assert.equal((await call('nutri', 'PUT', '/api/admin/users/ana/supplements/access', { enabled: false, reason: 'x'.repeat(121) })).status, 400);
  const on = await call('nutri', 'PUT', '/api/admin/users/ana/supplements/access', { enabled: true, reason: 'ignorado' });
  assert.deepEqual([on.body.access.disabled, on.body.access.reason], [false, null]);
  assert.equal((await call('ana', 'GET', '/api/supplements')).body.disabled, null);
  const audit = await call('owner', 'GET', '/api/admin/audit?limit=50');
  assert.ok(JSON.stringify(audit.body).includes('admin.supplements.disabled'));
});

test('módulo apagado por el owner: enabled false y nada más', async () => {
  await call('owner', 'PUT', '/api/owner/supplements', { enabled: false });
  assert.deepEqual((await call('nutri', 'GET', '/api/admin/users/ana/supplements')).body, { enabled: false });
  await call('owner', 'PUT', '/api/owner/supplements', { enabled: true });
});
