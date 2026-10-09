// Recordatorios de suplementos en el tick: a su hora, si falta tomarlo, una vez por día, nunca con el
// módulo apagado, sin aviso aceptado ni a quien sacó el consentimiento.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-scheduler-supp-'));
process.env.DATA_DIR = dataDir;
const db = await import('./database.js');
const sdb = await import('./supplements-db.js');
const { runSchedulerTick } = await import('./scheduler.js');
const { SUPP_ACK_VERSION } = await import('./supplements.js');
const { gymClock, getBillingSettings } = await import('./billing.js');
db.initDatabase();
after(() => { db.closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

for (const id of ['ana', 'beto']) {
  db.createUser({ id, name: id, created: Date.now(), healthConsent: true });
  db.getDatabase().prepare('INSERT INTO subscriptions (endpoint, user_id, keys, created_at) VALUES (?, ?, ?, ?)').run('https://push/' + id, id, '{}', Date.now());
  sdb.setAck(id, SUPP_ACK_VERSION, 1);
}
const tz = getBillingSettings(db.getDatabase()).gym_tz;
// Un instante del día de hoy en la zona del gimnasio a la hora HH:MM.
function at(hhmm) {
  const now = Date.now();
  const local = gymClock(now, tz);
  const diffMin = (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) - (Number(local.time.slice(0, 2)) * 60 + Number(local.time.slice(3)));
  return now + diffMin * 60000;
}
const today = gymClock(Date.now(), tz).date;
sdb.saveItem('ana', { id: 'crea0001', catalogId: 'creatina', dose: 5, unit: 'g', doses: 1, slot: 'morning', days: 'daily', reminderTime: '09:00' });
sdb.saveItem('beto', { id: 'crea0002', catalogId: 'creatina', dose: 5, unit: 'g', doses: 1, slot: 'morning', days: 'daily', reminderTime: '09:00' });
// Las fechas de alta: ayer, así hoy ya toca.
db.getDatabase().prepare("UPDATE supplement_items SET created_at = '2000-01-01T00:00:00Z'").run();
sdb.addLog('beto', { id: 'blog0001', itemId: 'crea0002', date: today, amount: 5 });

async function tick(now) {
  const sent = [];
  runSchedulerTick({ now, sendToUser: async (userId, payload) => { sent.push({ userId, payload }); return { sent: 1 }; } });
  await new Promise(r => setTimeout(r, 50));
  return sent.filter(s => s.payload.tag?.startsWith('supp-'));
}

test('a su hora, solo a quien le falta, una vez por día', async () => {
  assert.deepEqual(await tick(at('08:58')), []);
  const first = await tick(at('09:01'));
  assert.deepEqual(first.map(s => s.userId), ['ana']);
  assert.match(first[0].payload.title, /Creatina: te falta la de hoy/);
  assert.deepEqual(await tick(at('09:02')), []);
});

test('apagado por el owner o sin consentimiento: nada', async () => {
  db.getDatabase().prepare("DELETE FROM supplement_profile WHERE user_id = 'ana'").run();
  sdb.setAck('ana', SUPP_ACK_VERSION, 1);
  db.setAdminSetting('supplements_enabled', '0');
  assert.deepEqual(await tick(at('09:00')), []);
  db.setAdminSetting('supplements_enabled', '1');
  db.getDatabase().prepare("UPDATE users SET health_consent = 'declined' WHERE id = 'ana'").run();
  assert.deepEqual(await tick(at('09:00')), []);
});
