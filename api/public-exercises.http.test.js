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
