// Clases en el tick del scheduler: el recordatorio sale una sola vez, con el tiempo que falta de
// verdad, no para canceladas ni para la lista de espera; la reserva fija reserva sola la fecha
// que entra en la ventana.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-scheduler-classes-'));
process.env.DATA_DIR = dataDir;

const db = await import('./database.js');
const cdb = await import('./classes-db.js');
const { runSchedulerTick } = await import('./scheduler.js');
const { gymClock } = await import('./billing.js');
const { addMinutes, addDays, weekdayOf } = await import('./classes.js');

after(() => {
  db.closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// Zona fija en la que ahora son las 12:xx: la clase de dentro de 30 minutos cae el mismo día.
function noonZone() {
  const offset = 12 - new Date().getUTCHours();
  return offset === 0 ? 'Etc/GMT' : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

db.initDatabase();
const tz = noonZone();
db.setAdminSetting('gym_tz', tz);
const clock = gymClock(Date.now(), tz);
for (const id of ['owner', 'ana', 'beto', 'caro', 'dani']) db.createUser({ id, name: id });
const spinning = cdb.saveClassType({ name: 'Spinning', color: '#ff9f0a', icon: 'bike', description: '', durationMin: 45, capacity: 2, teacherUserId: null, teacherName: 'Caro', room: 'Sala 2', logMode: 'muscles', log: { muscles: ['quadriceps'], intensity: 'high' } });
const start = addMinutes(clock.time, 30);
const slot = cdb.saveClassSlot({ classId: spinning.id, weekday: weekdayOf(clock.date), start });
const session = cdb.ensureClassSession({ classId: spinning.id, slotId: slot.id, date: clock.date, start });
const yesterday = new Date(Date.now() - 86400000).toISOString();
const book = (userId, extra = {}) => {
  const { booking } = cdb.bookOrWaitlist({ sessionId: session.id, userId, capacity: 2, reminders: [60, 15], ...extra });
  db.getDatabase().prepare('UPDATE class_bookings SET created_at = ? WHERE id = ?').run(yesterday, booking.id);
  return booking;
};
const ana = book('ana');
const beto = book('beto');
cdb.cancelAndPromote({ bookingId: beto.id, kind: 'cancelled', promote: false, capacity: 2 });
book('caro');
book('dani');   // lleno: lista de espera

async function tick() {
  const sent = [];
  runSchedulerTick({ sendToUser: async (userId, payload) => { sent.push({ userId, payload }); return { sent: 1 }; } });
  await new Promise(resolve => setTimeout(resolve, 50));
  return sent.filter(s => s.payload.tag?.startsWith('class-'));
}

test('recordatorio: una vez, con lo que falta de verdad; ni canceladas ni lista de espera', async () => {
  const first = await tick();
  assert.deepEqual(first.map(s => s.userId).sort(), ['ana', 'caro']);
  const toAna = first.find(s => s.userId === 'ana').payload;
  assert.match(toAna.title, /^Spinning empieza en (29|30) minutos$/);
  assert.equal(toAna.body, `Hoy a las ${start} con Caro, en Sala 2.`);
  assert.deepEqual(cdb.getBooking(ana.id).remindersSent, [60]);
  assert.deepEqual(await tick(), []);
});

test('reserva fija: reserva sola la fecha que está en la ventana', async () => {
  const tomorrow = addDays(clock.date, 1);
  const slot2 = cdb.saveClassSlot({ classId: spinning.id, weekday: weekdayOf(tomorrow), start: '10:00' });
  cdb.addRecurring(slot2.id, 'beto');
  await tick();
  const mine = cdb.getUserBookings('beto', { from: tomorrow });
  assert.deepEqual(mine.map(b => [b.session.date, b.session.start, b.status]), [[tomorrow, '10:00', 'booked']]);
  await tick();
  assert.equal(cdb.getUserBookings('beto', { from: tomorrow }).length, 1);
});

test('la profe anotada a la clase que da: el tick le cancela la reserva y entra la primera de la lista', async () => {
  const tomorrow = addDays(clock.date, 1);
  const yoga = cdb.saveClassType({ name: 'Yoga', color: '#30d158', icon: 'yoga', description: '', durationMin: 60, capacity: 1, teacherUserId: 'owner', teacherName: '', room: 'Sala 3', logMode: 'muscles', log: { muscles: ['core'], intensity: 'low' } });
  const s = cdb.ensureClassSession({ classId: yoga.id, slotId: null, date: tomorrow, start: '10:00' });
  const own = cdb.bookOrWaitlist({ sessionId: s.id, userId: 'owner', capacity: 1 }).booking;
  const wait = cdb.bookOrWaitlist({ sessionId: s.id, userId: 'beto', capacity: 1 }).booking;
  assert.equal(wait.status, 'waitlist');
  const sent = await tick();
  assert.equal(cdb.getBooking(own.id).status, 'cancelled');
  assert.equal(cdb.getBooking(wait.id).status, 'booked');
  assert.deepEqual(sent.filter(m => m.userId === 'beto').map(m => m.payload.title), ['¡Entraste a Yoga!']);
});

test('aviso a la profe: una vez, con cuántos hay; apagado o suspendida, nada', async () => {
  const at = addMinutes(clock.time, 45);
  const type = (name, teacherUserId) => cdb.saveClassType({ name, color: '#30d158', icon: 'boxing', description: '', durationMin: 60, capacity: 10, teacherUserId, teacherName: '', room: 'Sala 4', logMode: 'muscles', log: { muscles: ['core'], intensity: 'high' } });
  const box = cdb.ensureClassSession({ classId: type('Box', 'caro').id, slotId: null, date: clock.date, start: at });
  cdb.bookOrWaitlist({ sessionId: box.id, userId: 'ana', capacity: 10 });
  cdb.ensureClassSession({ classId: type('Off', 'dani').id, slotId: null, date: clock.date, start: at });
  cdb.setTeacherReminder('dani', 0);
  const sus = cdb.ensureClassSession({ classId: type('Sus', 'beto').id, slotId: null, date: clock.date, start: at });
  cdb.updateClassSession(sus.id, { cancelled: true });
  const teach = list => list.filter(m => m.payload.tag.startsWith('class-teach-'));
  const sent = teach(await tick());
  assert.deepEqual(sent.map(m => m.userId), ['caro']);
  assert.match(sent[0].payload.title, /^Box en 4[45] minutos$/);
  assert.equal(sent[0].payload.body, '1 anotado');
  assert.deepEqual(teach(await tick()), []);
});
