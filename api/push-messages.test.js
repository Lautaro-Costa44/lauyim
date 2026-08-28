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
  assert.deepEqual(gymFeePush('en', 'annual'), {
    title: 'Gym membership fee',
    body: 'Remember to pay your annual gym membership fee.',
    tag: 'gym-fee',
  });
});
