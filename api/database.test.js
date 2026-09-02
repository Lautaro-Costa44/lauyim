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
    progressionType: 'linear',
    progressionConfig: { increment_kg: 2.5 },
    routines: [
      {
        id: 'r_lin',
        name: 'Linear Routine',
        emoji: '💪',
        created: Date.now(),
        ex: [
          { id: 'ex_bench', sets: 3, reps: 10, weight: 60 },
          { id: 'ex_cardio', sets: 1, mode: 'cardio' }
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

  // 1. Sin tipo de progresión configurado (debe retornar null)
  const stateNoType = { ...state, progressionType: null };
  dbMod.saveUserState('u1', stateNoType);
  assert.equal(dbMod.getProgressionSuggestion('u1', 'ex_bench', 'r_lin'), null);

  // 2. Lineal
  dbMod.saveUserState('u1', { ...state, progressionType: 'linear', progressionConfig: { increment_kg: 2.5 } });
  const sugLin = dbMod.getProgressionSuggestion('u1', 'ex_bench', 'r_lin');
  assert.equal(sugLin.weight_suggested, 62.5);
  assert.equal(sugLin.reps_suggested, 10);
  assert.equal(sugLin.progression_type, 'linear');

  // 3. Doble progresión
  dbMod.saveUserState('u1', { ...state, progressionType: 'double', progressionConfig: { rep_range_min: 8, rep_range_max: 10, increment_kg: 2.5 } });
  const sugDouble = dbMod.getProgressionSuggestion('u1', 'ex_bench', 'r_lin');
  assert.equal(sugDouble.weight_suggested, 62.5);
  assert.equal(sugDouble.reps_suggested, 8);
  assert.equal(sugDouble.progression_type, 'double');

  // 4. DUP
  dbMod.saveUserState('u1', {
    ...state,
    progressionType: 'dup',
    progressionConfig: {
      pattern: [
        { day_index: 0, rep_target: 8, intensity_pct: 80 }
      ]
    }
  });
  const sugDup = dbMod.getProgressionSuggestion('u1', 'ex_bench', 'r_lin');
  assert.equal(sugDup.reps_suggested, 8);
  assert.equal(sugDup.progression_type, 'dup');

  // Exclusión cardio
  dbMod.saveUserState('u1', { ...state, progressionType: 'linear' });
  const sugCardio = dbMod.getProgressionSuggestion('u1', 'ex_cardio', 'r_lin');
  assert.equal(sugCardio, null);
});

test.after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});
