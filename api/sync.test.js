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
