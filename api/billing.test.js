import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  BILLING_DEFAULTS, addDays, daysBetween, gymToday, gymClock, isIsoDate,
  billingStatus, nextDueDate, debtFor, debtTotal, shouldSendDuePush,
  validateBillingSettings, getBillingSettings, serializeBillingSetting
} from './billing.js';

const S = { ...BILLING_DEFAULTS, due_soon_days: 5, push_days_before: 3, grace_days: 5 };
const plan = dueDate => ({ planId: 1, dueDate });

test('fechas: suma de días en fin de mes, fin de año y años bisiestos', () => {
  assert.equal(addDays('2026-01-31', 30), '2026-03-02');
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-25', 10), '2027-01-04');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');   // 2028 es bisiesto
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');   // 2027 no
  assert.equal(addDays('2026-03-10', -10), '2026-02-28');
  assert.equal(daysBetween('2028-02-01', '2028-03-01'), 29);
  assert.equal(daysBetween('2027-02-01', '2027-03-01'), 28);
  assert.equal(isIsoDate('2027-02-29'), false);
  assert.equal(isIsoDate('2026-13-01'), false);
  assert.throws(() => addDays('mañana', 1));
});

test('gymToday usa la tz del gym, no la del servidor', () => {
  const at0200utc = Date.UTC(2026, 2, 1, 2, 0);    // 1/3 02:00 UTC = 28/2 23:00 en Buenos Aires
  assert.equal(gymToday(at0200utc, 'America/Argentina/Buenos_Aires'), '2026-02-28');
  assert.equal(gymToday(at0200utc, 'UTC'), '2026-03-01');
  assert.equal(gymToday(at0200utc, 'No/Existe'), '2026-03-01');   // tz inválida cae a UTC
  assert.deepEqual(gymClock(Date.UTC(2026, 2, 1, 13, 5), 'America/Argentina/Buenos_Aires'), { date: '2026-03-01', time: '10:05' });
  assert.equal(gymClock(Date.UTC(2026, 2, 1, 3, 0), 'America/Argentina/Buenos_Aires').time, '00:00');
});

test('billingStatus: cada estado y sus bordes exactos', () => {
  const due = '2026-03-20';
  assert.equal(billingStatus({ planId: null, dueDate: due }, '2026-03-01', S), 'sin_plan');
  assert.equal(billingStatus({}, '2026-03-01', S), 'sin_plan');
  assert.equal(billingStatus(plan(due), '2026-03-14', S), 'al_dia');       // faltan 6
  assert.equal(billingStatus(plan(due), '2026-03-15', S), 'por_vencer');   // faltan 5 = due_soon_days
  assert.equal(billingStatus(plan(due), '2026-03-20', S), 'por_vencer');   // today = due
  assert.equal(billingStatus(plan(due), '2026-03-21', S), 'vencido');      // due + 1
  assert.equal(billingStatus(plan(due), '2026-03-25', S), 'vencido');      // due + grace
  assert.equal(billingStatus(plan(due), '2026-03-26', S), 'bloqueado');    // due + grace + 1
  assert.equal(billingStatus(plan(due), '2026-03-21', { ...S, grace_days: 0 }), 'bloqueado');
  assert.equal(billingStatus(plan(null), '2026-03-21', S), 'al_dia');      // plan sin vencimiento: no bloquea
});

test('nextDueDate: sin vencimiento, en término, en tolerancia y ya bloqueado', () => {
  assert.deepEqual(nextDueDate(null, '2026-03-04', 30, 5), { dueDate: '2026-04-03', periodStart: '2026-03-04', periodEnd: '2026-04-03' });
  // vence el 1 y paga el 4: conserva su fecha
  assert.deepEqual(nextDueDate('2026-03-01', '2026-03-04', 30, 5), { dueDate: '2026-03-31', periodStart: '2026-03-01', periodEnd: '2026-03-31' });
  // paga antes de vencer: el período nuevo sigue al actual
  assert.equal(nextDueDate('2026-03-01', '2026-02-25', 30, 5).dueDate, '2026-03-31');
  // today = due + grace: todavía conserva la fecha
  assert.equal(nextDueDate('2026-03-01', '2026-03-06', 30, 5).dueDate, '2026-03-31');
  // today = due + grace + 1 (bloqueado): arranca hoy
  assert.deepEqual(nextDueDate('2026-03-01', '2026-03-07', 30, 5), { dueDate: '2026-04-06', periodStart: '2026-03-07', periodEnd: '2026-04-06' });
  // fin de mes y bisiesto
  assert.equal(nextDueDate('2026-01-31', '2026-01-31', 30, 5).dueDate, '2026-03-02');
  assert.equal(nextDueDate('2028-01-30', '2028-01-30', 30, 5).dueDate, '2028-02-29');
});

test('deuda: un período por socio, solo vencido o bloqueado', () => {
  assert.equal(debtFor('vencido', 20000), 20000);
  assert.equal(debtFor('bloqueado', 20000), 20000);
  assert.equal(debtFor('por_vencer', 20000), 0);
  assert.equal(debtFor('al_dia', 20000), 0);
  assert.equal(debtFor('sin_plan', null), 0);
  assert.equal(debtTotal([{ debt: 20000 }, { debt: 0 }, { debt: 15000 }]), 35000);
  assert.equal(debtTotal([]), 0);
});

test('shouldSendDuePush: ventana de días y una sola vez por vencimiento', () => {
  const due = '2026-03-10';
  assert.equal(shouldSendDuePush(plan(due), '2026-03-06', S), false);   // faltan 4
  assert.equal(shouldSendDuePush(plan(due), '2026-03-07', S), true);    // faltan 3 = push_days_before
  assert.equal(shouldSendDuePush(plan(due), '2026-03-10', S), true);    // vence hoy
  assert.equal(shouldSendDuePush(plan(due), '2026-03-11', S), false);   // ya vencido
  assert.equal(shouldSendDuePush({ ...plan(due), pushSentForDue: due }, '2026-03-08', S), false);
  assert.equal(shouldSendDuePush({ ...plan(due), pushSentForDue: '2026-02-08' }, '2026-03-08', S), true);
  assert.equal(shouldSendDuePush({ planId: null, dueDate: due }, '2026-03-08', S), false);
});

test('validateBillingSettings: rangos, métodos y tz', () => {
  assert.deepEqual(validateBillingSettings({ grace_days: 0, due_soon_days: 30 }).value, { grace_days: 0, due_soon_days: 30 });
  for (const bad of [{ grace_days: 31 }, { grace_days: -1 }, { push_days_before: 1.5 }, { due_soon_days: '5' },
    { payment_methods: [] }, { payment_methods: ['cheque'] }, { payment_methods: 'efectivo' }, { gym_tz: 'Marte/Olympus' }, null, []]) {
    assert.ok(validateBillingSettings(bad).error, JSON.stringify(bad));
  }
  assert.deepEqual(validateBillingSettings({ payment_methods: ['otro', 'efectivo', 'otro'] }).value, { payment_methods: ['efectivo', 'otro'] });
  assert.deepEqual(validateBillingSettings({ gym_tz: 'Europe/Madrid' }).value, { gym_tz: 'Europe/Madrid' });
});

test('getBillingSettings: defaults, valores guardados y valores corruptos', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE admin_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  assert.deepEqual(getBillingSettings(db), BILLING_DEFAULTS);
  const put = db.prepare('INSERT OR REPLACE INTO admin_settings (key, value, updated_at) VALUES (?, ?, 0)');
  put.run('grace_days', serializeBillingSetting('grace_days', 7));
  put.run('payment_methods', serializeBillingSetting('payment_methods', ['transferencia']));
  put.run('gym_tz', 'Europe/Madrid');
  put.run('due_soon_days', 'basura');          // corrupto: vuelve al default, sin afectar al resto
  assert.deepEqual(getBillingSettings(db), { ...BILLING_DEFAULTS, grace_days: 7, payment_methods: ['transferencia'], gym_tz: 'Europe/Madrid' });
  db.close();
});
