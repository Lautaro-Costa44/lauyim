// Presets y programas por HTTP, sobre server.js de verdad: campos del ejercicio que antes se
// perdían, programas con id (canónicos sin distinguir mayúsculas), orden de días, duplicar,
// renombrar y el conteo de uso a partir de source.programId en los grupos del socio.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-presets-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
db.createUser({ id: 'staff', name: 'Admin', admin: true, created: Date.now() });
for (const id of ['ana', 'beto', 'off']) db.createUser({ id, name: id, created: Date.now() });
db.updateUser('off', { disabled: true });
db.closeDatabase();

const PORT = 46000 + Math.floor(Math.random() * 2000);
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
const presets = async () => (await call('staff', 'GET', '/api/presets')).body;

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

test('el seed PPL queda en un programa con id y los días en orden lunes → viernes', async () => {
  const d = await presets();
  assert.equal(d.programs.length, 1);
  assert.equal(d.programs[0].name, 'General');
  assert.equal(d.programs[0].count, 3);
  assert.deepEqual(d.presets.map(p => p.id), ['starter-push', 'starter-pull', 'starter-legs']);
  assert.ok(d.presets.every(p => p.program_id === d.programs[0].id));
  // la forma que lee la app del socio sigue igual
  assert.deepEqual(d.groups.map(g => [g.name, g.count]), [['General', 3]]);
  assert.equal(d.presets[0].group_name, 'General');
  assert.equal(d.presets[0].planned_day, 1);
});

test('intensificador, reps objetivo, calentamiento, nota y progresión sobreviven crear y editar', async () => {
  const ex = [{
    id: '0025', sets: 4, reps: 8, weight: 60, repsMin: 6, warmupSets: 2, note: '  pirámide  ', prog: 'double', inc: 2.5,
    intensifier: { type: 'dropset', count: 2, pct: 80, dropRestSec: 5, junk: 'x' },
    progressionType: 'linear', progressionConfig: { step: 2.5 }
  }, { id: '0047', sets: 3, reps: 10, bodyweight: false, intensifier: { type: 'nope' } }];
  const created = await call('staff', 'POST', '/api/admin/presets', { name: 'Torso A', groupName: 'Torso / Pierna', plannedDay: 1, ex });
  assert.equal(created.status, 200);
  const saved = created.body.preset;
  assert.deepEqual(saved.ex[0].intensifier, { type: 'dropset', count: 2, pct: 80, dropRestSec: 5 });
  assert.equal(saved.ex[0].repsMin, 6);
  assert.equal(saved.ex[0].warmupSets, 2);
  assert.equal(saved.ex[0].note, 'pirámide');
  assert.equal(saved.ex[0].prog, 'double');
  assert.equal(saved.ex[0].inc, 2.5);
  assert.equal(saved.ex[0].progressionType, 'linear');
  assert.deepEqual(saved.ex[0].progressionConfig, { step: 2.5 });
  assert.equal(saved.ex[1].bodyweight, false);
  assert.equal(saved.ex[1].intensifier, undefined);

  // editar ya no pierde la progresión (updatePreset no la insertaba)
  const updated = await call('staff', 'PUT', '/api/admin/presets', { ...saved, groupName: saved.group_name, plannedDay: saved.planned_day, name: 'Torso A1' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.preset.name, 'Torso A1');
  assert.equal(updated.body.preset.ex[0].progressionType, 'linear');
  assert.deepEqual(updated.body.preset.ex[0].intensifier, { type: 'dropset', count: 2, pct: 80, dropRestSec: 5 });
});

test('el nombre del programa es canónico sin distinguir mayúsculas', async () => {
  const r = await call('staff', 'POST', '/api/admin/presets', { name: 'Pierna A', groupName: 'torso / PIERNA', plannedDay: 2, ex: [{ id: '0043', sets: 3, reps: 8 }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.preset.group_name, 'Torso / Pierna');
  const d = await presets();
  assert.equal(d.programs.find(p => p.name === 'Torso / Pierna').count, 2);
  // el día ocupado sigue siendo por programa
  const clash = await call('staff', 'POST', '/api/admin/presets', { name: 'Otro', groupName: 'Torso / Pierna', plannedDay: 2, ex: [] });
  assert.equal(clash.status, 409);
});

test('reordenar exige exactamente los días del programa', async () => {
  const d = await presets();
  const program = d.programs.find(p => p.name === 'Torso / Pierna');
  const ids = d.presets.filter(p => p.program_id === program.id).map(p => p.id);
  assert.equal((await call('staff', 'POST', '/api/admin/presets/reorder', { programId: program.id, ids: ids.slice(1) })).status, 409);
  assert.equal((await call('ana', 'POST', '/api/admin/presets/reorder', { programId: program.id, ids: [...ids].reverse() })).status, 403);
  assert.equal((await call('staff', 'POST', '/api/admin/presets/reorder', { programId: program.id, ids: [...ids].reverse() })).status, 200);
  const after = await presets();
  assert.deepEqual(after.presets.filter(p => p.program_id === program.id).map(p => p.id), [...ids].reverse());
});

test('duplicar un día: mismo programa, justo después, sin día planeado', async () => {
  const d = await presets();
  const r = await call('staff', 'POST', '/api/admin/presets/duplicate', { id: 'starter-pull' });
  assert.equal(r.status, 200);
  assert.equal(r.body.preset.name, 'Pull Day (copia)');
  assert.equal(r.body.preset.planned_day, null);
  assert.equal(r.body.preset.ex.length, d.presets.find(p => p.id === 'starter-pull').ex.length);
  const after = await presets();
  const general = after.presets.filter(p => p.group_name === 'General').map(p => p.name);
  assert.deepEqual(general, ['Push Day', 'Pull Day', 'Pull Day (copia)', 'Leg Day']);
  await call('staff', 'POST', '/api/admin/presets/delete', { id: r.body.preset.id });
});

test('duplicar y renombrar un programa', async () => {
  const d = await presets();
  const general = d.programs.find(p => p.name === 'General');
  const dup = await call('staff', 'POST', '/api/admin/programs/duplicate', { id: general.id });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.program.name, 'General (copia)');
  const dup2 = await call('staff', 'POST', '/api/admin/programs/duplicate', { id: general.id });
  assert.equal(dup2.body.program.name, 'General (copia 2)');
  const after = await presets();
  const copy = after.presets.filter(p => p.program_id === dup.body.program.id);
  assert.deepEqual(copy.map(p => [p.name, p.planned_day]), [['Push Day', 1], ['Pull Day', 3], ['Leg Day', 5]]);

  assert.equal((await call('staff', 'PUT', '/api/admin/programs', { id: dup2.body.program.id, name: 'general (COPIA)' })).status, 409);
  const renamed = await call('staff', 'PUT', '/api/admin/programs', { id: dup2.body.program.id, name: 'PPL 2' });
  assert.equal(renamed.status, 200);
  const final = await presets();
  assert.equal(final.presets.filter(p => p.group_name === 'PPL 2').length, 3);
  assert.equal(final.programs.find(p => p.id === dup2.body.program.id).name, 'PPL 2');

  // borrar todos los días de un programa lo borra
  for (const p of final.presets.filter(p => p.group_name === 'PPL 2')) await call('staff', 'POST', '/api/admin/presets/delete', { id: p.id });
  assert.equal((await presets()).programs.some(p => p.id === dup2.body.program.id), false);
});

test('uso: socios activos con el programa cargado (source.programId), y cuántos lo tienen activo', async () => {
  const { programs } = await presets();
  const general = programs.find(p => p.name === 'General');
  const torso = programs.find(p => p.name === 'Torso / Pierna');
  const put = (uid, groups, activeGroupId) => call('staff', 'PUT', `/api/admin/users/${uid}/routines`, {
    routines: [], week: {}, dayPlan: {}, activeGroupId,
    routineGroups: groups.map(([id, programId]) => ({ id, name: 'G ' + id, routines: [], week: {}, source: programId ? { kind: 'preset', programId, at: 1 } : undefined }))
  });
  assert.equal((await put('ana', [['a1', general.id], ['a2', torso.id]], 'a1')).status, 200);
  assert.equal((await put('beto', [['b1', general.id], ['b2', null]], 'b2')).status, 200);
  // un socio desactivado no cuenta (se carga directo: el PUT admin lo rechaza)
  db.initDatabase();
  db.saveRoutineGroups('off', [{ id: 'o1', name: 'x', routines: [], week: {}, source: { kind: 'preset', programId: general.id } }], 'o1');
  db.closeDatabase();

  const got = await call('staff', 'GET', '/api/admin/programs/usage');
  assert.equal(got.status, 200);
  assert.deepEqual(got.body.usage[general.id], { users: 2, active: 1 });
  assert.deepEqual(got.body.usage[torso.id], { users: 1, active: 0 });
  assert.equal((await call('ana', 'GET', '/api/admin/programs/usage')).status, 403);

  // el GET de rutinas del socio devuelve source tal cual
  const routines = await call('staff', 'GET', '/api/admin/users/ana/routines');
  assert.deepEqual(routines.body.routineGroups[0].source, { kind: 'preset', programId: general.id, at: 1 });
});
