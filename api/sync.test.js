import test from 'node:test';
import assert from 'node:assert/strict';
import { processSyncBatch } from './sync.js';

function fakeDb() {
  const ops = new Map();
  return {
    ops,
    exec(sql) { if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return; },
    prepare(sql) {
      if (sql.startsWith('SELECT result_json')) return { get: (_user, id) => ops.get(id) ? { result_json: ops.get(id) } : undefined };
      if (sql.startsWith('INSERT INTO sync_operations')) return { run: (_user, id, result) => { ops.set(id, result); } };
      if (sql.startsWith('DELETE FROM sync_operations')) return { run: () => {} };
      throw new Error(`unexpected SQL in sync test: ${sql}`);
    },
  };
}

const operation = (id, createdAt, changes) => ({ id, createdAt, changes });

test('offline sync applies an operation once and replays it without duplicating', () => {
  const db = fakeDb();
  let state = { _ts: 100, theme: 'dark' };
  const first = processSyncBatch({ db, userId: 'u1', operations: [operation('o1', 110, [{ path: ['theme'], op: 'replace', value: 'light' }])], getUserState: () => state, saveUserState: (_id, next) => { state = next; } });
  assert.deepEqual(first.appliedIds, ['o1']);
  assert.equal(state.theme, 'light');
  const replay = processSyncBatch({ db, userId: 'u1', operations: [operation('o1', 110, [{ path: ['theme'], op: 'replace', value: 'dark' }])], getUserState: () => state, saveUserState: () => { throw new Error('replay must not write'); } });
  assert.deepEqual(replay.appliedIds, ['o1']);
  assert.equal(state.theme, 'light');
});

test('offline sync applies the last confirmed update even when its base is older', () => {
  const db = fakeDb();
  const state = { _ts: 500, theme: 'dark', _syncVersions: { theme: 500 } };
  let next = state;
  const result = processSyncBatch({ db, userId: 'u1', operations: [{ ...operation('old', 600, [{ path: ['theme'], op: 'replace', value: 'light' }]), baseTs: 100 }], getUserState: () => next, saveUserState: (_id, value) => { next = value; } });
  assert.deepEqual(result.appliedIds, ['old']);
  assert.equal(next.theme, 'light');
});

test('offline sync applies multiple state changes from the same device in order', () => {
  const db = fakeDb();
  let state = { _ts: 100, theme: 'dark', routineGroups: [] };
  const first = processSyncBatch({ db, userId: 'u1', operations: [
    { ...operation('palette', 200, [{ path: ['theme'], op: 'replace', value: 'light' }]), baseTs: 100 },
    { ...operation('group', 201, [{ path: ['routineGroups'], op: 'replace', value: [{ id: 'g1' }] }]), baseTs: 200 }
  ], getUserState: () => state, saveUserState: (_id, next) => { state = { ...next, _ts: state._ts + 1 }; } });
  assert.deepEqual(first.appliedIds, ['palette', 'group']);
  assert.equal(state.theme, 'light');
  assert.equal(state.routineGroups[0].id, 'g1');
});

test('offline sync supersedes an older patch when a newer patch replaces the same field', () => {
  const db = fakeDb();
  let state = { _ts: 50, theme: 'dark' };
  const result = processSyncBatch({ db, userId: 'u1', operations: [
    { ...operation('old-theme', 100, [{ path: ['theme'], op: 'replace', value: 'light' }]), baseTs: 50 },
    { ...operation('new-theme', 200, [{ path: ['theme'], op: 'replace', value: 'system' }]), baseTs: 50 }
  ], getUserState: () => state, saveUserState: (_id, next) => { state = next; } });
  assert.deepEqual(result.appliedIds, ['old-theme', 'new-theme']);
  assert.equal(result.results[0].result.superseded, true);
  assert.equal(state.theme, 'system');
});

test('offline sync applies granular array entity changes and merges independent fields', () => {
  const db = fakeDb();
  let state = { _ts: 50, routines: [{ id: 'r1', name: 'Push', note: 'old' }, { id: 'r2', name: 'Pull' }] };
  const result = processSyncBatch({ db, userId: 'u1', operations: [
    operation('rename', 100, [{ path: ['routines', 'r1', 'name'], op: 'replace', value: 'Upper' }]),
    operation('note', 101, [{ path: ['routines', 'r1', 'note'], op: 'replace', value: 'new' }]),
    operation('add', 102, [{ path: ['routines', 'r3'], op: 'add', value: { id: 'r3', name: 'Legs' } }]),
    operation('delete', 103, [{ path: ['routines', 'r2'], op: 'remove' }]),
  ], getUserState: () => state, saveUserState: (_id, next) => { state = next; } });
  assert.deepEqual(result.appliedIds, ['rename', 'note', 'add', 'delete']);
  assert.deepEqual(state.routines, [{ id: 'r1', name: 'Upper', note: 'new' }, { id: 'r3', name: 'Legs' }]);
});

test('offline sync drops a stale field patch when a newer entity replacement arrives', () => {
  const db = fakeDb();
  let state = { _ts: 50, routines: [{ id: 'r1', name: 'Push', note: 'old' }] };
  const result = processSyncBatch({ db, userId: 'u1', operations: [
    operation('old-field', 100, [{ path: ['routines', 'r1', 'name'], op: 'replace', value: 'Old' }]),
    operation('new-entity', 200, [{ path: ['routines', 'r1'], op: 'replace', value: { id: 'r1', name: 'New', note: 'kept' } }]),
  ], getUserState: () => state, saveUserState: (_id, next) => { state = next; } });
  assert.equal(result.results[0].result.superseded, true);
  assert.equal(state.routines[0].name, 'New');
  assert.equal(state.routines[0].note, 'kept');
});

test('offline sync keeps a newer field patch after an older entity replacement', () => {
  const db = fakeDb();
  let state = { _ts: 50, routines: [{ id: 'r1', name: 'Push', note: 'old' }] };
  const result = processSyncBatch({ db, userId: 'u1', operations: [
    operation('entity', 100, [{ path: ['routines', 'r1'], op: 'replace', value: { id: 'r1', name: 'New', note: 'entity' } }]),
    operation('field', 200, [{ path: ['routines', 'r1', 'note'], op: 'replace', value: 'latest' }]),
  ], getUserState: () => state, saveUserState: (_id, next) => { state = next; } });
  assert.deepEqual(result.appliedIds, ['entity', 'field']);
  assert.equal(state.routines[0].name, 'New');
  assert.equal(state.routines[0].note, 'latest');
});
