// Ejercicios compartidos por el staff y el interruptor de gifs, por HTTP sobre server.js de verdad:
// el endpoint guarda solo los campos conocidos (con sus límites), rechaza lo inválido, no lo deja
// usar a un socio, y /api/config dice si los gifs del catálogo están encendidos.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-public-ex-'));
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
process.env.DATA_DIR = dataDir;

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'staff', name: 'Admin', admin: true, created: Date.now() });
db.createUser({ id: 'ana', name: 'Ana', created: Date.now() });
db.saveUserState('ana', { customEx: [], routines: [] });
db.createUser({ id: 'beto', name: 'Beto', created: Date.now() });
db.saveUserState('beto', { customEx: [], routines: [], workouts: [{ id: 'wb1', d: '2026-09-20', start: 1, end: 2, name: 'Core', entries: [{ id: 'cpub4', sets: [{ w: 10, r: 10, done: true }] }] }] });
db.closeDatabase();

const PORT = 49500 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
function cookie(uid) {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
async function call(uid, method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Cookie = cookie(uid);
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '', EXERCISE_GIFS: '0' },
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

test('/api/config: EXERCISE_GIFS=0 apaga los gifs del catálogo', async () => {
  const { body } = await call(null, 'GET', '/api/config');
  assert.equal(body.exercise_gifs, false);
});

test('el staff comparte un ejercicio: se guardan solo los campos conocidos y lo ve el socio', async () => {
  const sent = { id: 'cpub1', n: 'Remo en polea', tipo: 'fuerza', bp: 'back', tg: 'back', sm: ['biceps'], st: ['Sentate.', 'Tirá.'], desc: 'Agarre neutro', map: true, hack: 'x', custom: true, shared: true };
  assert.equal((await call('staff', 'POST', '/api/admin/public-exercises', sent)).status, 200);
  const { body } = await call('ana', 'GET', '/api/data');
  const ex = body.state.customEx.find(e => e.id === 'cpub1');
  assert.equal(ex.shared, true);
  assert.equal(ex.desc, 'Agarre neutro');
  assert.deepEqual(ex.st, ['Sentate.', 'Tirá.']);
  assert.equal(ex.map, true);
  assert.equal('hack' in ex, false);
});

test('un ejercicio compartido sin nombre se rechaza, y un socio no puede compartir', async () => {
  assert.equal((await call('staff', 'POST', '/api/admin/public-exercises', { id: 'cpub2', n: '  ' })).status, 400);
  assert.equal((await call('ana', 'POST', '/api/admin/public-exercises', { id: 'cpub3', n: 'Plancha' })).status, 403);
});

test('dejar de compartir: el socio que lo usaba se queda con su copia y el admin con el original', async () => {
  const ex = { id: 'cpub4', n: 'Press Pallof', tipo: 'fuerza', bp: 'waist', tg: 'abs', st: ['Pará firme.'], map: true };
  assert.equal((await call('staff', 'POST', '/api/admin/public-exercises', ex)).status, 200);
  assert.equal((await call('ana', 'POST', '/api/admin/public-exercises/unshare', { id: 'cpub4' })).status, 403);
  const res = await call('staff', 'POST', '/api/admin/public-exercises/unshare', { id: 'cpub4' });
  assert.equal(res.status, 200);
  assert.equal(res.body.copies, 1);
  const beto = (await call('beto', 'GET', '/api/data')).body.state.customEx.filter(e => e.id === 'cpub4');
  assert.equal(beto.length, 1);
  assert.equal(beto[0].origin, 'cpub4');
  assert.equal((await call('ana', 'GET', '/api/data')).body.state.customEx.some(e => e.id === 'cpub4'), false);
  assert.equal((await call('staff', 'POST', '/api/admin/public-exercises/unshare', { id: 'cpub4' })).status, 404);
});

test('/api/health: responde ok sin revelar cuántos socios hay (lo consultan monitores públicos)', async () => {
  const { status, body } = await call(null, 'GET', '/api/health');
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true });
});
