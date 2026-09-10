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

test('offline sync retains a stale operation as a conflict', () => {
  const db = fakeDb();
  const state = { _ts: 500, theme: 'dark' };
  const result = processSyncBatch({ db, userId: 'u1', operations: [operation('old', 100, [{ path: ['theme'], op: 'replace', value: 'light' }])], getUserState: () => state, saveUserState: () => { throw new Error('stale operation must not write'); } });
  assert.equal(result.appliedIds.length, 0);
  assert.equal(result.conflicts[0].reason, 'server_newer_than_client');
});
