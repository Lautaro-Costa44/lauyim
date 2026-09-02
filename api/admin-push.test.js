import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'opengym-adminpush-'));
process.env.DATA_DIR = tmpDir;

const dbMod = await import('./database.js');

test('getAllSubscriptions returns all stored subscriptions', () => {
  dbMod.initDatabase();
  dbMod.createUser({ id: 'u1', name: 'User 1', admin: true, disabled: false, created: Date.now() });
  dbMod.createSubscription({ userId: 'u1', endpoint: 'https://push.example.com/1', keys: { p256dh: 'a', auth: 'b' }, created: Date.now() });
  dbMod.createSubscription({ userId: 'u1', endpoint: 'https://push.example.com/2', keys: { p256dh: 'c', auth: 'd' }, created: Date.now() });

  const subs = dbMod.getAllSubscriptions();
  assert.equal(subs.length, 2);
  assert.equal(subs[0].endpoint, 'https://push.example.com/1');
});

test.after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});
