import test from 'node:test';
import assert from 'node:assert/strict';
import { dayReminderPush, gymFeePush, restTimerPush, testPush } from './push-messages.js';

test('localizes every server-generated notification in Spanish', () => {
  assert.deepEqual(restTimerPush('es'), {
    title: 'Descanso terminado 💪',
    body: 'Es hora de tu siguiente serie.',
    tag: 'rest-timer',
  });
  assert.deepEqual(testPush('es'), {
    title: 'lauyim',
    body: 'Notificación de prueba ✅ — así se muestran las alertas.',
    tag: 'test',
  });
  assert.deepEqual(dayReminderPush('es', { name: 'Rutina A', emoji: '💪' }), {
    title: '💪 Rutina A hoy',
    body: 'Está en tu plan — vamos 💪',
    tag: 'day-reminder',
  });
});

test('keeps the existing English copy as the fallback', () => {
  assert.equal(dayReminderPush('en', null).title, 'Workout planned today');
  assert.equal(restTimerPush('unknown').title, 'Descanso terminado 💪');
  assert.equal(testPush(undefined).body, 'Notificación de prueba ✅ — así se muestran las alertas.');
});

test('localizes gym-fee reminders and preserves their frequency', () => {
  assert.deepEqual(gymFeePush('es', 'bimonthly'), {
    title: 'Cuota del gimnasio',
    body: 'Recuerda pagar tu cuota bimensual.',
    tag: 'gym-fee',
  });
  assert.deepEqual(gymFeePush('es', 'quarterly'), {
    title: 'Cuota del gimnasio',
    body: 'Recuerda pagar tu cuota trimestral.',
    tag: 'gym-fee',
  });
  assert.deepEqual(gymFeePush('en', 'quarterly'), {
    title: 'Gym membership fee',
    body: 'Remember to pay your quarterly gym membership fee.',
    tag: 'gym-fee',
  });
  assert.deepEqual(gymFeePush('en', 'annual'), {
    title: 'Gym membership fee',
    body: 'Remember to pay your annual gym membership fee.',
    tag: 'gym-fee',
  });
});

test('recordatorio de clase: título con nombre y hora; profe, sala y cuánto falta', async () => {
  const { classReminderPush } = await import('./push-messages.js');
  const base = { name: 'Spinning', date: '2026-10-05', today: '2026-10-05', start: '19:00', movedFrom: null, teacher: 'Caro', room: 'Sala 2', minutes: 60, sessionId: 'x1' };
  assert.deepEqual(classReminderPush(base), {
    title: 'Spinning · 19:00', body: 'Hoy con Caro, en Sala 2. Empieza en 1 hora.', tag: 'class-x1',
    data: { redirectUrl: '/#/plan/clases?d=2026-10-05' }
  });
  assert.equal(classReminderPush({ ...base, room: '', minutes: 15 }).body, 'Hoy con Caro. Empieza en 15 minutos.');
  assert.equal(classReminderPush({ ...base, teacher: '', minutes: 120 }).body, 'Hoy, en Sala 2. Empieza en 2 horas.');
  assert.equal(classReminderPush({ ...base, teacher: '', room: '', minutes: 30 }).body, 'Hoy. Empieza en 30 minutos.');
  assert.equal(classReminderPush({ ...base, minutes: 90 }).body, 'Hoy con Caro, en Sala 2. Empieza en 1 h 30 min.');
  assert.equal(classReminderPush({ ...base, start: '01:00', date: '2026-10-06', minutes: 300 }).body, 'Mañana con Caro, en Sala 2. Empieza en 5 horas.');
  assert.equal(classReminderPush({ ...base, start: '20:00', movedFrom: '19:00' }).body, 'Hoy cambió a las 20:00. Empieza en 1 hora.');
});

test('avisos de cambios de una clase', async () => {
  const { classChangePush } = await import('./push-messages.js');
  const base = { name: 'Spinning', date: '2026-10-05', today: '2026-10-05', start: '20:00', movedFrom: '19:00', teacher: 'Juli', sessionId: 'x1' };
  assert.equal(classChangePush('moved', base).body, 'Spinning de hoy pasa a las 20:00 (era a las 19:00).');
  assert.equal(classChangePush('moved', { ...base, date: '2026-10-07' }).body, 'Spinning del miércoles 7 pasa a las 20:00 (era a las 19:00).');
  assert.equal(classChangePush('teacher', base).body, 'Spinning de hoy lo da Juli.');
  assert.equal(classChangePush('cancelled', base).body, 'Spinning de hoy se suspende.');
  assert.equal(classChangePush('promoted', base).body, 'Entraste a Spinning de hoy a las 20:00: se liberó un lugar.');
  assert.equal(classChangePush('waitlisted', base).body, 'Spinning de hoy está llena: quedaste en la lista de espera.');
  assert.equal(classChangePush('cancelled', base).title, 'Spinning · 20:00');
  assert.deepEqual(classChangePush('cancelled', base).data, { redirectUrl: '/#/plan/clases?d=2026-10-05' });
});

test('avisos de clases: anotado a mano, cuota vencida, penalización y después de la clase', async () => {
  const { classChangePush, classAfterPush } = await import('./push-messages.js');
  const base = { name: 'Spinning', date: '2026-10-06', today: '2026-10-05', start: '19:00', sessionId: 'x1' };
  assert.equal(classChangePush('added', base).body, 'Te anotaron a Spinning de mañana a las 19:00.');
  assert.equal(classChangePush('fee_blocked', { ...base, date: '2026-10-09' }).body, 'No te anotamos a Spinning del viernes 9: tu cuota está vencida. Regularizala en recepción.');
  assert.match(classChangePush('penalty_blocked', base).body, /^No te anotamos a Spinning de mañana: por ausencias/);
  assert.deepEqual(classAfterPush(base), { title: '¿Fuiste a Spinning?', body: 'Contanos y sumala a tu historial.', tag: 'class-x1', data: { redirectUrl: '/#/plan/clases?d=2026-10-06' } });
});
