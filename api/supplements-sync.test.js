import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-supp-sync-'));
process.env.DATA_DIR = dataDir;
const db = await import('./database.js');
const sdb = await import('./supplements-db.js');
const { processSyncBatch } = await import('./sync.js');
const { SUPP_ACK_VERSION } = await import('./supplements.js');
const { gymToday } = await import('./billing.js');
db.initDatabase();
after(() => { db.closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
db.createUser({ id: 'ana', name: 'ana', created: Date.now(), healthConsent: true });
const today = gymToday(Date.now(), 'America/Argentina/Buenos_Aires');
const run = ops => processSyncBatch({ db: db.getDatabase(), userId: 'ana', operations: ops, getUserState: db.getUserState, saveUserState: db.saveUserState });
const op = (id, request) => ({ id, createdAt: Date.now(), changes: [{ request: { ...request, opId: id } }] });

test('sin aviso aceptado el pedido es conflicto; con aviso se aplica una sola vez', () => {
  sdb.saveItem('ana', { id: 'crea0001', catalogId: 'creatina', dose: 5, unit: 'g', doses: 1 });
  const add = { kind: 'supp-log-add', payload: { id: 'log00001', itemId: 'crea0001', date: today, amount: 5 } };
  assert.equal(run([op('op000001', add)]).conflicts.length, 1);
  sdb.setAck('ana', SUPP_ACK_VERSION, 1);
  assert.equal(run([op('op000002', add)]).conflicts.length, 0);
  assert.equal(run([op('op000003', add)]).conflicts.length, 0);   // idempotente por id
  assert.equal(sdb.listLogs('ana', today).length, 1);
  assert.equal(run([op('op000004', { kind: 'supp-log-delete', payload: { id: 'log00001' } })]).conflicts.length, 0);
  assert.equal(sdb.listLogs('ana', today).length, 0);
});
