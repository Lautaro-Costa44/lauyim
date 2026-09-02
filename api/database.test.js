import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'opengym-db-'));
process.env.DATA_DIR = tmpDir;

const dbMod = await import('./database.js');

test('saveUserState ignores invalid routine references instead of breaking foreign keys', () => {
  dbMod.initDatabase();
  dbMod.createUser({
    id: 'u1',
    name: 'Tester',
    admin: false,
    disabled: false,
    created: Date.now()
  });

  const state = {
    _ts: Date.now(),
    unit: 'kg',
    routines: [
      { id: 'r1', name: 'Rutina A', emoji: '💪', created: Date.now(), ex: [] }
    ],
    week: { 0: 'missing-routine' },
    dayPlan: { '2025-01-01': 'missing-routine' },
    workouts: [{
      id: 'w1',
      d: '2025-01-01',
      start: 1,
      end: 2,
      routineId: 'missing-routine',
      name: 'Workout',
      entries: []
    }],
    exWeights: {},
    bodyweight: [],
    customEx: [],
    exNotes: {},
    reminder: null,
    equipProfiles: []
  };

  assert.doesNotThrow(() => dbMod.saveUserState('u1', state));

  const saved = dbMod.getUserState('u1');
  assert.equal(saved.week[0], null);
  assert.equal(saved.dayPlan['2025-01-01'], null);
  assert.equal(saved.workouts[0].routineId, null);
});


test.after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});
