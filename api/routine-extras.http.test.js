// Campos de los ejercicios de rutina sin columna propia (intensificador, reps objetivo,
// calentamiento, progresión doble, bodyweight:false) por HTTP: ida y vuelta por el sync
// incremental, el estado completo y los endpoints admin; un dispositivo nuevo los recibe; un
// cliente viejo (sin el header X-Lauyim-Client) no los borra al mandar el ejercicio sin ellos.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-routine-extras-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
db.createUser({ id: 'staff', name: 'Admin', admin: true, created: Date.now() });
db.createUser({ id: 'ana', name: 'Ana', created: Date.now() });
db.saveUserState('ana', { routines: [] });
db.closeDatabase();

const PORT = 49600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
const NEW = { 'X-Lauyim-Client': 'routine-extras' };
function cookie(uid) {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
async function call(uid, method, url, body, headers = NEW) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie(uid), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const routinesOf = async uid => (await call(uid, 'GET', '/api/data')).body.state.routines;
let opN = 0;
const sync = (uid, changes, headers) => call(uid, 'POST', '/api/data/sync', { operations: [{ id: 'op' + (++opN), createdAt: opN, changes }] }, headers);

const DROP = { type: 'dropset', count: 2, pct: 80, dropRestSec: 5 };
const BENCH = { id: '0025', sets: 4, reps: 8, weight: 60, repsMin: 6, warmupSets: 2, intensifier: DROP, prog: 'double', inc: 2.5, note: 'pirámide', sg: 'a' };
const ROW = { id: '0027', sets: 3, reps: 10, weight: 40, sg: 'a', bodyweight: false };
const ROUTINE = { id: 'r1', name: 'Torso', emoji: 'barbell', ex: [BENCH, ROW] };

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

test('dispositivo A configura drop-set + calentamiento → sync → dispositivo B (estado limpio) los recibe', async () => {
  const r = await sync('ana', [{ path: ['routines', 'r1'], op: 'add', value: ROUTINE }]);
  assert.equal(r.body.appliedIds.length, 1);
  // B: estado limpio, lo único que tiene es lo que baja de GET /api/data
  const [routine] = await routinesOf('ana');
  assert.deepEqual(routine.ex[0].intensifier, DROP);
  assert.equal(routine.ex[0].warmupSets, 2);
  assert.equal(routine.ex[0].repsMin, 6);
  assert.equal(routine.ex[0].prog, 'double');
  assert.equal(routine.ex[0].inc, 2.5);
  assert.equal(routine.ex[0].note, 'pirámide');
  assert.equal(routine.ex[0].sg, 'a');
  assert.equal(routine.ex[1].bodyweight, false);
  assert.equal(routine.ex[1].sg, 'a');
});

test('un cambio de otro campo de la rutina (sync por campo) no pierde los extras', async () => {
  await sync('ana', [{ path: ['routines', 'r1', 'name'], op: 'replace', value: 'Torso A' }]);
  const [routine] = await routinesOf('ana');
  assert.equal(routine.name, 'Torso A');
  assert.deepEqual(routine.ex[0].intensifier, DROP);
});

test('cliente viejo (sin header) manda el ejercicio sin los campos: se conservan, aunque reordene', async () => {
  const lossy = { id: 'r1', name: 'Torso A', emoji: 'barbell', ex: [{ id: '0027', sets: 3, reps: 12, weight: 40 }, { id: '0025', sets: 5, reps: 8, weight: 62.5 }] };
  await sync('ana', [{ path: ['routines', 'r1'], op: 'replace', value: lossy }], {});
  const [routine] = await routinesOf('ana');
  assert.equal(routine.ex[0].id, '0027');
  assert.equal(routine.ex[0].reps, 12);                   // lo que sí mandó se guarda
  assert.equal(routine.ex[0].bodyweight, false);
  assert.equal(routine.ex[1].sets, 5);
  assert.deepEqual(routine.ex[1].intensifier, DROP);       // lo que no conoce, no se borra
  assert.equal(routine.ex[1].warmupSets, 2);
  // y el estado completo (PUT) de un cliente viejo tampoco
  await call('ana', 'PUT', '/api/data', { state: { routines: [lossy] } }, {});
  assert.deepEqual((await routinesOf('ana'))[0].ex[1].intensifier, DROP);
});

test('cliente nuevo que saca el intensificador: se borra (la ausencia es la verdad)', async () => {
  const [current] = await routinesOf('ana');
  const next = { ...current, ex: current.ex.map(e => e.id === '0025' ? { ...e, intensifier: undefined } : e) };
  await sync('ana', [{ path: ['routines', 'r1'], op: 'replace', value: next }]);
  const [routine] = await routinesOf('ana');
  assert.equal(routine.ex[1].intensifier, undefined);
  assert.equal(routine.ex[1].warmupSets, 2);
});

test('endpoints admin de rutinas del socio: ida y vuelta con los extras', async () => {
  const got = await call('staff', 'GET', '/api/admin/users/ana/routines');
  assert.equal(got.body.routines[0].ex[1].warmupSets, 2);
  const edited = got.body.routines.map(r => ({ ...r, ex: r.ex.map(e => e.id === '0025' ? { ...e, intensifier: { type: 'restpause', totalReps: 10, restSec: 20 } } : e) }));
  const put = await call('staff', 'PUT', '/api/admin/users/ana/routines', { routines: edited, week: {}, dayPlan: {} });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.routines[0].ex[1].intensifier, { type: 'restpause', totalReps: 10, restSec: 20 });
  assert.deepEqual((await routinesOf('ana'))[0].ex[1].intensifier, { type: 'restpause', totalReps: 10, restSec: 20 });
});
