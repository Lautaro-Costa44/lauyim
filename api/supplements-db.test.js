import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-supp-db-'));
process.env.DATA_DIR = dataDir;
const db = await import('./database.js');
const sdb = await import('./supplements-db.js');
db.initDatabase();
db.createUser({ id: 'ana', name: 'ana', created: Date.now() });
db.createUser({ id: 'beto', name: 'beto', created: Date.now() });
after(() => { db.closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

const item = { id: 'it1', catalogId: 'creatina', name: null, dose: 5, unit: 'g', scoopG: 5, doses: 1, slot: 'morning', days: 'daily', reminderTimes: ['09:00'], meta: null };

test('items: alta, edición, archivo y aislamiento por usuario', () => {
  const saved = sdb.saveItem('ana', item);
  assert.equal(saved.status, 'active');
  assert.equal(sdb.saveItem('ana', { ...item, dose: 3 }).dose, 3);
  assert.equal(sdb.listItems('ana').length, 1);
  assert.equal(sdb.listItems('beto').length, 0);
  assert.equal(sdb.getItem('beto', 'it1'), null);
  assert.equal(sdb.setItemStatus('ana', 'it1', 'archived'), true);
  assert.equal(sdb.getItem('ana', 'it1').status, 'archived');
  assert.equal(sdb.setItemStatus('beto', 'it1', 'active'), false);
  sdb.setItemStatus('ana', 'it1', 'active');
});

test('tomas: idempotentes por id, por fecha, y borrar devuelve la fila', () => {
  const l = { id: 'l1', itemId: 'it1', date: '2026-10-09', source: null, amount: 5, comidaId: null };
  sdb.addLog('ana', l);
  sdb.addLog('ana', l);
  sdb.addLog('ana', { id: 'l2', itemId: null, date: '2026-10-09', source: 'mate', amount: 80, comidaId: null });
  assert.equal(sdb.listLogs('ana', '2026-10-01').length, 2);
  assert.equal(sdb.listLogs('ana', '2026-10-10').length, 0);
  assert.equal(sdb.deleteLog('beto', 'l2'), null);
  assert.equal(sdb.deleteLog('ana', 'l2').source, 'mate');
});

test('perfil: aviso, mayoría de edad y recordatorios enviados', () => {
  assert.deepEqual(sdb.getProfile('ana'), { ackVersion: null, ackAt: null, adult: null, lastReminderSent: {} });
  sdb.setAck('ana', '2026-10-09', 1);
  sdb.markReminderSent('ana', 'it1', '2026-10-09');
  const p = sdb.getProfile('ana');
  assert.equal(p.ackVersion, '2026-10-09'); assert.equal(p.adult, 1); assert.deepEqual(p.lastReminderSent, { it1: '2026-10-09' });
  assert.deepEqual(sdb.itemsWithReminders().map(i => [i.userId, i.id]), [['ana', 'it1']]);
});

test('eliminar un item borra sus tomas; borrar datos de salud borra todo', () => {
  sdb.saveItem('ana', { ...item, id: 'it2', reminderTimes: [] });
  sdb.addLog('ana', { id: 'l3', itemId: 'it2', date: '2026-10-09', source: null, amount: 5, comidaId: null });
  assert.equal(sdb.deleteItem('ana', 'it2'), true);
  assert.equal(sdb.getLog('ana', 'l3'), null);
  db.deleteHealthData('ana', []);
  assert.equal(sdb.listItems('ana').length, 0);
  assert.equal(sdb.listLogs('ana', '2000-01-01').length, 0);
  assert.equal(sdb.getProfile('ana').ackVersion, null);
});
