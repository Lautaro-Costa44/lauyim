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

test('getProgressionSuggestion calculates linear, double, dup and handles edge cases', () => {
  const state = {
    _ts: Date.now(),
    unit: 'kg',
    progressionTips: true,
    routines: [
      {
        id: 'r_lin',
        name: 'Linear Routine',
        emoji: '💪',
        created: Date.now(),
        ex: [
          { id: 'ex_bench', sets: 3, reps: 10, weight: 60, progressionType: 'linear', progressionConfig: { increment_kg: 2.5 } },
          { id: 'ex_bw', sets: 3, reps: 15, bodyweight: true, progressionType: 'linear', progressionConfig: { increment_kg: 2.5 } },
          { id: 'ex_cardio', sets: 1, mode: 'cardio', progressionType: 'linear', progressionConfig: { increment_kg: 2.5 } }
        ]
      }
    ],
    workouts: [
      {
        id: 'w_prev',
        d: '2025-01-02',
        start: 100,
        end: 200,
        routineId: 'r_lin',
        name: 'Workout 1',
        entries: [
          {
            id: 'ex_bench',
            topW: 60,
            target: JSON.stringify({ reps: 10, weight: 60 }),
            sets: [
              { w: 60, r: 10, done: 1 },
              { w: 60, r: 10, done: 1 }
            ]
          }
        ]
      }
    ],
    exWeights: {},
    bodyweight: [],
    customEx: [{ id: 'ex_cardio', n: 'Running', tipo: 'cardio', created_at: Date.now() }],
    exNotes: {},
    reminder: null,
    equipProfiles: []
  };

  dbMod.saveUserState('u1', state);

  const sug = dbMod.getProgressionSuggestion('u1', 'ex_bench', 'r_lin');
  assert.equal(sug.weight_suggested, 62.5);
  assert.equal(sug.reps_suggested, 10);
  assert.equal(sug.progression_type, 'linear');

  const sugCardio = dbMod.getProgressionSuggestion('u1', 'ex_cardio', 'r_lin');
  assert.equal(sugCardio, null);
});

test.after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});
