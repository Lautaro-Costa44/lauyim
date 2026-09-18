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
    onboardingNutritionCompletado: true,
    reminder: null,
    equipProfiles: []
  };

  assert.doesNotThrow(() => dbMod.saveUserState('u1', state));

  const saved = dbMod.getUserState('u1');
  assert.equal(saved.week[0], null);
  assert.equal(saved.dayPlan['2025-01-01'], null);
  assert.equal(saved.workouts[0].routineId, null);
  assert.equal(saved.onboardingNutritionCompletado, true);
});


test.after(async () => {
  dbMod.closeDatabase();
  await rm(tmpDir, { recursive: true, force: true });
});

test('first user becomes owner and owner implies admin', () => {
  dbMod.initDatabase();
  dbMod.getDatabase().exec('DELETE FROM users');
  dbMod.createUser({ id: 'owner1', name: 'First', admin: false, disabled: false, created: Date.now() });
  dbMod.createUser({ id: 'user2', name: 'Second', admin: false, disabled: false, created: Date.now() });

  assert.equal(dbMod.getUserById('owner1').owner, 1);
  assert.equal(dbMod.getUserById('owner1').admin, 1);
  assert.equal(dbMod.getUserById('user2').owner, 0);
});

test('QR access token is generated once and persisted in admin_settings', () => {
  dbMod.initDatabase();
  const first = dbMod.getOrCreateQrAccessToken();
  const second = dbMod.getOrCreateQrAccessToken();

  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(second, first);
  assert.equal(dbMod.getAdminSetting('qr_access_token'), first);
});

test('getRoutineGroups defaults to empty for a user with no state row yet (GET admin routines → 200 vacío)', () => {
  dbMod.initDatabase();
  dbMod.createUser({ id: 'nogroups1', name: 'Sin grupos', admin: false, disabled: false, created: Date.now() });

  const { routineGroups, activeGroupId } = dbMod.getRoutineGroups('nogroups1');
  assert.deepEqual(routineGroups, []);
  assert.equal(activeGroupId, null);
  assert.deepEqual(dbMod.getRoutinesByUserId('nogroups1'), []);
});

test('saveRoutineGroups/getRoutineGroups round-trip (Fase 7: grupos del panel admin)', () => {
  dbMod.initDatabase();
  dbMod.createUser({ id: 'groups1', name: 'Con grupos', admin: false, disabled: false, created: Date.now() });

  const groups = [
    { id: 'g1', name: 'Push/Pull/Legs', routines: [{ id: 'r1', name: 'Push', emoji: 'dumbbell', created: 1, ex: [] }], week: { 0: 'r1' }, createdAt: 1 }
  ];
  dbMod.saveRoutineGroups('groups1', groups, 'g1');

  const loaded = dbMod.getRoutineGroups('groups1');
  assert.equal(loaded.activeGroupId, 'g1');
  assert.equal(loaded.routineGroups.length, 1);
  assert.equal(loaded.routineGroups[0].name, 'Push/Pull/Legs');
  assert.equal(loaded.routineGroups[0].routines[0].id, 'r1');
});

test('getLesiones defaults to empty and saveLesiones preserves other respuestasEncuesta fields', () => {
  dbMod.initDatabase();
  dbMod.createUser({ id: 'inj1', name: 'Con lesión', admin: false, disabled: false, created: Date.now() });

  assert.deepEqual(dbMod.getLesiones('inj1'), []);

  dbMod.saveUserState('inj1', {
    _ts: Date.now(), unit: 'kg', routines: [], week: {}, dayPlan: {}, workouts: [],
    exWeights: {}, bodyweight: [], customEx: [], exNotes: {}, reminder: null, equipProfiles: [],
    respuestasEncuesta: { sexoBiologico: 'femenino', diasSeleccionados: ['lunes'], lesiones: [] }
  });

  dbMod.saveLesiones('inj1', ['hombros', 'rodillas']);
  assert.deepEqual(dbMod.getLesiones('inj1'), ['hombros', 'rodillas']);

  const state = dbMod.getUserState('inj1');
  assert.equal(state.respuestasEncuesta.sexoBiologico, 'femenino');
  assert.deepEqual(state.respuestasEncuesta.diasSeleccionados, ['lunes']);
  assert.deepEqual(state.respuestasEncuesta.lesiones, ['hombros', 'rodillas']);
});

test('setNutritionGoals/getNutritionGoals round-trip objetivo + caloriesBurn (A.3)', () => {
  dbMod.initDatabase();
  dbMod.createUser({ id: 'goals1', name: 'Con metas', admin: false, disabled: false, created: Date.now() });

  const defaults = dbMod.getNutritionGoals('goals1');
  assert.equal(defaults.mode, 'automatic');
  assert.equal(defaults.objetivo, null);
  assert.equal(defaults.caloriesBurn, null);

  dbMod.setNutritionGoals('goals1', {
    mode: 'manual', objetivo: 'perder_grasa', calories: 1800, caloriesBurn: 2500,
    protein: 140, carbs: 180, fat: 55, updatedAt: Date.now(), updatedBy: 'admin1'
  });
  const saved = dbMod.getNutritionGoals('goals1');
  assert.equal(saved.objetivo, 'perder_grasa');
  assert.equal(saved.caloriesBurn, 2500);
  assert.equal(saved.calories, 1800);

  // Metas guardadas ANTES de que existieran objetivo/caloriesBurn (sin esas keys en el JSON)
  // siguen leyéndose bien — vuelven null por el merge con el default, no rompen.
  const db = dbMod.getDatabase();
  db.prepare('UPDATE user_state SET nutrition_goals = ? WHERE user_id = ?')
    .run(JSON.stringify({ mode: 'manual', calories: 2000, protein: 150, carbs: 200, fat: 60 }), 'goals1');
  const legacy = dbMod.getNutritionGoals('goals1');
  assert.equal(legacy.objetivo, null);
  assert.equal(legacy.caloriesBurn, null);
  assert.equal(legacy.calories, 2000);
});

test('writes for a user without state create user_state with _ts', () => {
  dbMod.initDatabase();
  const db = dbMod.getDatabase();
  const users = ['goals-no-state', 'limit-no-state', 'injuries-no-state', 'groups-no-state', 'routines-no-state'];
  for (const id of users) dbMod.createUser({ id, name: id, admin: false, disabled: false, created: Date.now() });

  dbMod.setNutritionGoals('goals-no-state', { mode: 'manual', calories: 1800 });
  dbMod.setNutritionGoals('limit-no-state', { mode: 'automatic', limitarSugeridas: true });
  dbMod.saveLesiones('injuries-no-state', ['hombros']);
  dbMod.saveRoutineGroups('groups-no-state', [{ id: 'g1', name: 'Fuerza', routines: [] }], 'g1');
  dbMod.saveRoutines('routines-no-state', [{ id: 'r1', name: 'Rutina', ex: [] }]);

  for (const id of users) {
    const row = db.prepare('SELECT _ts FROM user_state WHERE user_id = ?').get(id);
    assert.ok(row, `missing user_state for ${id}`);
    assert.equal(typeof row._ts, 'number');
    assert.ok(row._ts > 0);
  }
  assert.equal(dbMod.getNutritionGoals('goals-no-state').calories, 1800);
  assert.equal(dbMod.getNutritionGoals('limit-no-state').limitarSugeridas, true);
  assert.deepEqual(dbMod.getLesiones('injuries-no-state'), ['hombros']);
  assert.equal(dbMod.getRoutineGroups('groups-no-state').activeGroupId, 'g1');
  assert.equal(dbMod.getRoutinesByUserId('routines-no-state')[0].id, 'r1');
});

test('setNutritionGoals updates an existing user_state row with _ts', () => {
  dbMod.initDatabase();
  const db = dbMod.getDatabase();
  dbMod.createUser({ id: 'existing-state-goals', name: 'Existing state', admin: false, disabled: false, created: Date.now() });
  db.prepare('INSERT INTO user_state (user_id, _ts) VALUES (?, ?)').run('existing-state-goals', 100);

  dbMod.setNutritionGoals('existing-state-goals', { mode: 'manual', calories: 1900 });

  const row = db.prepare('SELECT _ts, nutrition_goals FROM user_state WHERE user_id = ?').get('existing-state-goals');
  assert.equal(row.nutrition_goals, JSON.stringify({ mode: 'manual', calories: 1900 }));
  assert.ok(row._ts >= 100);
});

test('deleteUser removes a disabled user and cascades their data', () => {
  dbMod.initDatabase();
  const db = dbMod.getDatabase();
  db.exec('DELETE FROM users');
  dbMod.createUser({ id: 'owner1', name: 'Owner', admin: false, disabled: false, created: Date.now() });
  dbMod.createUser({ id: 'disabled1', name: 'Disabled', admin: false, disabled: true, created: Date.now() });

  db.prepare('INSERT INTO user_state (user_id, _ts) VALUES (?, ?)').run('disabled1', Date.now());
  db.prepare('INSERT INTO routines (id, user_id, name, created_at) VALUES (?, ?, ?, ?)').run('r1', 'disabled1', 'Routine', Date.now());
  db.prepare('INSERT INTO workouts (id, user_id, date, start, end, name) VALUES (?, ?, ?, ?, ?, ?)').run('w1', 'disabled1', '2026-01-01', 1, 2, 'Workout');
  db.prepare('INSERT INTO invites (code, created_by, created_at) VALUES (?, ?, ?)').run('INV1', 'disabled1', Date.now());

  const deleted = dbMod.deleteUser('disabled1');
  assert.equal(deleted.id, 'disabled1');
  assert.equal(dbMod.getUserById('disabled1'), undefined);
  assert.equal(db.prepare('SELECT 1 FROM user_state WHERE user_id = ?').get('disabled1'), undefined);
  assert.equal(db.prepare('SELECT 1 FROM routines WHERE user_id = ?').get('disabled1'), undefined);
  assert.equal(db.prepare('SELECT 1 FROM workouts WHERE user_id = ?').get('disabled1'), undefined);
  assert.equal(db.prepare('SELECT 1 FROM invites WHERE code = ?').get('INV1'), undefined);
  assert.ok(dbMod.getUserById('owner1'));
});
