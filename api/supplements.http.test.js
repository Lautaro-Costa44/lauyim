// Suplementos sobre server.js de verdad: apagado por el owner, aviso obligatorio, menores, ventana de
// fechas, proteína como comida, aislamiento por usuario y sin consentimiento de salud. Puertos 52000–52900.
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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-supp-http-'));
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
process.env.DATA_DIR = dataDir;
const today = gymToday(Date.now(), 'America/Argentina/Buenos_Aires');
const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
for (const id of ['ana', 'beto', 'nene']) db.createUser({ id, name: id, created: Date.now(), healthConsent: true });
db.createUser({ id: 'nosalud', name: 'nosalud', created: Date.now(), healthConsent: false });
db.getDatabase().prepare('INSERT OR IGNORE INTO user_state (user_id, _ts) VALUES (?, ?)').run('nene', Date.now());
db.getDatabase().prepare('UPDATE user_state SET edad = 15 WHERE user_id = ?').run('nene');
db.closeDatabase();

const PORT = 52000 + Math.floor(Math.random() * 900);
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

const creatina = { id: 'crea0001', catalogId: 'creatina', dose: 5, unit: 'g', scoopG: 5, doses: 1, slot: 'morning', days: 'daily', reminderTime: '09:00' };

test('sin sesión 401; sin consentimiento de salud 403; /api/config lo informa', async () => {
  assert.equal((await call(null, 'GET', '/api/supplements')).status, 401);
  assert.equal((await call('nosalud', 'GET', '/api/supplements')).body.error, 'health_consent_required');
  assert.equal((await call(null, 'GET', '/api/config')).body.supplements_enabled, true);
});

test('el aviso es obligatorio para escribir y vale solo la versión vigente', async () => {
  const first = (await call('ana', 'GET', '/api/supplements')).body;
  assert.deepEqual([first.enabled, first.profile.ackVersion, first.adult, first.items, first.logs], [true, null, 'unknown', [], []]);
  assert.equal((await call('ana', 'POST', '/api/supplements/items', creatina)).body.error, 'supplements_ack_required');
  assert.equal((await call('ana', 'POST', '/api/supplements/ack', { version: '2000-01-01' })).status, 409);
  assert.equal((await call('ana', 'POST', '/api/supplements/ack', { version: first.ackVersion, adult: true })).status, 200);
  assert.equal((await call('ana', 'GET', '/api/supplements')).body.adult, 'adult');
});

test('menor: puede aceptar el aviso pero no seguir suplementos', async () => {
  const v = (await call('nene', 'GET', '/api/supplements')).body.ackVersion;
  await call('nene', 'POST', '/api/supplements/ack', { version: v, adult: true });
  assert.equal((await call('nene', 'GET', '/api/supplements')).body.adult, 'minor');
  assert.equal((await call('nene', 'POST', '/api/supplements/items', { ...creatina, id: 'crea0002' })).body.error, 'supplements_minor');
});

test('items y tomas: alta, ventana de fechas, aislamiento y archivo', async () => {
  assert.equal((await call('ana', 'POST', '/api/supplements/items', creatina)).body.item.dose, 5);
  assert.equal((await call('ana', 'POST', '/api/supplements/log', { id: 'log00001', itemId: 'crea0001', date: today, amount: 5 })).status, 200);
  assert.equal((await call('ana', 'POST', '/api/supplements/log', { id: 'log00002', itemId: 'crea0001', date: addDays(today, 3), amount: 5 })).status, 400);
  assert.equal((await call('ana', 'POST', '/api/supplements/log', { id: 'log00003', source: 'mate', date: today, amount: 80 })).status, 200);
  const mine = (await call('ana', 'GET', '/api/supplements')).body;
  assert.equal(mine.logs.length, 2);
  assert.equal((await call('beto', 'GET', '/api/supplements')).body.items.length, 0);
  const v = mine.ackVersion;
  await call('beto', 'POST', '/api/supplements/ack', { version: v, adult: true });
  assert.equal((await call('beto', 'POST', '/api/supplements/log/delete', { id: 'log00001' })).status, 404);
  assert.equal((await call('ana', 'POST', '/api/supplements/items/archive', { id: 'crea0001', archived: true })).body.item.status, 'archived');
  assert.equal((await call('ana', 'POST', '/api/supplements/log/delete', { id: 'log00003' })).status, 200);
});

test('proteína: la toma crea la comida y borrarla la saca', async () => {
  const prot = { id: 'prot0001', catalogId: 'proteina', dose: 30, unit: 'g', scoopG: 30, doses: 1, slot: 'post', days: 'daily', meta: { macros: { proteina: 24, calorias: 120, carbos: 3, grasas: 1.5 } } };
  await call('ana', 'POST', '/api/supplements/items', prot);
  const log = (await call('ana', 'POST', '/api/supplements/log', { id: 'plog0001', itemId: 'prot0001', date: today, amount: 30 })).body.log;
  assert.ok(log.comidaId);
  const meals = (await call('ana', 'GET', `/api/comidas?fecha=${today}`)).body;
  assert.equal(meals.find(m => m.id === log.comidaId).proteina, 24);
  await call('ana', 'POST', '/api/supplements/log/delete', { id: 'plog0001' });
  assert.equal((await call('ana', 'GET', `/api/comidas?fecha=${today}`)).body.some(m => m.id === log.comidaId), false);
});

test('el owner lo apaga: 404 para el socio y la config lo dice; se vuelve a prender', async () => {
  assert.equal((await call('ana', 'PUT', '/api/owner/supplements', { enabled: false })).status, 403);
  assert.deepEqual((await call('owner', 'PUT', '/api/owner/supplements', { enabled: false })).body, { enabled: false });
  assert.equal((await call('ana', 'GET', '/api/supplements')).status, 404);
  assert.equal((await call(null, 'GET', '/api/config')).body.supplements_enabled, false);
  assert.deepEqual((await call('owner', 'GET', '/api/owner/supplements')).body, { enabled: false });
  await call('owner', 'PUT', '/api/owner/supplements', { enabled: true });
  assert.equal((await call('ana', 'GET', '/api/supplements')).status, 200);
});
