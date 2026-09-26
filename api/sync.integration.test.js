import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-sync-'));
process.env.DATA_DIR = dataDir;

const [{ initDatabase, getDatabase, closeDatabase, getUserState, saveUserState }, { processSyncBatch }] = await Promise.all([
  import('./database.js'),
  import('./sync.js')
]);

const legacyDb = new DatabaseSync(path.join(dataDir, 'gym.db'));
legacyDb.exec(`
  CREATE TABLE plantillas_comida (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    nombre TEXT NOT NULL,
    categoria TEXT,
    franjas_recomendadas TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE plantillas_ingredientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plantilla_id INTEGER NOT NULL,
    nombre_alimento TEXT NOT NULL,
    cantidad_gramos REAL NOT NULL,
    calorias REAL NOT NULL,
    proteina REAL NOT NULL,
    carbohidratos REAL NOT NULL,
    grasas REAL NOT NULL
  );
`);
legacyDb.prepare('INSERT INTO plantillas_comida (user_id, nombre, created_at) VALUES (?, ?, ?)').run('u1', 'Legacy', 1234);
legacyDb.close();

const db = initDatabase();
db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('u1', 'Test');

const ingredient = { nombre_alimento: 'Avena', cantidad_gramos: 50, calorias: 190, proteina: 7, carbohidratos: 32, grasas: 4 };
const requestOperation = (id, request, createdAt = Date.now()) => ({ id, createdAt, changes: [{ request: { ...request, opId: id } }] });
const run = (operations, userId = 'u1') => processSyncBatch({
  db,
  userId,
  operations,
  getUserState,
  saveUserState
});

test('SQLite real: migrates an existing template table to entity versioning', () => {
  const columns = db.prepare('PRAGMA table_info(plantillas_comida)').all().map(row => row.name);
  assert.ok(columns.includes('updated_at'));
  assert.equal(db.prepare('SELECT updated_at FROM plantillas_comida WHERE nombre = ?').get('Legacy').updated_at, 1234);
});

test('SQLite real: persists and reloads routine groups with the general state', () => {
  saveUserState('u1', {
    _ts: 100,
    body: 'female', genero: 'femenino', gifSize: 'mini', defaultIntensifier: { type: 'dropset', count: 2 }, defaultSets: 5,
    routines: [], week: {}, dayPlan: {}, workouts: [], exWeights: {}, bodyweight: [], customEx: [], exNotes: {},
    routineGroups: [{ id: 'group-1', name: 'Fuerza', routines: [], week: {} }],
    activeGroupId: 'group-1'
  });
  const state = getUserState('u1');
  assert.equal(state.activeGroupId, 'group-1');
  assert.equal(state.routineGroups[0].name, 'Fuerza');
  assert.equal(state.genero, 'femenino');
  assert.equal(state.gifSize, 'mini');
  assert.deepEqual(state.defaultIntensifier, { type: 'dropset', count: 2 });
  assert.equal(state.defaultSets, 5);
});

test('SQLite real: merges independent changes from two devices and conflicts only on the same field', () => {
  db.prepare('INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)').run('u-merge', 'Merge test');
  saveUserState('u-merge', {
    _ts: 100, theme: 'dark', defaultSets: 3, _syncVersions: { theme: 100, defaultSets: 100 },
    routines: [], week: {}, dayPlan: {}, workouts: [], exWeights: {}, bodyweight: [], customEx: [], exNotes: {},
    routineGroups: [], activeGroupId: null
  });
  const deviceA = run([{ id: 'device-a', baseTs: 100, createdAt: 101, changes: [{ path: ['theme'], op: 'replace', value: 'light' }] }], 'u-merge');
  const deviceB = run([{ id: 'device-b', baseTs: 100, createdAt: 102, changes: [{ path: ['defaultSets'], op: 'replace', value: 5 }] }], 'u-merge');
  assert.deepEqual(deviceA.appliedIds, ['device-a']);
  assert.deepEqual(deviceB.appliedIds, ['device-b']);
  const merged = getUserState('u-merge');
  assert.equal(merged.theme, 'light');
  assert.equal(merged.defaultSets, 5);

  const stale = run([{ id: 'device-c', baseTs: 100, createdAt: 103, changes: [{ path: ['theme'], op: 'replace', value: 'system' }] }], 'u-merge');
  assert.deepEqual(stale.appliedIds, ['device-c']);
  assert.equal(stale.conflicts.length, 0);
  assert.equal(getUserState('u-merge').theme, 'system');
});

test('SQLite real: compound create is atomic, idempotent and returns temporary ID mapping', () => {
  const operation = requestOperation('compound-1', {
    kind: 'compound-create',
    payload: { nombre: 'Avena test', fecha: '2026-09-10', franja: 'desayuno', ingredientes: [ingredient], tempId: 'offline:template-1', tempGroupId: 'offline:group-1' }
  });
  const first = run([operation]);
  assert.equal(first.conflicts.length, 0);
  assert.equal(first.results[0].result.tempId, 'offline:template-1');
  assert.ok(first.results[0].result.id > 0);
  assert.match(first.results[0].result.grupo_id, /^g/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plantillas_comida WHERE user_id = ? AND nombre = ?').get('u1', 'Avena test').n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comidas_registradas WHERE user_id = ? AND grupo_nombre = ?').get('u1', 'Avena test').n, 1);

  const replay = run([operation]);
  assert.equal(replay.conflicts.length, 0);
  assert.equal(replay.results[0].replay, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plantillas_comida WHERE user_id = ? AND nombre = ?').get('u1', 'Avena test').n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comidas_registradas WHERE user_id = ? AND grupo_nombre = ?').get('u1', 'Avena test').n, 1);
});

test('SQLite real: failed operation does not leave an idempotency key and can be retried', () => {
  const invalid = requestOperation('retry-1', { kind: 'template-create', payload: { nombre: '', ingredientes: [] } });
  const failed = run([invalid]);
  assert.equal(failed.appliedIds.length, 0);
  assert.equal(failed.conflicts[0].reason, 'invalid template');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sync_operations WHERE op_id = ?').get('retry-1').n, 0);

  const corrected = requestOperation('retry-1', { kind: 'template-create', payload: { nombre: 'Retry', ingredientes: [ingredient], tempId: 'offline:retry' } });
  const retried = run([corrected]);
  assert.deepEqual(retried.appliedIds, ['retry-1']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plantillas_comida WHERE nombre = ?').get('Retry').n, 1);
});

test('SQLite real: last confirmed template update wins deterministically', () => {
  const created = run([requestOperation('template-2-create', { kind: 'template-create', payload: { nombre: 'Original', ingredientes: [ingredient] } })]);
  const id = created.results[0].result.id;
  const version = db.prepare('SELECT updated_at FROM plantillas_comida WHERE id = ?').get(id).updated_at;
  db.prepare('UPDATE plantillas_comida SET nombre = ?, updated_at = ? WHERE id = ?').run('Device B', version + 1000, id);

  const stale = run([requestOperation('template-2-update', {
    kind: 'template-update',
    payload: { id, nombre: 'Device A', ingredientes: [ingredient], expectedUpdatedAt: version }
  })]);
  assert.deepEqual(stale.appliedIds, ['template-2-update']);
  assert.equal(stale.conflicts.length, 0);
  assert.equal(db.prepare('SELECT nombre FROM plantillas_comida WHERE id = ?').get(id).nombre, 'Device A');
});

test('SQLite real: a field patch on one exercise of a routine reaches routine_exercises.extra', () => {
  saveUserState('u1', { routines: [{ id: 'r-nested', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8 }, { id: '0047', sets: 3, reps: 10 }] }] });
  const at = ['routines', 'r-nested', 'ex', '0025'];
  const applied = run([{ id: 'nested-1', createdAt: 1, changes: [
    { path: [...at, 'intensifier'], op: 'add', value: { type: 'dropset', count: 2, pct: 80 } },
    { path: [...at, 'warmupSets'], op: 'add', value: 2 }
  ] }]);
  assert.deepEqual(applied.appliedIds, ['nested-1']);
  const [first, second] = getUserState('u1').routines[0].ex;
  assert.deepEqual(first.intensifier, { type: 'dropset', count: 2, pct: 80 });
  assert.equal(first.warmupSets, 2);
  assert.equal(second.intensifier, undefined);
  assert.equal(JSON.parse(db.prepare("SELECT extra FROM routine_exercises WHERE routine_id = 'r-nested' AND position = 0").get().extra).warmupSets, 2);

  run([{ id: 'nested-2', createdAt: 2, changes: [{ path: [...at, 'intensifier'], op: 'remove' }] }]);
  assert.equal(getUserState('u1').routines[0].ex[0].intensifier, undefined);
  assert.equal(getUserState('u1').routines[0].ex[0].warmupSets, 2);
  // A patch for an exercise another device already removed changes nothing.
  const gone = run([{ id: 'nested-3', createdAt: 3, changes: [{ path: ['routines', 'r-nested', 'ex', '9999', 'warmupSets'], op: 'add', value: 1 }] }]);
  assert.deepEqual(gone.appliedIds, ['nested-3']);
  assert.equal(getUserState('u1').routines[0].ex.length, 2);
});

test('SQLite real: the first patch of an account with no user_state row creates the arrays it needs', () => {
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('u-fresh', 'Nuevo');
  assert.equal(getUserState('u-fresh'), null);
  const r = run([{ id: 'fresh-1', createdAt: 1, changes: [
    { path: ['routines', 'r-first'], op: 'add', value: { id: 'r-first', name: 'Primera', ex: [{ id: '0025', sets: 3, reps: 10 }] } },
    { path: ['bodyweight', 'bw-1'], op: 'add', value: { id: 'bw-1', d: '2026-09-25', w: 80, t: 1790000000000 } }
  ] }], 'u-fresh');
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.appliedIds, ['fresh-1']);
  const state = getUserState('u-fresh');
  assert.deepEqual(state.routines.map(x => x.name), ['Primera']);
  assert.ok(Array.isArray(state.bodyweight));
});

after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
