// plan_iniciado por HTTP: se prende al tener una rutina (estado completo, sync, admin), al
// elegir un programa o descartar el cartel (el cliente manda planIniciado); nunca se apaga
// (tampoco con un cliente viejo que no conoce el campo ni tras borrar todas las rutinas); viaja
// a otro dispositivo en GET /api/data; y el backfill prende a quien ya tenía o tuvo algo.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-plan-iniciado-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
db.createUser({ id: 'staff', name: 'Admin', admin: true, created: Date.now() });
for (const id of ['nuevo', 'rutina', 'entreno', 'eligio', 'grupos', 'nada', 'sync', 'admin', 'descarta']) db.createUser({ id, name: id, created: Date.now() });
// Estado de antes del flag (plan_iniciado en 0), armado directo en la base.
const raw = db.getDatabase();
const insertState = raw.prepare('INSERT INTO user_state (user_id, _ts, estado_inicial, routine_groups, plan_iniciado) VALUES (?, ?, ?, ?, 0)');
insertState.run('rutina', 1, 'pendiente', null);
raw.prepare('INSERT INTO routines (id, user_id, name, emoji, created_at) VALUES (?, ?, ?, ?, ?)').run('r', 'rutina', 'R', 'x', 1);
insertState.run('entreno', 1, 'pendiente', null);
raw.prepare("INSERT INTO workouts (id, user_id, date, start, end, name) VALUES ('w1', 'entreno', '2026-01-01', 1, 2, 'W')").run();
insertState.run('eligio', 1, 'plan_manual', null);
insertState.run('grupos', 1, 'pendiente', JSON.stringify([{ id: 'g', name: 'G', routines: [{ id: 'x', name: 'X', ex: [] }] }]));
insertState.run('nada', 1, 'pendiente', JSON.stringify([{ id: 'g', name: 'Mi Plan', routines: [] }]));
db.closeDatabase();

const PORT = 49900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
function cookie(uid) {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
async function call(uid, method, url, body) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie(uid) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const flag = async uid => (await call(uid, 'GET', '/api/data')).body.state?.planIniciado;
const R = { id: 'r1', name: 'Día', emoji: 'dumbbell', ex: [{ id: '0025', sets: 3, reps: 8 }] };

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], { env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
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

test('backfill: quien tiene o tuvo rutinas, entrenamientos, grupos con rutinas o ya eligió, queda prendido', async () => {
  assert.equal(await flag('rutina'), true);
  assert.equal(await flag('entreno'), true);
  assert.equal(await flag('eligio'), true);
  assert.equal(await flag('grupos'), true);
  assert.equal(await flag('nada'), false);            // solo un grupo vacío: nunca empezó
  // idempotente y adelanta _ts para que el dispositivo baje el estado
  db.initDatabase();
  try {
    const rows = db.getDatabase().prepare("SELECT user_id, plan_iniciado, _ts FROM user_state WHERE user_id IN ('rutina', 'nada')").all();
    assert.ok(rows.find(r => r.user_id === 'rutina')._ts > 1);
    assert.equal(rows.find(r => r.user_id === 'nada')._ts, 1);
  } finally { db.closeDatabase(); }
});

test('socio nuevo: apagado; al crear su primera rutina se prende y no se apaga al borrarla', async () => {
  await call('nuevo', 'PUT', '/api/data', { state: { routines: [] } });
  assert.equal(await flag('nuevo'), false);
  await call('nuevo', 'PUT', '/api/data', { state: { routines: [R] } });
  assert.equal(await flag('nuevo'), true);
  await call('nuevo', 'PUT', '/api/data', { state: { routines: [], planIniciado: false } });
  assert.equal(await flag('nuevo'), true);
  // un cliente viejo que no conoce el campo tampoco lo apaga
  await call('nuevo', 'PUT', '/api/data', { state: { routines: [] } });
  assert.equal(await flag('nuevo'), true);
});

test('descartar el cartel (sync del flag sin rutinas) lo prende y viaja a otro dispositivo', async () => {
  await call('descarta', 'PUT', '/api/data', { state: { routines: [] } });
  const r = await call('descarta', 'POST', '/api/data/sync', { operations: [{ id: 'd1', createdAt: 1, changes: [{ path: ['planIniciado'], op: 'add', value: true }] }] });
  assert.deepEqual(r.body.appliedIds, ['d1']);
  assert.equal(await flag('descarta'), true);   // GET /api/data = el estado que baja un dispositivo nuevo
});

test('una rutina por sync incremental lo prende', async () => {
  await call('sync', 'PUT', '/api/data', { state: { routines: [] } });
  await call('sync', 'POST', '/api/data/sync', { operations: [{ id: 's1', createdAt: 1, changes: [{ path: ['routines', 'r-sync'], op: 'add', value: { ...R, id: 'r-sync' } }] }] });
  assert.equal(await flag('sync'), true);
});

test('rutinas cargadas por un admin lo prenden', async () => {
  await call('admin', 'PUT', '/api/data', { state: { routines: [] } });
  assert.equal((await call('staff', 'PUT', '/api/admin/users/admin/routines', { routines: [{ ...R, id: 'r-admin' }], week: {}, dayPlan: {} })).status, 200);
  assert.equal(await flag('admin'), true);
});
