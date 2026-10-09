// Cierres del gimnasio, lo puro: fechas, opciones, cuándo sale el aviso general, a quién se le corre
// el vencimiento y cuántos días suma una extensión al anular un pago.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closureDays, validateClosure, closureOptions, announceAtFor, extensionTargets, extensionDaysSince, CLOSURE_MAX_DAYS } from './closures.js';
import { gymClock } from './billing.js';

const TZ = 'America/Argentina/Buenos_Aires';   // UTC-3 fijo
const at = (date, time) => Date.parse(`${date}T${time}:00-03:00`);

test('closureDays cuenta los dos extremos', () => {
  assert.equal(closureDays({ from: '2026-10-12', to: '2026-10-12' }), 1);
  assert.equal(closureDays({ from: '2026-12-24', to: '2027-01-02' }), 10);
});

test('validateClosure: igual que antes (de hoy en adelante, hasta 31 días, sin superponerse, motivo corto)', () => {
  const today = '2026-10-09';
  assert.deepEqual(validateClosure({ from: '2026-10-12', reason: ' Feriado ' }, { today }).value, { from: '2026-10-12', to: '2026-10-12', reason: 'Feriado' });
  assert.equal(validateClosure({ from: '2026-10-08' }, { today }).field, 'from');
  assert.equal(validateClosure({ from: '2026-10-12', to: '2026-10-11' }, { today }).field, 'to');
  assert.equal(CLOSURE_MAX_DAYS, 31);
  assert.equal(validateClosure({ from: '2026-10-10', to: '2026-11-10' }, { today }).field, 'to');
  assert.equal(validateClosure({ from: '2026-10-12', reason: 'x'.repeat(41) }, { today }).field, 'reason');
  assert.equal(validateClosure({ from: '2026-10-12' }, { today, existing: [{ from: '2026-10-12', to: '2026-10-13' }] }).error, 'closure_overlap');
});

test('closureOptions: aviso prendido por defecto; extender de 0 a los días cerrados', () => {
  assert.deepEqual(closureOptions({}, { days: 3 }).value, { notifyAll: true, extendDays: 0 });
  assert.deepEqual(closureOptions({ notifyAll: false, extendDays: 3 }, { days: 3 }).value, { notifyAll: false, extendDays: 3 });
  assert.equal(closureOptions({ extendDays: 4 }, { days: 3 }).field, 'extendDays');
  assert.equal(closureOptions({ extendDays: 1.5 }, { days: 3 }).field, 'extendDays');
  assert.equal(closureOptions({ extendDays: -1 }, { days: 3 }).field, 'extendDays');
});

test('announceAtFor: la próxima hora de avisos, salvo que el cierre empiece antes', () => {
  // Creado a las 23:00 para mañana: sale mañana a las 08:00.
  assert.equal(announceAtFor({ from: '2026-10-10', nowMs: at('2026-10-09', '23:00'), notifyHour: '08:00', tz: TZ }), at('2026-10-10', '08:00'));
  // Creado a las 10:00 para hoy: sale en el momento.
  const now = at('2026-10-09', '10:00');
  assert.equal(announceAtFor({ from: '2026-10-09', nowMs: now, notifyHour: '08:00', tz: TZ }), now);
  // Creado a las 07:00 para hoy: sale hoy a las 08:00.
  assert.equal(announceAtFor({ from: '2026-10-09', nowMs: at('2026-10-09', '07:00'), notifyHour: '08:00', tz: TZ }), at('2026-10-09', '08:00'));
  // Creado a las 10:00 para dentro de una semana: mañana a las 08:00.
  assert.equal(announceAtFor({ from: '2026-10-16', nowMs: now, notifyHour: '08:00', tz: TZ }), at('2026-10-10', '08:00'));
  assert.equal(gymClock(at('2026-10-10', '08:00'), TZ).time, '08:00');
});

test('extensionTargets: al día y por vencer corren el vencimiento, prueba corre la prueba; el resto no', () => {
  const settings = { grace_days: 5, due_soon_days: 3, auto_block: true };
  const today = '2026-10-09';
  const row = (userId, extra) => ({ userId, planId: 1, dueDate: '2026-11-01', trialUntil: null, disabled: false, pending: false, ...extra });
  const rows = [
    row('aldia'),
    row('porvencer', { dueDate: '2026-10-11' }),
    row('vencido', { dueDate: '2026-10-07' }),
    row('bloqueado', { dueDate: '2026-09-01' }),
    row('prueba', { planId: null, dueDate: null, trialUntil: '2026-10-15' }),
    row('sinplan', { planId: null, dueDate: null }),
    row('exento'),
    row('baja', { disabled: true }),
    row('pendiente', { pending: true })
  ];
  assert.deepEqual(extensionTargets(rows, today, settings, r => r.userId === 'exento'), [
    { userId: 'aldia', field: 'due', before: '2026-11-01' },
    { userId: 'porvencer', field: 'due', before: '2026-10-11' },
    { userId: 'prueba', field: 'trial', before: '2026-10-15' }
  ]);
});

test('extensionDaysSince: suma lo aplicado después del pago y no revertido', () => {
  const ext = [
    { field: 'due', days: 3, appliedAt: 100, revertedAt: null },
    { field: 'due', days: 2, appliedAt: 300, revertedAt: null },
    { field: 'due', days: 7, appliedAt: 400, revertedAt: 500 },
    { field: 'trial', days: 5, appliedAt: 300, revertedAt: null }
  ];
  assert.equal(extensionDaysSince(ext, 200), 2);
  assert.equal(extensionDaysSince(ext, 0), 5);
  assert.equal(extensionDaysSince([], 0), 0);
});
