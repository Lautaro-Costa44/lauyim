// Clases en la base: tablas, alta y edición, horario, fechas guardadas, reservas con cupo y lista
// de espera (en transacción) y reservas fijas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lauyim-classes-db-'));
process.env.DATA_DIR = tmpDir;
const db = await import('./database.js');
const cdb = await import('./classes-db.js');
db.initDatabase();
for (const id of ['ana', 'beto', 'caro', 'dani']) db.createUser({ id, name: id });

const spinning = { name: 'Spinning', color: '#ff9f0a', icon: 'bike', description: 'Pedaleo', durationMin: 45, capacity: 2, teacherUserId: null, teacherName: 'Caro', room: 'Sala 2', logMode: 'muscles', log: { muscles: ['quadriceps'], intensity: 'high' } };

test('clases: alta, edición, lista sin archivadas y archivar', () => {
  const t = cdb.saveClassType(spinning);
  assert.match(t.id, /^c-[0-9a-f]+$/);
  assert.deepEqual({ ...t, id: undefined, createdAt: undefined }, { ...spinning, id: undefined, archived: false, createdAt: undefined });
  const edited = cdb.saveClassType({ ...spinning, id: t.id, capacity: 3 });
  assert.equal(edited.capacity, 3);
  assert.equal(cdb.saveClassType({ ...spinning, id: 'no-existe' }), null);
  const yoga = cdb.saveClassType({ ...spinning, name: 'Yoga' });
  assert.equal(cdb.archiveClassType(yoga.id), true);
  assert.deepEqual(cdb.getClassTypes().map(c => c.name), ['Spinning']);
  assert.deepEqual(cdb.getClassTypes({ includeArchived: true }).map(c => c.name), ['Spinning', 'Yoga']);
  cdb.saveClassType({ ...spinning, id: t.id, capacity: 2 });
});

test('horario: bloques por día y borrar uno se lleva sus reservas fijas', () => {
  const [t] = cdb.getClassTypes();
  const lun = cdb.saveClassSlot({ classId: t.id, weekday: 1, start: '19:00' });
  const mie = cdb.saveClassSlot({ classId: t.id, weekday: 3, start: '08:00' });
  assert.deepEqual(cdb.getClassSlots().map(s => `${s.weekday} ${s.start}`), ['1 19:00', '3 08:00']);
  assert.equal(cdb.saveClassSlot({ id: mie.id, classId: t.id, weekday: 3, start: '09:00' }).start, '09:00');
  cdb.addRecurring(mie.id, 'ana');
  assert.equal(cdb.deleteClassSlot(mie.id), true);
  assert.deepEqual(cdb.getRecurring({ userId: 'ana' }), []);
  assert.deepEqual(cdb.getClassSlots({ classId: t.id }).map(s => s.id), [lun.id]);
});

test('fechas guardadas: una por bloque y fecha, sueltas aparte, cambios', () => {
  const [t] = cdb.getClassTypes();
  const [slot] = cdb.getClassSlots();
  const a = cdb.ensureClassSession({ classId: t.id, slotId: slot.id, date: '2026-10-05', start: '19:00' });
  const again = cdb.ensureClassSession({ classId: t.id, slotId: slot.id, date: '2026-10-05', start: '19:00' });
  assert.equal(a.id, again.id);
  const loose = cdb.ensureClassSession({ classId: t.id, slotId: null, date: '2026-10-10', start: '10:00' });
  assert.notEqual(loose.id, a.id);
  const moved = cdb.updateClassSession(a.id, { start: '20:00', movedFrom: '19:00', teacherName: 'Juli' });
  assert.deepEqual({ start: moved.start, movedFrom: moved.movedFrom, teacherName: moved.teacherName, cancelled: moved.cancelled }, { start: '20:00', movedFrom: '19:00', teacherName: 'Juli', cancelled: false });
  assert.deepEqual(cdb.getClassSessions({ from: '2026-10-05', to: '2026-10-12' }).map(s => s.date), ['2026-10-05', '2026-10-10']);
  assert.deepEqual(cdb.getClassSessions({ from: '2026-10-06', to: '2026-10-12' }).map(s => s.id), [loose.id]);
});

test('reservas: cupo, lista de espera, repetida, forzada y cancelar sube al primero', () => {
  const [session] = cdb.getClassSessions({ from: '2026-10-05', to: '2026-10-06' });
  const book = (userId, extra = {}) => cdb.bookOrWaitlist({ sessionId: session.id, userId, capacity: 2, reminders: [60], ...extra });
  const a = book('ana');
  assert.deepEqual({ status: a.booking.status, created: a.created, reminders: a.booking.reminders }, { status: 'booked', created: true, reminders: [60] });
  assert.equal(book('beto').booking.status, 'booked');
  const c = book('caro');
  assert.deepEqual({ status: c.booking.status, pos: c.booking.waitlistPos }, { status: 'waitlist', pos: 1 });
  assert.equal(book('dani').booking.waitlistPos, 2);
  // Repetida: devuelve la que hay.
  const again = book('ana');
  assert.deepEqual({ id: again.booking.id, created: again.created }, { id: a.booking.id, created: false });
  assert.equal(cdb.countBooked(session.id), 2);
  // Cancelar sube a la primera de la lista.
  const out = cdb.cancelAndPromote({ bookingId: a.booking.id, kind: 'late_cancel', promote: true, capacity: 2 });
  assert.equal(out.booking.status, 'late_cancel');
  assert.deepEqual({ user: out.promoted.userId, status: out.promoted.status, pos: out.promoted.waitlistPos }, { user: 'caro', status: 'booked', pos: null });
  // Sin promover (pasado el corte): el lugar queda libre.
  const beto = cdb.getBookingsForSessions([session.id]).find(b => b.userId === 'beto');
  assert.equal(cdb.cancelAndPromote({ bookingId: beto.id, kind: 'cancelled', promote: false, capacity: 2 }).promoted, null);
  assert.equal(cdb.countBooked(session.id), 1);
  // Volver a reservar después de cancelar reusa la fila; forzada entra aunque esté lleno.
  assert.equal(book('beto').booking.status, 'booked');
  assert.equal(book('ana', { force: true, addedBy: 'profe' }).booking.status, 'booked');
  assert.equal(cdb.countBooked(session.id), 3);
  assert.equal(cdb.getBookingsForSessions([session.id]).find(b => b.userId === 'ana').addedBy, 'profe');
});

test('reservas: actualizar, las de un socio y las activas de un rango con su fecha', () => {
  const [session] = cdb.getClassSessions({ from: '2026-10-05', to: '2026-10-06' });
  const ana = cdb.getBookingsForSessions([session.id]).find(b => b.userId === 'ana');
  const updated = cdb.updateBooking(ana.id, { reminders: [120, 15], remindersSent: [120] });
  assert.deepEqual([updated.reminders, updated.remindersSent], [[120, 15], [120]]);
  const mine = cdb.getUserBookings('ana', { from: '2026-10-01' });
  assert.deepEqual(mine.map(b => [b.session.date, b.session.start, b.status]), [['2026-10-05', '20:00', 'booked']]);
  assert.deepEqual(cdb.getUserBookings('ana', { from: '2026-10-06' }), []);
  const active = cdb.getBookingsInRange({ from: '2026-10-05', to: '2026-10-06', statuses: ['booked'] });
  assert.ok(active.every(b => b.status === 'booked' && b.session.date === '2026-10-05'));
  assert.equal(active.length, 3);
});

test('cancelar una fecha: sus reservas pasan a canceladas y devuelve a quién avisar', () => {
  const [session] = cdb.getClassSessions({ from: '2026-10-05', to: '2026-10-06' });
  const users = cdb.cancelSessionBookings(session.id);
  assert.deepEqual(users.sort(), ['ana', 'beto', 'caro', 'dani']);
  assert.equal(cdb.countBooked(session.id), 0);
  assert.ok(cdb.getBookingsForSessions([session.id]).filter(b => b.userId !== 'ana').every(b => ['cancelled', 'late_cancel'].includes(b.status)));
});

test('reservas fijas: alta idempotente, consulta y baja', () => {
  const [slot] = cdb.getClassSlots();
  cdb.addRecurring(slot.id, 'beto');
  cdb.addRecurring(slot.id, 'beto');
  assert.deepEqual(cdb.getRecurring({ slotId: slot.id }).map(r => r.userId), ['beto']);
  assert.equal(cdb.removeRecurring(slot.id, 'beto'), true);
  assert.equal(cdb.removeRecurring(slot.id, 'beto'), false);
});
