// Ejercicios custom del admin dentro de presets, por HTTP sobre server.js de verdad: el preset
// entrega la definición, el socio recibe su copia por cualquier camino (estado completo, sync
// incremental, asignación del admin), sin duplicar, sin tocar la fila del admin, aunque el admin
// borre el original, y los socios que ya tenían "Unknown exercise" se reparan al arrancar.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-preset-custom-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);

const REMO = { id: 'cx-remo', n: 'Remo en máquina del gym', tipo: 'fuerza', equipamiento: ['leverage machine'], grupo_muscular: 'upper back', bp: 'back', eq: 'leverage machine', tg: 'upper back', mg: 'latissimus dorsi', sm: ['biceps'], st: ['Tirar'] };
const OLD = { id: 'cx-old', n: 'Prensa vieja', tipo: 'fuerza', equipamiento: ['sled machine'], grupo_muscular: 'quads', bp: 'upper legs', eq: 'sled machine', tg: 'quads', mg: 'quads', sm: [], st: [] };

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
db.createUser({ id: 'staff', name: 'Admin', admin: true, created: Date.now() });
for (const id of ['ana', 'beto', 'carla', 'dani']) db.createUser({ id, name: id, created: Date.now() });
// Una base de antes del arreglo: preset con un ejercicio custom del admin, sin snapshot, y una
// socia que lo cargó y lo ve como "Unknown exercise" (sin copia).
db.saveUserState('staff', { customEx: [REMO, OLD], routines: [] });
db.createPreset({ id: 'p-old', name: 'Piernas', emoji: 'legs', groupName: 'Gym', plannedDay: 2, ex: [{ id: 'cx-old', sets: 3, reps: 10 }] });
const raw = db.getDatabase();
raw.exec('DELETE FROM preset_custom_exercises');
raw.prepare('INSERT INTO user_state (user_id, _ts) VALUES (?, ?)').run('carla', 1);
raw.prepare('INSERT INTO routines (id, user_id, name, emoji, created_at) VALUES (?, ?, ?, ?, ?)').run('rc', 'carla', 'Piernas', 'legs', Date.now());
raw.prepare('INSERT INTO routine_exercises (routine_id, exercise_id, position, sets, reps) VALUES (?, ?, ?, ?, ?)').run('rc', 'cx-old', 0, 3, 10);
db.closeDatabase();

const PORT = 48000 + Math.floor(Math.random() * 1500);
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
const state = async uid => (await call(uid, 'GET', '/api/data')).body.state;
const customOf = async (uid, id) => (await state(uid)).customEx.filter(e => e.id === id);
const rows = (sql, ...args) => { db.initDatabase(); try { return db.getDatabase().prepare(sql).all(...args).map(r => ({ ...r })); } finally { db.closeDatabase(); } };
const routine = (id, exId) => ({ id, name: 'Día', emoji: 'dumbbell', ex: [{ id: exId, sets: 3, reps: 10 }] });

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

test('reparación al arrancar: la socia con "Unknown exercise" recibe su copia con el id original', async () => {
  const [ex] = await customOf('carla', 'cx-old');
  assert.equal(ex.n, 'Prensa vieja');
  assert.equal(ex.origin, 'cx-old');
  assert.equal(ex.tg, 'quads');
  assert.deepEqual(rows('SELECT id, user_id, origin_id FROM custom_exercises WHERE origin_id = ?', 'cx-old'), [{ id: 'cx-old@carla', user_id: 'carla', origin_id: 'cx-old' }]);
  // el preset viejo también quedó con su definición guardada
  assert.equal(rows('SELECT id FROM preset_custom_exercises').map(r => r.id).includes('cx-old'), true);
});

test('el preset entrega la definición de sus ejercicios custom (solo esos, no los del catálogo)', async () => {
  const created = await call('staff', 'POST', '/api/admin/presets', { name: 'Espalda', groupName: 'Gym', plannedDay: 4, ex: [{ id: 'cx-remo', sets: 4, reps: 10 }, { id: '0027', sets: 3, reps: 8 }] });
  assert.equal(created.status, 200);
  // Un programa nuevo nace oculto para los socios: el admin lo muestra.
  const program = (await call('staff', 'GET', '/api/admin/presets')).body.programs.find(p => p.name === 'Gym');
  assert.equal((await call('staff', 'POST', '/api/admin/programs/visibility', { id: program.id, visible: true })).status, 200);
  const d = (await call('ana', 'GET', '/api/presets')).body;
  const remo = d.customExercises.find(e => e.id === 'cx-remo');
  assert.equal(remo.n, REMO.n);
  assert.deepEqual(remo.sm, ['biceps']);
  assert.equal(d.customExercises.some(e => e.id === '0027'), false);
  assert.equal(d.presets.find(p => p.name === 'Espalda').ex[0].def, undefined);
});

test('camino del socio (estado completo, como Home / Ajustes / Plan): copia propia, sin duplicar al aplicar dos veces', async () => {
  const put = () => call('ana', 'PUT', '/api/data', { state: { routines: [routine('ra', 'cx-remo')], customEx: [{ ...REMO, origin: 'cx-remo' }] } });
  assert.equal((await put()).status, 200);
  assert.equal((await put()).status, 200);
  const list = await customOf('ana', 'cx-remo');
  assert.equal(list.length, 1);
  assert.equal(list[0].origin, 'cx-remo');
  assert.equal(rows('SELECT COUNT(*) AS n FROM custom_exercises WHERE user_id = ? AND origin_id = ?', 'ana', 'cx-remo')[0].n, 1);
  // la fila del admin sigue siendo del admin
  assert.deepEqual(rows('SELECT user_id FROM custom_exercises WHERE id = ?', 'cx-remo'), [{ user_id: 'staff' }]);
});

test('camino del sync incremental con un cliente que no manda la definición: el servidor copia igual', async () => {
  await call('beto', 'PUT', '/api/data', { state: { routines: [], customEx: [] } });
  const r = await call('beto', 'POST', '/api/data/sync', { operations: [{ id: 'op1', createdAt: 1, changes: [{ path: ['routines', 'rb'], op: 'add', value: routine('rb', 'cx-remo') }] }] });
  assert.deepEqual(r.body.appliedIds, ['op1']);
  assert.equal((await customOf('beto', 'cx-remo'))[0].n, REMO.n);
});

test('camino del admin (Asignar a socio): el grupo asignado trae la copia', async () => {
  const r = await call('staff', 'PUT', '/api/admin/users/dani/routines', {
    routines: [], week: {}, dayPlan: {}, activeGroupId: 'g1',
    routineGroups: [{ id: 'g1', name: 'Gym', routines: [routine('rd', 'cx-remo')], week: {}, source: { kind: 'preset', programId: 'x', at: 1 } }]
  });
  assert.equal(r.status, 200);
  assert.equal((await customOf('dani', 'cx-remo'))[0].origin, 'cx-remo');
});

test('un socio no puede pisar el ejercicio del admin mandando su id', async () => {
  await call('ana', 'PUT', '/api/data', { state: { routines: [], customEx: [{ id: 'cx-remo', n: 'hackeado' }] } });
  assert.deepEqual(rows('SELECT user_id, n FROM custom_exercises WHERE id = ?', 'cx-remo'), [{ user_id: 'staff', n: REMO.n }]);
  // y su copia sigue ahí: las copias no se borran por faltar en el estado
  assert.equal((await customOf('ana', 'cx-remo')).length, 1);
});

test('el admin borra el original: las copias quedan y un socio nuevo lo recibe del snapshot', async () => {
  await call('staff', 'PUT', '/api/data', { state: { routines: [], customEx: [OLD] } });
  assert.deepEqual(rows('SELECT id FROM custom_exercises WHERE id = ?', 'cx-remo'), []);
  assert.equal((await customOf('beto', 'cx-remo'))[0].n, REMO.n);
  assert.equal((await call('ana', 'GET', '/api/presets')).body.customExercises.find(e => e.id === 'cx-remo').n, REMO.n);
  await call('carla', 'PUT', '/api/data', { state: { routines: [routine('rc2', 'cx-remo')], customEx: [] } });
  assert.equal((await customOf('carla', 'cx-remo'))[0].n, REMO.n);
});

test('el socio que edita su copia la conserva editada', async () => {
  const [mine] = await customOf('beto', 'cx-remo');
  await call('beto', 'PUT', '/api/data', { state: { routines: [routine('rb', 'cx-remo')], customEx: [{ ...mine, n: 'Mi remo' }] } });
  const [after] = await customOf('beto', 'cx-remo');
  assert.equal(after.n, 'Mi remo');
  assert.equal(rows('SELECT COUNT(*) AS n FROM custom_exercises WHERE user_id = ?', 'beto')[0].n, 1);
});
