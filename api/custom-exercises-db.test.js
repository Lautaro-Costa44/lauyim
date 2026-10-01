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
