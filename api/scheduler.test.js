// Avisos del scheduler: un socio sin suscripciones push no entra al tick (ni intento de envío
// ni console.error cada minuto). El control con suscripción prueba que el aviso sí se dispara.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-scheduler-'));
process.env.DATA_DIR = dataDir;

const db = await import('./database.js');
const { runSchedulerTick } = await import('./scheduler.js');
const { gymToday } = await import('./billing.js');

after(() => {
  db.closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// Zona fija en la que ahora son las 12:xx: el aviso de vencimiento sale desde las 10:00.
function noonZone() {
  const offset = 12 - new Date().getUTCHours();          // Etc/GMT-N es UTC+N
  return offset === 0 ? 'Etc/GMT' : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

test('socio sin suscripciones con vencimiento en ventana: sin intento de envío ni error', async () => {
  db.initDatabase();
  const tz = noonZone();
  db.setAdminSetting('gym_tz', tz);
  const today = gymToday(Date.now(), tz);
  const plan = db.createPlan({ name: 'Mensual', price: 20000, durationDays: 30 });
  for (const id of ['owner', 'nosub', 'withsub']) db.createUser({ id, name: id });
  db.setMemberBilling('nosub', { planId: plan.id, dueDate: today });
  db.setMemberBilling('withsub', { planId: plan.id, dueDate: today });
  // Host fuera de la allowlist: sendPushToSubscription lo rechaza sin abrir conexión.
  db.createSubscription({ endpoint: 'https://push.invalid/x', userId: 'withsub', keys: { p256dh: 'x', auth: 'x' } });

  const lines = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try {
    runSchedulerTick();
    await new Promise(resolve => setTimeout(resolve, 100));
  } finally {
    Object.assign(console, orig);
  }

  assert.ok(lines.some(l => l.includes('user_id=withsub')), 'el control con suscripción tiene que intentar el envío:\n' + lines.join('\n'));
  assert.deepEqual(lines.filter(l => l.includes('nosub')), []);
  assert.equal(db.getMemberBilling('nosub').pushSentForDue ?? null, null);
});
