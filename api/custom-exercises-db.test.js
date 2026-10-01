import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lauyim-custom-ex-'));
process.env.DATA_DIR = tmpDir;

const dbMod = await import('./database.js');
dbMod.initDatabase();

const baseState = () => ({ _ts: Date.now(), unit: 'kg', routines: [], workouts: [], week: {}, dayPlan: {}, exWeights: {}, bodyweight: [] });
const user = id => dbMod.createUser({ id, name: id, admin: false, disabled: false, created: Date.now() });

test('a custom exercise keeps the fields without a column of their own (description, muscles, map)', () => {
  user('u1');
  const ex = {
    id: 'cx1', n: 'Remo en polea', tipo: 'fuerza', equipamiento: ['leverage machine'], grupo_muscular: 'back',
    bp: 'back', eq: 'leverage machine', tg: 'back', mg: '', sm: ['biceps'], st: ['Sentate.', 'Tirá.'],
    desc: 'Agarre neutro', primaries: ['back'], secondaries: ['biceps'], muscleGroups: ['back', 'biceps'], map: false, custom: true
  };
  dbMod.saveUserState('u1', { ...baseState(), customEx: [ex] });
  const [back] = dbMod.getUserState('u1').customEx;
  assert.equal(back.desc, 'Agarre neutro');
  assert.deepEqual(back.primaries, ['back']);
  assert.deepEqual(back.secondaries, ['biceps']);
  assert.deepEqual(back.muscleGroups, ['back', 'biceps']);
  assert.equal(back.map, false);
  assert.deepEqual(back.st, ['Sentate.', 'Tirá.']);
  assert.equal(back.custom, true);
  assert.equal('shared' in back, false);
});

test('an exercise shared by the admin is never also stored as their personal one', () => {
  user('admin1');
  const shared = { id: 'cpub', n: 'Sentadilla búlgara', tipo: 'fuerza', bp: 'upper legs', tg: 'upper legs', sm: [], st: [], custom: true };
  dbMod.savePublicCustomExercise(shared);
  // Un cliente viejo mandaba la copia local sin la marca de compartido.
  dbMod.saveUserState('admin1', { ...baseState(), customEx: [{ ...shared }] });
  const rows = dbMod.getDatabase().prepare('SELECT id FROM custom_exercises WHERE user_id = ?').all('admin1');
  assert.deepEqual(rows, []);
  const list = dbMod.getUserState('admin1').customEx.filter(e => e.id === 'cpub');
  assert.equal(list.length, 1);
  assert.equal(list[0].shared, true);
});

test('a personal row left over with the id of a shared exercise is not returned twice', () => {
  user('admin2');
  dbMod.saveUserState('admin2', { ...baseState(), customEx: [] });
  dbMod.savePublicCustomExercise({ id: 'cdup', n: 'Hip thrust', tipo: 'fuerza', bp: 'upper legs', custom: true });
  dbMod.getDatabase().prepare(`INSERT INTO custom_exercises (id, user_id, n, bp, eq, tg, mg, sm, st, created_at)
    VALUES ('cdup', 'admin2', 'Hip thrust', 'upper legs', 'barbell', 'upper legs', '', '[]', '[]', 1)`).run();
  const list = dbMod.getUserState('admin2').customEx;
  assert.equal(list.filter(e => e.id === 'cdup').length, 1);
});

// ---- retirar un ejercicio compartido (borrarlo o dejar de compartirlo) ----

const PUB = { id: 'cret', n: 'Press Pallof', tipo: 'fuerza', bp: 'waist', tg: 'abs', sm: ['obliques'], st: ['Pará firme.'], desc: 'Anti-rotación', custom: true };
const routineWith = (id, exId) => ({ id, name: 'Core', emoji: 'dumbbell', ex: [{ id: exId, sets: 3, reps: 10 }] });
const workoutWith = (id, exId) => ({ id, d: '2026-09-20', start: 1, end: 2, name: 'Core', entries: [{ id: exId, sets: [{ w: 10, r: 10, done: true }] }] });

test('retirar un compartido: cada socio que lo usa (rutina, grupo, historial) recibe su copia y nadie más', () => {
  for (const id of ['r-staff', 'r-rutina', 'r-grupo', 'r-historial', 'r-nada']) user(id);
  dbMod.savePublicCustomExercise(PUB);
  dbMod.saveUserState('r-rutina', { ...baseState(), routines: [routineWith('rr1', 'cret')], customEx: [] });
  dbMod.saveUserState('r-grupo', { ...baseState(), routineGroups: [{ id: 'g1', name: 'Gym', routines: [routineWith('rg1', 'cret')] }], customEx: [] });
  dbMod.saveUserState('r-historial', { ...baseState(), workouts: [workoutWith('w1', 'cret')], customEx: [] });
  dbMod.saveUserState('r-nada', { ...baseState(), customEx: [] });
  // El admin que lo borra lo tiene en su rutina: no recibe copia (lo está borrando él).
  dbMod.saveUserState('r-staff', { ...baseState(), routines: [routineWith('rs1', 'cret')], customEx: [] });

  // Mientras está compartido, quien lo tiene en una rutina ya tiene su copia guardada (la crea el
  // guardado del estado), pero la recibe una sola vez: la compartida.
  const before = dbMod.getUserState('r-rutina').customEx.filter(e => e.id === 'cret');
  assert.equal(before.length, 1);
  assert.equal(before[0].shared, true);
  // Solo faltaba la copia de quien lo tiene únicamente en el historial.
  assert.equal(dbMod.retirePublicCustomExercise('cret', { actorId: 'r-staff' }), 1);
  assert.equal(dbMod.getPublicCustomExercises().some(e => e.id === 'cret'), false);
  for (const uid of ['r-rutina', 'r-grupo', 'r-historial']) {
    const copies = dbMod.getUserState(uid).customEx.filter(e => e.id === 'cret');
    assert.equal(copies.length, 1, uid);
    assert.equal(copies[0].shared, undefined, uid);
    assert.equal(copies[0].origin, 'cret', uid);
    assert.equal(copies[0].desc, 'Anti-rotación', uid);
    assert.deepEqual(copies[0].st, ['Pará firme.'], uid);
  }
  assert.equal(dbMod.getUserState('r-nada').customEx.some(e => e.id === 'cret'), false);
  assert.equal(dbMod.getUserState('r-staff').customEx.some(e => e.id === 'cret'), false);
  // Idempotente: una segunda vez no encuentra nada que retirar.
  assert.equal(dbMod.retirePublicCustomExercise('cret', { actorId: 'r-staff' }), null);
});

test('dejar de compartir: el admin se queda con el original como propio y los socios con su copia', () => {
  for (const id of ['u-staff', 'u-socia']) user(id);
  dbMod.savePublicCustomExercise({ ...PUB, id: 'cuns' });
  dbMod.saveUserState('u-socia', { ...baseState(), routines: [routineWith('ru1', 'cuns')], customEx: [] });
  dbMod.saveUserState('u-staff', { ...baseState(), customEx: [] });

  assert.equal(dbMod.retirePublicCustomExercise('cuns', { actorId: 'u-staff', keepForActor: true }), 0);
  const mine = dbMod.getUserState('u-staff').customEx.filter(e => e.id === 'cuns');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].origin, undefined);
  assert.equal(mine[0].shared, undefined);
  assert.equal(mine[0].desc, 'Anti-rotación');
  const hers = dbMod.getUserState('u-socia').customEx.filter(e => e.id === 'cuns');
  assert.equal(hers.length, 1);
  assert.equal(hers[0].origin, 'cuns');
});

test('retirar un compartido que usa un programa del gym guarda su definición en el programa', () => {
  user('p-staff');
  dbMod.savePublicCustomExercise({ ...PUB, id: 'cpre' });
  dbMod.createPreset({ id: 'pre-core', name: 'Core', emoji: 'abs', groupName: 'Gym', plannedDay: 1, ex: [{ id: 'cpre', sets: 3, reps: 10 }] });
  dbMod.retirePublicCustomExercise('cpre', { actorId: 'p-staff' });
  const defs = dbMod.getPresetCustomExercises([{ ex: [{ id: 'cpre' }] }]);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].n, 'Press Pallof');
});
