import test from 'node:test';
import assert from 'node:assert/strict';
import { billingDuePush, dayReminderPush, gymFeePush, restTimerPush, testPush, closureAnnouncePush, closureReopenPush, supplementReminderPush } from './push-messages.js';

test('localizes every server-generated notification in Spanish', () => {
  assert.deepEqual(restTimerPush('es'), {
    title: 'Descanso terminado 💪',
    body: 'Es hora de tu siguiente serie.',
    tag: 'rest-timer',
  });
  assert.deepEqual(testPush('es'), {
    title: 'lauyim',
    body: 'Así te van a llegar los avisos ✅',
    tag: 'test',
  });
  assert.deepEqual(dayReminderPush('es', { name: 'Piernas', emoji: 'dumbbell' }), {
    title: 'Hoy toca Piernas 🏋️',
    body: 'Está en tu plan. ¡Vamos!',
    tag: 'day-reminder',
  });
  assert.equal(dayReminderPush('es', null).title, 'Hoy toca entrenar 🏋️');
});

test('keeps the existing English copy as the fallback', () => {
  assert.deepEqual(dayReminderPush('en', { name: 'Legs' }), { title: 'Legs today 🏋️', body: "It's on your plan. Let's go!", tag: 'day-reminder' });
  assert.equal(dayReminderPush('en', null).title, 'Workout day 🏋️');
  assert.equal(restTimerPush('unknown').title, 'Descanso terminado 💪');
  assert.equal(testPush(undefined).body, 'Así te van a llegar los avisos ✅');
  assert.equal(testPush('en').body, 'This is how your alerts will look ✅');
});

test('ningún aviso usa rayas ni el tú, y lleva un emoji como mucho', async () => {
  const mod = await import('./push-messages.js');
  const base = { name: 'Spinning', date: '2026-10-05', today: '2026-10-05', start: '19:00', movedFrom: '18:00', teacher: 'Caro', prevTeacher: 'Juli', room: 'Sala 2', minutes: 60, sessionId: 'x', waitlistPos: 2, until: '2026-10-12' };
  const all = [
    mod.restTimerPush('es'), mod.testPush('es'), mod.dayReminderPush('es', { name: 'A' }), mod.dayReminderPush('es', null),
    mod.gymFeePush('es', 'monthly'), mod.billingDuePush('es', 0), mod.billingDuePush('es', 3), mod.classReminderPush(base), mod.classAfterPush(base),
    ...['moved', 'teacher', 'cancelled', 'promoted', 'waitlisted', 'added', 'fee_blocked', 'penalty_blocked'].map(k => mod.classChangePush(k, base))
  ];
  for (const p of all) {
    const text = `${p.title} ${p.body}`;
    assert.doesNotMatch(text, /—|–/, text);
    assert.doesNotMatch(text, /\b(Recuerda|Paga|Renueva)\b/, text);
    assert.ok([...text.matchAll(/\p{Extended_Pictographic}/gu)].length <= 1, text);
  }
});

test('localizes gym-fee reminders and preserves their frequency', () => {
  assert.deepEqual(gymFeePush('es', 'bimonthly'), {
    title: 'Cuota del gimnasio',
    body: 'Recordá pagar tu cuota bimensual.',
    tag: 'gym-fee',
  });
  assert.deepEqual(gymFeePush('es', 'quarterly'), {
    title: 'Cuota del gimnasio',
    body: 'Recordá pagar tu cuota trimestral.',
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

test('vencimiento de la cuota: el título dice cuándo vence', () => {
  assert.deepEqual(billingDuePush('es', 0), { title: 'Tu cuota vence hoy', body: 'Renovala en recepción para seguir entrenando.', tag: 'billing-due' });
  assert.equal(billingDuePush('es', 1).title, 'Tu cuota vence mañana');
  assert.equal(billingDuePush('es', 3).title, 'Tu cuota vence en 3 días');
  assert.equal(billingDuePush('en', 0).title, 'Your membership is due today');
  assert.equal(billingDuePush('en', 2).body, 'Renew it at the front desk to keep training.');
});

test('recordatorio de clase: el título dice cuánto falta; día, hora, profe y sala', async () => {
  const { classReminderPush } = await import('./push-messages.js');
  const base = { name: 'Spinning', date: '2026-10-05', today: '2026-10-05', start: '19:00', movedFrom: null, teacher: 'Caro', room: 'Sala 2', minutes: 60, sessionId: 'x1' };
  assert.deepEqual(classReminderPush(base), {
    title: 'Spinning empieza en 1 hora', body: 'Hoy a las 19:00 con Caro, en Sala 2.', tag: 'class-x1',
    data: { redirectUrl: '/#/plan/clases?d=2026-10-05' }
  });
  assert.equal(classReminderPush({ ...base, minutes: 15 }).title, 'Spinning empieza en 15 minutos');
  assert.equal(classReminderPush({ ...base, minutes: 120 }).title, 'Spinning empieza en 2 horas');
  assert.equal(classReminderPush({ ...base, minutes: 90 }).title, 'Spinning empieza en 1 h 30 min');
  assert.equal(classReminderPush({ ...base, room: '' }).body, 'Hoy a las 19:00 con Caro.');
  assert.equal(classReminderPush({ ...base, teacher: '' }).body, 'Hoy a las 19:00, en Sala 2.');
  assert.equal(classReminderPush({ ...base, teacher: '', room: '' }).body, 'Hoy a las 19:00.');
  assert.equal(classReminderPush({ ...base, start: '01:00', date: '2026-10-06', minutes: 300 }).body, 'Mañana a las 01:00 con Caro, en Sala 2.');
  // Cambio de horario: lo dice y no pierde profe ni sala.
  assert.equal(classReminderPush({ ...base, start: '20:00', movedFrom: '19:00' }).body, 'Hoy a las 20:00 (cambió, era a las 19:00) con Caro, en Sala 2.');
});

test('avisos de cambios de una clase: el título dice qué pasó', async () => {
  const { classChangePush } = await import('./push-messages.js');
  const base = { name: 'Spinning', date: '2026-10-05', today: '2026-10-05', start: '20:00', movedFrom: '19:00', teacher: 'Juli', sessionId: 'x1' };
  const moved = classChangePush('moved', base);
  assert.deepEqual([moved.title, moved.body], ['Cambio de horario: Spinning', 'Spinning de hoy pasa a las 20:00 (era a las 19:00).']);
  assert.equal(classChangePush('moved', { ...base, date: '2026-10-07' }).body, 'Spinning del miércoles 7 pasa a las 20:00 (era a las 19:00).');
  const teacher = classChangePush('teacher', { ...base, prevTeacher: 'Caro' });
  assert.deepEqual([teacher.title, teacher.body], ['Cambio de profe: Spinning', 'Spinning de hoy a las 20:00 lo da Juli en lugar de Caro.']);
  assert.equal(classChangePush('teacher', base).body, 'Spinning de hoy a las 20:00 lo da Juli.');
  assert.equal(classChangePush('teacher', { ...base, teacher: null, prevTeacher: 'Caro' }).body, 'Spinning de hoy a las 20:00 ya no lo da Caro.');
  const cancelled = classChangePush('cancelled', base);
  assert.deepEqual([cancelled.title, cancelled.body], ['Se suspendió Spinning', 'Spinning de hoy a las 20:00 no se da. Tu lugar quedó liberado.']);
  const promoted = classChangePush('promoted', base);
  assert.deepEqual([promoted.title, promoted.body], ['¡Entraste a Spinning!', 'Se liberó un lugar para hoy a las 20:00. Si no podés ir, cancelala así entra otra persona.']);
  const waitlisted = classChangePush('waitlisted', { ...base, waitlistPos: 3 });
  assert.deepEqual([waitlisted.title, waitlisted.body], ['Lista de espera: Spinning', 'Spinning de hoy a las 20:00 está llena. Quedaste n.º 3 en la lista de espera; si se libera un lugar, te avisamos.']);
  assert.equal(classChangePush('waitlisted', base).body, 'Spinning de hoy a las 20:00 está llena. Quedaste en la lista de espera; si se libera un lugar, te avisamos.');
  assert.deepEqual(cancelled.data, { redirectUrl: '/#/plan/clases?d=2026-10-05' });
  assert.equal(cancelled.tag, 'class-x1');
});

test('avisos de clases: anotado a mano, cuota vencida, penalización y después de la clase', async () => {
  const { classChangePush, classAfterPush } = await import('./push-messages.js');
  const base = { name: 'Spinning', date: '2026-10-06', today: '2026-10-05', start: '19:00', sessionId: 'x1' };
  const added = classChangePush('added', base);
  assert.deepEqual([added.title, added.body], ['Te anotaron a Spinning', 'Tenés lugar mañana a las 19:00. Si no podés ir, cancelala desde la app.']);
  const fee = classChangePush('fee_blocked', { ...base, date: '2026-10-09' });
  assert.deepEqual([fee.title, fee.body], ['No pudimos anotarte', 'Tu reserva fija de Spinning del viernes 9 no se hizo porque tu cuota está vencida. Regularizala en recepción.']);
  const penalty = classChangePush('penalty_blocked', { ...base, until: '2026-10-12' });
  assert.deepEqual([penalty.title, penalty.body], ['No pudimos anotarte', 'Tu reserva fija de Spinning de mañana no se hizo por las ausencias. Podés volver a reservar desde el 12/10.']);
  assert.deepEqual(classAfterPush(base), { title: '¿Fuiste a Spinning?', body: 'Tocá para sumarla a tu historial y calificarla.', tag: 'class-x1', data: { redirectUrl: '/#/plan/clases?d=2026-10-06' } });
});

test('mensaje de la profe a los anotados: título con la clase, cuerpo con quién y el texto', async () => {
  const { classMessagePush } = await import('./push-messages.js');
  const p = classMessagePush({ name: 'Spinning', date: '2026-10-06', today: '2026-10-05', start: '10:00', sender: 'Caro', text: 'Traigan toalla', sessionId: 'x1' });
  assert.deepEqual(p, { title: 'Spinning de mañana a las 10:00', body: 'Caro: Traigan toalla', tag: 'class-msg-x1', data: { redirectUrl: '/#/plan/clases?d=2026-10-06' } });
});

test('aviso a la profe antes de su clase', async () => {
  const { teacherReminderPush } = await import('./push-messages.js');
  const base = { name: 'Spinning', date: '2026-10-05', start: '19:00', minutes: 60, booked: 8, waitlist: 2, sessionId: 'x1' };
  assert.deepEqual(teacherReminderPush(base), { title: 'Spinning en 1 hora', body: '8 anotados · 2 en espera', tag: 'class-teach-x1', data: { redirectUrl: '/#/plan/clases?d=2026-10-05' } });
  assert.equal(teacherReminderPush({ ...base, booked: 1, waitlist: 0 }).body, '1 anotado');
  assert.equal(teacherReminderPush({ ...base, booked: 0, waitlist: 0 }).body, 'Todavía no se anotó nadie.');
  assert.equal(teacherReminderPush({ ...base, minutes: 30 }).title, 'Spinning en 30 minutos');
});

test('cierre del gimnasio: un aviso por persona con sus clases', async () => {
  const { closurePush } = await import('./push-messages.js');
  const one = closurePush({ from: '2026-10-12', to: '2026-10-12', today: '2026-10-05', reason: 'Feriado', items: [{ name: 'Spinning', start: '19:00' }, { name: 'GAP', start: '20:30' }] });
  assert.deepEqual([one.title, one.body], ['El lunes 12 no hay clases', 'Feriado. Se suspendieron Spinning 19:00 y GAP 20:30; tu lugar quedó liberado.']);
  assert.deepEqual(one.data, { redirectUrl: '/#/plan/clases?d=2026-10-12' });
  const single = closurePush({ from: '2026-10-06', to: '2026-10-06', today: '2026-10-05', reason: '', items: [{ name: 'Spinning', start: '19:00' }] });
  assert.deepEqual([single.title, single.body], ['Mañana no hay clases', 'Se suspendió Spinning 19:00; tu lugar quedó liberado.']);
  const range = closurePush({ from: '2027-01-02', to: '2027-01-15', today: '2026-12-20', reason: 'Vacaciones', items: Array.from({ length: 6 }, () => ({ name: 'Spinning', start: '19:00' })) });
  assert.deepEqual([range.title, range.body], ['Sin clases del 2/1 al 15/1', 'Vacaciones. Se suspendieron tus 6 reservas.']);
  assert.equal(closurePush({ from: '2027-01-02', to: '2027-01-15', today: '2026-12-20', reason: '', items: [{ name: 'GAP', start: '20:30', date: '2027-01-04' }] }).body, 'Se suspendió tu reserva de GAP del lunes 4.');
});

test('avisos desde la ficha: el staff canceló tu lugar y levantó la penalización', async () => {
  const { classChangePush, penaltyResetPush } = await import('./push-messages.js');
  const p = classChangePush('staff_cancelled', { name: 'Spinning', date: '2026-10-05', today: '2026-10-05', start: '19:00', sessionId: 'x' });
  assert.deepEqual([p.title, p.body], ['Se canceló tu lugar en Spinning', 'El gimnasio canceló tu lugar de hoy a las 19:00. Si fue un error, avisá en recepción.']);
  assert.deepEqual(penaltyResetPush(), { title: 'Ya podés volver a reservar clases', body: 'El gimnasio levantó tu penalización por ausencias.', tag: 'class-penalty', data: { redirectUrl: '/#/plan/clases' } });
});

test('reserva fija sin lugar en el plan', async () => {
  const { classChangePush } = await import('./push-messages.js');
  const p = classChangePush('plan_limit', { name: 'Spinning', date: '2026-10-05', today: '2026-10-02', start: '19:00', sessionId: 'x', limit: 2, period: 'week' });
  assert.deepEqual([p.title, p.body], ['No pudimos anotarte', 'Tu reserva fija de Spinning del lunes 5 no se hizo: tu plan incluye 2 clases por semana y esa semana ya tenés 2.']);
  assert.equal(classChangePush('plan_limit', { name: 'GAP', date: '2026-10-05', today: '2026-10-02', start: '19:00', sessionId: 'x', limit: 1, period: 'month' }).body,
    'Tu reserva fija de GAP del lunes 5 no se hizo: tu plan incluye 1 clase por mes y ese mes ya la tenés.');
});

test('closureAnnouncePush y closureReopenPush', () => {
  const one = closureAnnouncePush({ from: '2026-10-12', to: '2026-10-12', today: '2026-10-09', reason: 'Feriado' });
  assert.equal(one.title, 'El lunes 12 el gimnasio cierra');
  assert.equal(one.body, 'Feriado. Podés seguir usando la app para entrenar en casa o cargar tus comidas.');
  assert.equal(one.tag, 'gym-closure-2026-10-12');
  assert.equal(one.data.redirectUrl, '/#/home');
  const today = closureAnnouncePush({ from: '2026-10-09', to: '2026-10-09', today: '2026-10-09', reason: '' });
  assert.equal(today.title, 'Hoy el gimnasio está cerrado');
  assert.equal(today.body, 'Podés seguir usando la app para entrenar en casa o cargar tus comidas.');
  const range = closureAnnouncePush({ from: '2026-12-24', to: '2027-01-02', today: '2026-10-09', reason: 'Vacaciones' });
  assert.equal(range.title, 'El gimnasio cierra del 24/12 al 2/1');
  const reopen = closureReopenPush({ from: '2026-10-10', today: '2026-10-09' });
  assert.equal(reopen.title, 'Al final el gimnasio abre mañana');
  assert.equal(reopen.tag, 'gym-closure-2026-10-10');
  assert.equal(closureReopenPush({ from: '2026-10-09', today: '2026-10-09' }).title, 'Al final el gimnasio abre hoy');
});

test('supplementReminderPush: nombre del catálogo, dosis por toma y abre Nutrición', () => {
  const p = supplementReminderPush({ catalogId: 'betaalanina', dose: 3.2, unit: 'g', doses: 2 });
  assert.equal(p.title, 'Beta-alanina: dosis 1 de 2');
  assert.equal(p.body, '1,6 g. Tocá para marcarla.');
  assert.equal(p.data.redirectUrl, '/#/nutricion');
  assert.equal(supplementReminderPush({ catalogId: null, name: 'Ashwagandha', dose: null }).title, 'Ashwagandha: te falta la de hoy');
});
