// Avisos de cuota del scheduler: la hora de avisos del gym (billing_notify_hour), el dedupe y
// el interruptor de cuotas. Reloj fijo (`now`) y envío falso (`sendToUser`): sin red ni esperas.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-scheduler-billing-'));
process.env.DATA_DIR = dataDir;

const db = await import('./database.js');
const { runSchedulerTick } = await import('./scheduler.js');

const TODAY = '2026-09-24';
const at = hhmm => Date.parse(`${TODAY}T${hhmm}:00Z`);        // gym_tz UTC: hora del gym = UTC
let sent;
const sendToUser = async (userId, payload) => { sent.push({ userId, tag: payload.tag }); return { sent: 1, subCount: 1 }; };
const tick = async hhmm => {
  runSchedulerTick({ now: at(hhmm), sendToUser });
  await new Promise(resolve => setTimeout(resolve, 10));      // deja guardar el dedupe
};
const tags = userId => sent.filter(s => s.userId === userId).map(s => s.tag);

function member(id, { planDue, feeOn } = {}) {
  db.createUser({ id, name: id });
  db.createSubscription({ endpoint: `https://push.invalid/${id}`, userId: id, keys: { p256dh: 'x', auth: 'x' } });
  if (planDue) db.setMemberBilling(id, { planId: plan.id, dueDate: planDue });
  // Recordatorio manual: mensual, con el día de hoy como día de pago.
  if (feeOn) {
    db.getDatabase().prepare(`INSERT INTO reminder_settings (user_id, "on", time, tz, fee_on, fee_interval, fee_date)
      VALUES (?, 0, '07:00', 'UTC', 1, 'monthly', '2026-08-24')`).run(id);
  }
}

let plan;
before(() => {
  db.initDatabase();
  db.createUser({ id: 'owner', name: 'owner' });
  db.setAdminSetting('gym_tz', 'UTC');
  plan = db.createPlan({ name: 'Mensual', price: 20000, durationDays: 30 });
  member('withPlan', { planDue: '2026-09-26', feeOn: true });   // aviso de vencimiento en ventana
  member('manual', { feeOn: true });                              // sin plan, recordatorio manual
});

after(() => {
  db.closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

beforeEach(() => { sent = []; });

test('cuotas encendido: nada sale antes de la hora de avisos (default 12:00)', async () => {
  await tick('08:00');
  await tick('11:59');
  assert.deepEqual(sent, []);
});

test('desde la hora de avisos: aviso de vencimiento al que tiene plan, manual al que no; una sola vez', async () => {
  await tick('12:00');
  assert.deepEqual(tags('withPlan'), ['billing-due']);   // con plan, el manual no sale
  assert.deepEqual(tags('manual'), ['gym-fee']);
  await tick('12:01');
  await tick('18:30');
  assert.equal(sent.length, 2);
  assert.equal(db.getMemberBilling('withPlan').pushSentForDue, '2026-09-26');
});

test('el recordatorio manual no usa la hora del recordatorio de entrenamiento', async () => {
  member('early', { feeOn: true });                       // su recordatorio de entrenamiento es 07:00
  db.setAdminSetting('billing_notify_hour', '15:00');
  await tick('07:00');
  await tick('14:59');
  assert.deepEqual(tags('early'), []);
  await tick('15:00');
  assert.deepEqual(tags('early'), ['gym-fee']);
});

test('cuotas apagado: sin aviso de vencimiento y el manual sale aunque tenga plan', async () => {
  member('offPlan', { planDue: '2026-09-25', feeOn: true });
  db.setAdminSetting('billing_notify_hour', '12:00');
  db.setAdminSetting('billing_enabled', '0');
  await tick('11:00');
  assert.deepEqual(sent, []);
  await tick('13:00');
  assert.deepEqual(tags('offPlan'), ['gym-fee']);
  assert.deepEqual(tags('withPlan'), ['gym-fee']);        // con plan, pero ahora sale el manual
  assert.deepEqual(tags('manual'), []);                   // ya le salió hoy (dedupe diario)
  assert.equal(db.getMemberBilling('offPlan').pushSentForDue ?? null, null);
  await tick('13:01');
  assert.deepEqual(tags('offPlan'), ['gym-fee']);
});
