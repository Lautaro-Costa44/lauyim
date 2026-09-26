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
const presets = async () => (await call('staff', 'GET', '/api/admin/presets')).body;
const memberPresets = async (uid = 'ana') => (await call(uid, 'GET', '/api/presets')).body;

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

test('borrar un programa: se van sus días y el programa; las rutinas de los socios no cambian', async () => {
  const created = await call('staff', 'POST', '/api/admin/presets', { name: 'A borrar', groupName: 'Temporal', plannedDay: 1, ex: [{ id: '0025', sets: 3, reps: 8 }] });
  await call('staff', 'POST', '/api/admin/presets', { name: 'A borrar 2', groupName: 'Temporal', plannedDay: 2, ex: [] });
  const program = (await presets()).programs.find(p => p.name === 'Temporal');
  const socio = await call('staff', 'PUT', '/api/admin/users/beto/routines', { routines: [{ id: 'rb-temp', name: 'A borrar', ex: [{ id: '0025', sets: 3, reps: 8 }] }], week: {}, dayPlan: {} });
  assert.equal(socio.status, 200);

  assert.equal((await call('ana', 'POST', '/api/admin/programs/delete', { id: program.id })).status, 403);
  const r = await call('staff', 'POST', '/api/admin/programs/delete', { id: program.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.days, 2);
  const after = await presets();
  assert.equal(after.programs.some(p => p.id === program.id), false);
  assert.equal(after.presets.some(p => p.group_name === 'Temporal' || p.id === created.body.preset.id), false);
  assert.equal(after.groups.some(g => g.name === 'Temporal'), false);
  assert.equal((await call('staff', 'POST', '/api/admin/programs/delete', { id: program.id })).status, 404);
  const routines = await call('staff', 'GET', '/api/admin/users/beto/routines');
  assert.deepEqual(routines.body.routines.map(r => r.name), ['A borrar']);
});

test('visibilidad: el seed se ve; un programa nuevo nace oculto y el socio no lo ve ni lo puede cargar', async () => {
  const general = (await presets()).programs.find(p => p.name === 'General');
  assert.equal(general.visibleToMembers, true);
  await call('staff', 'POST', '/api/admin/presets', { name: 'Día A', groupName: 'Oculto Nuevo', plannedDay: 2, ex: [{ id: '0025', sets: 3, reps: 8 }] });
  const nuevo = (await presets()).programs.find(p => p.name === 'Oculto Nuevo');
  assert.equal(nuevo.visibleToMembers, false);

  const socio = await memberPresets();
  assert.equal(socio.programs.some(p => p.id === nuevo.id), false);
  assert.equal(socio.groups.some(g => g.name === 'Oculto Nuevo'), false);
  assert.equal(socio.presets.some(p => p.group_name === 'Oculto Nuevo'), false);
  assert.equal(socio.programs.some(p => p.id === general.id), true);

  assert.equal((await call('ana', 'POST', '/api/presets/apply', { id: nuevo.id })).status, 403);
  // También desde la app del socio de un admin: el panel es el que ve todo.
  assert.equal((await call('staff', 'POST', '/api/presets/apply', { id: nuevo.id })).status, 403);
  assert.equal((await call('ana', 'POST', '/api/presets/apply', { id: 'nope' })).status, 404);
  const ok = await call('ana', 'POST', '/api/presets/apply', { id: general.id });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.presets.map(p => p.id), ['starter-push', 'starter-pull', 'starter-legs']);
});

test('visibilidad: mostrarlo lo hace aparecer, ocultarlo no toca la rutina de quien ya lo cargó; audit y permisos', async () => {
  const nuevo = (await presets()).programs.find(p => p.name === 'Oculto Nuevo');
  assert.equal((await call('ana', 'POST', '/api/admin/programs/visibility', { id: nuevo.id, visible: true })).status, 403);
  assert.equal((await call('staff', 'POST', '/api/admin/programs/visibility', { id: nuevo.id, visible: 'si' })).status, 400);
  assert.equal((await call('staff', 'POST', '/api/admin/programs/visibility', { id: 'nope', visible: true })).status, 404);
  const shown = await call('staff', 'POST', '/api/admin/programs/visibility', { id: nuevo.id, visible: true });
  assert.equal(shown.status, 200);
  assert.equal(shown.body.program.visibleToMembers, true);
  assert.equal((await memberPresets()).programs.some(p => p.id === nuevo.id), true);
  const applied = await call('beto', 'POST', '/api/presets/apply', { id: nuevo.id });
  assert.equal(applied.status, 200);

  // beto lo carga (como lo hace la app: rutinas + grupo con source), después se oculta.
  const routines = applied.body.presets.map(p => ({ id: 'rb-' + p.id, name: p.name, ex: p.ex }));
  const put = await call('beto', 'PUT', '/api/data', { state: { routines, routineGroups: [{ id: 'gb', name: 'Oculto Nuevo', routines, week: {}, source: { kind: 'preset', programId: nuevo.id, at: 1 } }], activeGroupId: 'gb' } });
  assert.equal(put.status, 200);
  assert.equal((await call('staff', 'POST', '/api/admin/programs/visibility', { id: nuevo.id, visible: false })).status, 200);
  assert.equal((await memberPresets('beto')).programs.some(p => p.id === nuevo.id), false);
  const state = (await call('beto', 'GET', '/api/data')).body.state;
  assert.deepEqual(state.routines.map(r => r.name), ['Día A']);
  assert.equal(state.routineGroups[0].source.programId, nuevo.id);

  const logs = fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
    .filter(r => r.ev === 'admin.program.visibility');
  assert.deepEqual(logs.map(l => [l.uid, l.msg]), [['staff', 'Oculto Nuevo: visible para socios'], ['staff', 'Oculto Nuevo: oculto para socios']]);
});

test('visibilidad: duplicar crea la copia oculta; el admin asigna un programa oculto igual', async () => {
  const general = (await presets()).programs.find(p => p.name === 'General');
  const dup = await call('staff', 'POST', '/api/admin/programs/duplicate', { id: general.id, name: 'General Oculto' });
  assert.equal(dup.body.program.visibleToMembers, false);
  assert.equal((await memberPresets()).programs.some(p => p.id === dup.body.program.id), false);
  // "Asignar a socio": el panel lee el programa oculto y lo PUTea al socio.
  const days = (await presets()).presets.filter(p => p.program_id === dup.body.program.id);
  assert.equal(days.length, 3);
  const routines = days.map(p => ({ id: 'ra-' + p.id, name: p.name, ex: p.ex }));
  const assigned = await call('staff', 'PUT', '/api/admin/users/ana/routines', { routines, week: {}, dayPlan: {}, routineGroups: [{ id: 'ga', name: 'General Oculto', routines, week: {}, source: { kind: 'preset', programId: dup.body.program.id, at: 2 } }], activeGroupId: 'ga' });
  assert.equal(assigned.status, 200);
  assert.deepEqual((await call('staff', 'GET', '/api/admin/users/ana/routines')).body.routines.map(r => r.name), ['Push Day', 'Pull Day', 'Leg Day']);
});

test('visibilidad: sin ningún programa visible, el socio recibe un catálogo vacío', async () => {
  const all = (await presets()).programs;
  for (const p of all) await call('staff', 'POST', '/api/admin/programs/visibility', { id: p.id, visible: false });
  const socio = await memberPresets();
  assert.deepEqual([socio.programs, socio.groups, socio.presets, socio.customExercises], [[], [], [], []]);
  assert.equal((await presets()).programs.length, all.length);
  for (const p of all) await call('staff', 'POST', '/api/admin/programs/visibility', { id: p.id, visible: p.visibleToMembers });
});
