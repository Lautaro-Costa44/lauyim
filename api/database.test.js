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
