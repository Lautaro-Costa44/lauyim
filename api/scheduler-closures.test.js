// Aviso general de un cierre en el tick: sale una vez, cuando toca, sin los avisados por reserva y
// nunca para un cierre que ya terminó.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-scheduler-closures-'));
process.env.DATA_DIR = dataDir;
const db = await import('./database.js');
const kdb = await import('./closures-db.js');
const { runSchedulerTick } = await import('./scheduler.js');
const { gymClock, getBillingSettings } = await import('./billing.js');
const { addDays } = await import('./classes.js');
db.initDatabase();
after(() => { db.closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

for (const id of ['ana', 'beto', 'caro']) {
  db.createUser({ id, name: id, created: Date.now() });
  db.getDatabase().prepare('INSERT INTO subscriptions (endpoint, user_id, keys, created_at) VALUES (?, ?, ?, ?)').run('https://push/' + id, id, '{}', Date.now());
}
const today = gymClock(Date.now(), getBillingSettings(db.getDatabase()).gym_tz).date;

async function tick(now = Date.now()) {
  const sent = [];
  runSchedulerTick({ now, sendToUser: async (userId, payload) => { sent.push({ userId, payload }); return { sent: 1 }; } });
  await new Promise(r => setTimeout(r, 50));
  return sent.filter(s => s.payload.tag?.startsWith('gym-closure-'));
}

test('sale una vez a su hora, sin los avisados por reserva', async () => {
  const at = Date.now() + 3600000;
  const k = kdb.addClosure({ from: addDays(today, 2), to: addDays(today, 2), reason: 'Feriado', notifyAll: true, announceAt: at, notifiedIds: ['caro'] });
  assert.deepEqual(await tick(), []);
  const first = await tick(at + 1);
  assert.deepEqual(first.map(s => s.userId).sort(), ['ana', 'beto']);
  assert.match(first[0].payload.title, /el gimnasio cierra/);
  assert.deepEqual(await tick(at + 60000), []);
  kdb.deleteClosure(k.id);
});

test('un cierre que ya terminó no se avisa; uno sin "avisar a todos" tampoco', async () => {
  const old = kdb.addClosure({ from: addDays(today, -3), to: addDays(today, -2), notifyAll: true, announceAt: 1 });
  const quiet = kdb.addClosure({ from: addDays(today, 3), to: addDays(today, 3), notifyAll: false, announceAt: 1 });
  assert.deepEqual(await tick(), []);
  kdb.deleteClosure(old.id); kdb.deleteClosure(quiet.id);
});
