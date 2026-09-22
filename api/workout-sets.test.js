import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-sets-'));
process.env.DATA_DIR = dataDir;

const [{ initDatabase, getDatabase, closeDatabase, getUserState, saveUserState }, { processSyncBatch }, { applyStatePut }, { META_MAX_BYTES }] = await Promise.all([
  import('./database.js'),
  import('./sync.js'),
  import('./data-put.js'),
  import('./row-meta.js')
]);

initDatabase();
const addUser = id => getDatabase().prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(id, id);

after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const put = (userId, state, save = saveUserState) =>
  applyStatePut({ db: getDatabase(), userId, state: structuredClone(state), getUserState, saveUserState: save });
const sync = (userId, operations) =>
  processSyncBatch({ db: getDatabase(), userId, operations, getUserState, saveUserState });
const addWorkoutOp = (id, workout, createdAt = 1) =>
  ({ id, createdAt, changes: [{ path: ['workouts', workout.id], op: 'add', value: structuredClone(workout) }] });

// "Idéntico": las columnas propias ausentes vuelven null; todo lo demás, exacto. Los fixtures
// declaran todas las columnas para que el deep equal compare contra el contrato de lectura.
const set = fields => ({ w: null, r: null, sec: null, min: null, speed: null, done: true, rir: null, rpe: null, ...fields });
const entry = (id, sets, fields = {}) => ({ id, topW: null, target: null, note: null, notePin: false, muscleSnapshot: null, sets, ...fields });
const workout = (id, d, entries, fields = {}) => ({
  id, d, start: Date.parse(d + 'T18:00:00Z'), end: Date.parse(d + 'T19:00:00Z'),
  routineId: null, name: 'Legs', bw: null, vol: null, note: null, partial: false, entries, ...fields
});

// Todo lo que el servidor perdía: ceros, calentamientos, drop-sets, rest-pause, unidad por set,
// y a nivel workout los PRs y el grupo de rutinas.
const RICH = workout('w-rich', '2026-09-10', [
  entry('0024', [
    set({ w: 0, r: 10, rir: 0, phase: 'warmup', warmup: true }),
    set({ w: 100, r: 8, rir: 0, type: 'dropset', drops: [{ w: 80, r: 6 }, { w: 60, r: 5 }] }),
    set({ w: 90, r: 12, rpe: 9, type: 'restpause', clusters: [{ r: 4, restSec: 15 }, { r: 3, restSec: 15 }] }),
    set({ w: 225, r: 5, u: 'lb' }),
    set({ w: 0, r: 0, sec: 0, min: 0, speed: 0, rir: 0, rpe: 0, done: false })
  ], { topW: 0 })
], { vol: 0, prs: [{ id: '0024', kind: 'weight', w: 100 }], routineGroupId: 'grp-1' });

test('PUT round trip keeps zeros, set extras and workout extras exactly', () => {
  addUser('put-rich');
  const response = put('put-rich', { workouts: [RICH] });
  assert.equal(response.status, 200);
  assert.deepEqual(getUserState('put-rich').workouts, [RICH]);
});

test('sync round trip keeps zeros, set extras and workout extras exactly', () => {
  addUser('sync-rich');
  saveUserState('sync-rich', { workouts: [] });
  const processed = sync('sync-rich', [addWorkoutOp('op-rich', RICH)]);
  assert.deepEqual(processed.conflicts, []);
  assert.deepEqual(getUserState('sync-rich').workouts, [RICH]);
});

test('the same exercise twice in one workout keeps each entry with its own sets', () => {
  addUser('dup-ex');
  const twice = workout('w-dup', '2026-09-11', [
    entry('0024', [set({ w: 60, r: 10, phase: 'warmup' })]),
    entry('0585', [set({ w: 40, r: 12 })]),
    entry('0024', [set({ w: 100, r: 5 }), set({ w: 100, r: 4, rir: 0 })])
  ]);
  assert.equal(put('dup-ex', { workouts: [twice] }).status, 200);
  assert.deepEqual(getUserState('dup-ex').workouts, [twice]);
});

test('a set and a workout with no extra keys store meta = null', () => {
  addUser('plain');
  const plain = workout('w-plain', '2026-09-12', [entry('0024', [set({ w: 50, r: 10 }), set({ w: 55, r: 8, rir: 2 })])]);
  assert.equal(put('plain', { workouts: [plain] }).status, 200);
  const setMetas = getDatabase().prepare(`
    SELECT s.meta FROM workout_sets s JOIN workout_entries e ON e.id = s.entry_id
    JOIN workouts w ON w.id = e.workout_id WHERE w.user_id = ?`).all('plain');
  assert.equal(setMetas.length, 2);
  assert.ok(setMetas.every(row => row.meta === null));
  assert.equal(getDatabase().prepare('SELECT meta FROM workouts WHERE id = ?').get('w-plain').meta, null);
  // keys whose value is undefined are omitted, not stored as meta
  const withUndefined = workout('w-undef', '2026-09-13', [entry('0024', [{ ...set({ w: 1, r: 1 }), phase: undefined }])]);
  assert.equal(put('plain', { workouts: [plain, withUndefined] }).status, 200);
  assert.equal(getDatabase().prepare(`SELECT s.meta FROM workout_sets s JOIN workout_entries e ON e.id = s.entry_id WHERE e.workout_id = ?`).get('w-undef').meta, null);
});

test('unreadable or non-object meta in the database is ignored with a warning, never breaking the read', t => {
  addUser('bad-meta');
  const good = workout('w-bad', '2026-09-14', [entry('0024', [set({ w: 70, r: 8, phase: 'warmup' }), set({ w: 80, r: 6 })])], { prs: [] });
  assert.equal(put('bad-meta', { workouts: [good] }).status, 200);
  const ids = getDatabase().prepare(`SELECT s.id FROM workout_sets s JOIN workout_entries e ON e.id = s.entry_id WHERE e.workout_id = ? ORDER BY s.id`).all('w-bad').map(row => row.id);
  getDatabase().prepare('UPDATE workout_sets SET meta = ? WHERE id = ?').run('{broken', ids[0]);
  getDatabase().prepare('UPDATE workout_sets SET meta = ? WHERE id = ?').run('[1,2]', ids[1]);
  getDatabase().prepare('UPDATE workouts SET meta = ? WHERE id = ?').run('"text"', 'w-bad');
  const warn = t.mock.method(console, 'warn', () => {});

  const read = getUserState('bad-meta').workouts;
  assert.deepEqual(read, [workout('w-bad', '2026-09-14', [entry('0024', [set({ w: 70, r: 8 }), set({ w: 80, r: 6 })])])]);
  assert.equal(warn.mock.callCount(), 3);
});

test('a column value wins over the same key in meta', () => {
  addUser('conflict');
  const w1 = workout('w-conf', '2026-09-15', [entry('0024', [set({ w: 70, r: 8 })])]);
  assert.equal(put('conflict', { workouts: [w1] }).status, 200);
  getDatabase().prepare(`UPDATE workout_sets SET meta = ? WHERE entry_id IN (SELECT id FROM workout_entries WHERE workout_id = ?)`)
    .run(JSON.stringify({ w: 999, phase: 'warmup' }), 'w-conf');
  assert.deepEqual(getUserState('conflict').workouts[0].entries[0].sets[0], set({ w: 70, r: 8, phase: 'warmup' }));
});

test('meta over 4 KB is rejected with 400 and nothing is written; exactly 4 KB is accepted', () => {
  addUser('big');
  const before = workout('w-before', '2026-09-01', [entry('0024', [set({ w: 50, r: 5 })])]);
  assert.equal(put('big', { workouts: [before], theme: 'dark' }).status, 200);
  const snapshot = getUserState('big');

  // {"note":"x…x"} is the payload plus 11 bytes of JSON
  const fits = 'x'.repeat(META_MAX_BYTES - 11);
  const over = fits + 'x';
  const withSet = extra => workout('w-big', '2026-09-02', [entry('0024', [set({ w: 1, r: 1, ...extra })])]);

  const rejected = put('big', { workouts: [before, withSet({ note: over })], theme: 'light' });
  assert.deepEqual(rejected, { status: 400, body: { error: 'set_meta_too_large' } });
  const rejectedWorkout = put('big', { workouts: [workout('w-big2', '2026-09-03', [], { routineGroupId: over })], theme: 'light' });
  assert.deepEqual(rejectedWorkout, { status: 400, body: { error: 'workout_meta_too_large' } });
  assert.deepEqual(getUserState('big'), snapshot);

  assert.equal(put('big', { workouts: [before, withSet({ note: fits })] }).status, 200);
  assert.equal(getUserState('big').workouts[1].entries[0].sets[0].note, fits);
});

test('a set that is not a plain object is rejected with 400', () => {
  addUser('not-object');
  const broken = workout('w-no', '2026-09-04', [entry('0024', [[1, 2]])]);
  assert.deepEqual(put('not-object', { workouts: [broken] }), { status: 400, body: { error: 'set_not_object' } });
});

test('sync marks an oversized set as its own conflict and still applies the rest of the batch', () => {
  addUser('sync-big');
  saveUserState('sync-big', { workouts: [] });
  const huge = workout('w-huge', '2026-09-05', [entry('0024', [set({ w: 1, r: 1, note: 'x'.repeat(META_MAX_BYTES) })])]);
  const fine = workout('w-fine', '2026-09-06', [entry('0024', [set({ w: 60, r: 8, phase: 'warmup' })])]);
  const processed = sync('sync-big', [addWorkoutOp('op-huge', huge, 1), addWorkoutOp('op-fine', fine, 2)]);

  assert.deepEqual(processed.conflicts.map(item => [item.id, item.reason]), [['op-huge', 'set_meta_too_large']]);
  assert.deepEqual(processed.appliedIds, ['op-fine']);
  assert.deepEqual(getUserState('sync-big').workouts, [fine]);
});

test('a failure halfway through a PUT leaves the database exactly as it was', () => {
  addUser('atomic');
  const kept = workout('w-kept', '2026-09-07', [entry('0024', [set({ w: 50, r: 5, phase: 'warmup' })])], { prs: [1] });
  assert.equal(put('atomic', { workouts: [kept], theme: 'dark', restSec: 90 }).status, 200);
  const snapshot = getUserState('atomic');

  // passes validation, then fails inside saveWorkouts (workouts.date is NOT NULL) after
  // user_state, routines and the plan have already been written in this transaction
  const invalidDate = workout('w-null-date', '2026-09-08', [entry('0024', [set({ w: 1, r: 1 })])], { d: null });
  assert.throws(() => put('atomic', { workouts: [kept, invalidDate], theme: 'light', restSec: 120 }));
  assert.deepEqual(getUserState('atomic'), snapshot);

  // and a failure after every table was written is rolled back just the same
  const failLate = (userId, state) => { saveUserState(userId, state); throw new Error('forced failure'); };
  assert.throws(() => put('atomic', { workouts: [], theme: 'light' }, failLate), /forced failure/);
  assert.deepEqual(getUserState('atomic'), snapshot);
});

test('workouts come back in chronological order', () => {
  addUser('order');
  const late = workout('w-late', '2026-09-20', []);
  const early = workout('w-early', '2026-09-02', []);
  const sameDayLater = workout('w-mid-2', '2026-09-10', [], { start: Date.parse('2026-09-10T20:00:00Z'), end: Date.parse('2026-09-10T21:00:00Z') });
  const sameDayEarlier = workout('w-mid-1', '2026-09-10', []);
  assert.equal(put('order', { workouts: [late, sameDayLater, early, sameDayEarlier] }).status, 200);
  assert.deepEqual(getUserState('order').workouts.map(w => w.id), ['w-early', 'w-mid-1', 'w-mid-2', 'w-late']);
});

test('the meta migration is idempotent and restores the column on an existing database', () => {
  const metaColumns = table => getDatabase().prepare(`PRAGMA table_info(${table})`).all().filter(column => column.name === 'meta').length;
  // an installation that predates the column
  getDatabase().exec('ALTER TABLE workout_sets DROP COLUMN meta');
  getDatabase().exec('ALTER TABLE workouts DROP COLUMN meta');
  assert.equal(metaColumns('workout_sets'), 0);

  assert.doesNotThrow(() => initDatabase());
  assert.doesNotThrow(() => initDatabase());
  assert.equal(metaColumns('workout_sets'), 1);
  assert.equal(metaColumns('workouts'), 1);
});
