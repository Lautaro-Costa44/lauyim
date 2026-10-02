import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  canAsk, resolveAttendance, canTakeAttendance, canRate, afterPushDue, zonedToEpoch, classWorkout, classStats, penaltyOf,
  CLASS_DEFAULTS, REMINDER_OPTIONS, MUSCLE_SLUGS, classSettingsOf, validateClassSettings, validateClassType, validateSlot,
  capOf, teacherReminderDue, TEACHER_REMINDER_OPTIONS, validateClosure, addMinutes, occurrencesBetween, overlapConflicts, conflictText, bookingState, cancelKind, canPromote, remindersDue, buildIcs
} from './classes.js';

const spinning = { id: 'spin', name: 'Spinning', color: '#ff9f0a', icon: 'bike', description: '', durationMin: 45, capacity: 12, teacherUserId: null, teacherName: 'Caro', room: 'Sala 2', logMode: 'muscles', log: { muscles: ['quadriceps'], intensity: 'high' }, archived: false };
const pilates = { ...spinning, id: 'pil', name: 'Pilates', durationMin: 60, teacherName: 'Ana', room: 'Sala 1' };
// 2026-10-05 es lunes.
const slots = [
  { id: 's-lun', classId: 'spin', weekday: 1, start: '19:00' },
  { id: 's-mie', classId: 'spin', weekday: 3, start: '08:00' },
  { id: 'p-lun', classId: 'pil', weekday: 1, start: '18:30' }
];
const occs = (extra = {}) => occurrencesBetween({ types: [spinning, pilates], slots, sessions: [], from: '2026-10-05', days: 7, ...extra });

test('ajustes: defectos, lo guardado y los rangos', () => {
  assert.deepEqual(classSettingsOf(null), CLASS_DEFAULTS);
  assert.deepEqual(CLASS_DEFAULTS, { enabled: true, bookAheadDays: 7, cancelHours: 2, waitlistCutoffMin: 60, allowOverlap: false, afterPush: { on: true, minutes: 30 }, penalty: { on: false, absences: 3, windowDays: 30, blockDays: 7 } });
  assert.deepEqual(classSettingsOf({ afterPush: { on: false, minutes: 200 }, penalty: { on: true, absences: 5 } }).penalty, { on: true, absences: 5, windowDays: 30, blockDays: 7 });
  assert.deepEqual(classSettingsOf({ afterPush: { on: false, minutes: 200 } }).afterPush, { on: false, minutes: 30 });
  assert.equal(validateClassSettings({ afterPush: { minutes: 181 } }).field, 'afterPush.minutes');
  assert.equal(validateClassSettings({ penalty: { on: true, blockDays: 0 } }).field, 'penalty.blockDays');
  assert.deepEqual(validateClassSettings({ penalty: { on: true, absences: 2, windowDays: 14, blockDays: 3 } }).value.penalty, { on: true, absences: 2, windowDays: 14, blockDays: 3 });
  assert.equal(classSettingsOf(JSON.stringify({ bookAheadDays: 14 })).bookAheadDays, 14);
  assert.equal(classSettingsOf('roto').cancelHours, 2);
  assert.equal(classSettingsOf({ bookAheadDays: 99 }).bookAheadDays, 7);
  assert.deepEqual(validateClassSettings({ enabled: false, bookAheadDays: 3, cancelHours: 0, waitlistCutoffMin: 30, allowOverlap: true }).value,
    { ...CLASS_DEFAULTS, enabled: false, bookAheadDays: 3, cancelHours: 0, waitlistCutoffMin: 30, allowOverlap: true });
  assert.equal(validateClassSettings({ bookAheadDays: 0 }).field, 'bookAheadDays');
  assert.equal(validateClassSettings({ cancelHours: 49 }).field, 'cancelHours');
  assert.equal(validateClassSettings({ waitlistCutoffMin: 721 }).field, 'waitlistCutoffMin');
  assert.deepEqual(REMINDER_OPTIONS, [300, 120, 60, 30, 15]);
});

test('MUSCLE_SLUGS coincide con los músculos del mapa del frontend', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../frontend/src/lib/muscles.js', import.meta.url)), 'utf8');
  const block = src.slice(src.indexOf('export const MUSCLES = ['), src.indexOf(']', src.indexOf('export const MUSCLES = [')));
  assert.deepEqual(MUSCLE_SLUGS, [...block.matchAll(/'([a-z-]+)'/g)].map(m => m[1]));
});

test('validateClassType: músculos e intensidad', () => {
  const ok = validateClassType({ name: ' Spinning ', color: '#FF9F0A', durationMin: 45, capacity: 12, teacherName: 'Caro', room: 'Sala 2', logMode: 'muscles', log: { muscles: ['quadriceps', 'calves', 'quadriceps'], intensity: 'high' } });
  assert.deepEqual(ok.value, { name: 'Spinning', color: '#ff9f0a', icon: 'dumbbell', description: '', durationMin: 45, capacity: 12, teacherUserId: null, teacherName: 'Caro', room: 'Sala 2', logMode: 'muscles', log: { muscles: ['quadriceps', 'calves'], intensity: 'high' } });
  const base = { name: 'X', color: '#000000', durationMin: 45, capacity: 10, logMode: 'muscles', log: { muscles: ['abs'], intensity: 'low' } };
  assert.equal(validateClassType({ ...base, log: { muscles: [], intensity: 'low' } }).field, 'log');
  assert.equal(validateClassType({ ...base, log: { muscles: ['alas'], intensity: 'low' } }).field, 'log');
  assert.equal(validateClassType({ ...base, log: { muscles: ['abs'], intensity: 'extrema' } }).field, 'log');
  assert.equal(validateClassType({ ...base, name: '' }).field, 'name');
  assert.equal(validateClassType({ ...base, name: 'spinning' }, { activeNames: ['Spinning'] }).field, 'name');
  assert.equal(validateClassType({ ...base, color: 'rojo' }).field, 'color');
  assert.equal(validateClassType({ ...base, durationMin: 10 }).field, 'durationMin');
  assert.equal(validateClassType({ ...base, capacity: 0 }).field, 'capacity');
  assert.equal(validateClassType({ ...base, description: 'x'.repeat(501) }).field, 'description');
  assert.equal(validateClassType({ ...base, room: 'x'.repeat(31) }).field, 'room');
  // Profe con cuenta: el nombre suelto se descarta.
  assert.deepEqual(validateClassType({ ...base, teacherUserId: 'u1', teacherName: 'Otra' }).value.teacherName, '');
  assert.equal(validateClassType({ ...base, teacherUserId: 'u1' }).value.teacherUserId, 'u1');
  assert.equal(validateClassType({ ...base, teacherName: 'x'.repeat(41) }).field, 'teacherName');
});

test('validateClassType: ejercicios', () => {
  const base = { name: 'Funcional', color: '#30d158', durationMin: 60, capacity: 20, logMode: 'exercises' };
  assert.deepEqual(validateClassType({ ...base, log: { exercises: [{ id: 'sq', sets: 3, reps: 12 }] } }).value.log, { exercises: [{ id: 'sq', sets: 3, reps: 12 }] });
  assert.equal(validateClassType({ ...base, log: { exercises: [] } }).field, 'log');
  assert.equal(validateClassType({ ...base, log: { exercises: [{ id: 'sq', sets: 0, reps: 12 }] } }).field, 'log');
  assert.equal(validateClassType({ ...base, log: { exercises: [{ id: 'sq', sets: 3, reps: 101 }] } }).field, 'log');
  assert.equal(validateClassType({ ...base, log: { exercises: Array.from({ length: 31 }, (_, i) => ({ id: 'e' + i, sets: 1, reps: 1 })) } }).field, 'log');
  assert.equal(validateClassType({ ...base, logMode: 'otro', log: {} }).field, 'logMode');
});

test('validateSlot y addMinutes', () => {
  assert.deepEqual(validateSlot({ weekday: 3, start: '08:00' }).value, { weekday: 3, start: '08:00' });
  assert.equal(validateSlot({ weekday: 7, start: '08:00' }).field, 'weekday');
  assert.equal(validateSlot({ weekday: 1, start: '25:00' }).field, 'start');
  assert.equal(validateSlot({ weekday: 1, start: '8:00' }).field, 'start');
  assert.equal(addMinutes('19:00', 45), '19:45');
  assert.equal(addMinutes('23:30', 60), '00:30');
});

test('fechas de la semana: bloques, cambio de hora, cancelada, suelta y archivada', () => {
  const week = occs();
  assert.deepEqual(week.map(o => `${o.date} ${o.start}-${o.end} ${o.type.name}`), [
    '2026-10-05 18:30-19:30 Pilates', '2026-10-05 19:00-19:45 Spinning', '2026-10-07 08:00-08:45 Spinning'
  ]);
  assert.equal(week[1].key, 's-lun:2026-10-05');
  assert.equal(week[1].teacherName, 'Caro');
  const sessions = [
    { id: 'x1', classId: 'spin', slotId: 's-lun', date: '2026-10-05', start: '20:00', movedFrom: '19:00', teacherUserId: null, teacherName: 'Juli', cancelled: false },
    { id: 'x2', classId: 'spin', slotId: 's-mie', date: '2026-10-07', start: '08:00', movedFrom: null, teacherUserId: null, teacherName: null, cancelled: true },
    { id: 'x3', classId: 'pil', slotId: null, date: '2026-10-10', start: '10:00', movedFrom: null, teacherUserId: null, teacherName: null, cancelled: false }
  ];
  const changed = occs({ sessions });
  const moved = changed.find(o => o.key === 's-lun:2026-10-05');
  assert.deepEqual({ start: moved.start, movedFrom: moved.movedFrom, teacher: moved.teacherName, sessionId: moved.sessionId }, { start: '20:00', movedFrom: '19:00', teacher: 'Juli', sessionId: 'x1' });
  assert.equal(changed.find(o => o.key === 's-mie:2026-10-07').cancelled, true);
  const loose = changed.find(o => o.key === 'x3');
  assert.deepEqual({ slotId: loose.slotId, date: loose.date, teacher: loose.teacherName }, { slotId: null, date: '2026-10-10', teacher: 'Ana' });
  // Archivada: sin fechas nuevas, pero la sesión guardada sigue apareciendo.
  const archived = occurrencesBetween({ types: [{ ...spinning, archived: true }, pilates], slots, sessions: [sessions[0]], from: '2026-10-05', days: 7 });
  assert.deepEqual(archived.filter(o => o.classId === 'spin').map(o => o.key), ['s-lun:2026-10-05']);
  // Profe con cuenta: el nombre sale de userNames.
  const withUser = occurrencesBetween({ types: [{ ...spinning, teacherUserId: 'u1', teacherName: '' }], slots: [slots[0]], sessions: [], from: '2026-10-05', days: 1, userNames: { u1: 'Caro Díaz' } });
  assert.deepEqual({ id: withUser[0].teacherUserId, name: withUser[0].teacherName }, { id: 'u1', name: 'Caro Díaz' });
});

test('superposición: sala, sin sala, permitida, misma profe y la propia fecha', () => {
  const week = occs();
  const at = (start, extra = {}) => ({ key: 'nuevo', date: '2026-10-05', start, end: addMinutes(start, 60), room: 'Sala 1', teacherUserId: null, teacherName: 'Lu', ...extra });
  // Pisa a Pilates (Sala 1, 18:30-19:30).
  const hit = overlapConflicts(at('19:00'), week, { allowOverlap: false });
  assert.equal(hit.blocking.length, 1);
  assert.deepEqual(hit.blocking[0], { reason: 'room', name: 'Pilates', date: '2026-10-05', start: '18:30', end: '19:30', room: 'Sala 1', teacher: 'Ana' });
  assert.equal(conflictText(hit.blocking[0]), 'Ya hay Pilates el lunes de 18:30 a 19:30 en Sala 1, con Ana.');
  // Sala distinta: nada. Sin sala: choca con todas las del horario.
  assert.equal(overlapConflicts(at('19:00', { room: 'Sala 3' }), week, { allowOverlap: false }).blocking.length, 0);
  assert.equal(overlapConflicts(at('19:00', { room: '' }), week, { allowOverlap: false }).blocking.length, 2);
  // Pegadas (termina 18:30, empieza 18:30): no se pisan.
  assert.equal(overlapConflicts(at('17:30'), week, { allowOverlap: false }).blocking.length, 0);
  // Permitida: aviso en vez de bloqueo.
  const allowed = overlapConflicts(at('19:00'), week, { allowOverlap: true });
  assert.deepEqual([allowed.blocking.length, allowed.warnings.length], [0, 1]);
  // Misma profe en otra sala: siempre aviso.
  const teacher = overlapConflicts(at('19:00', { room: 'Sala 3', teacherName: 'caro' }), week, { allowOverlap: false });
  assert.deepEqual([teacher.blocking.length, teacher.warnings[0].reason], [0, 'teacher']);
  assert.equal(conflictText(teacher.warnings[0]), 'Caro ya da Spinning el lunes de 19:00 a 19:45.');
  // La propia fecha no choca consigo misma, y una cancelada no cuenta.
  assert.equal(overlapConflicts({ ...week[0], end: week[0].end }, week, { allowOverlap: false }).blocking.length, 0);
  const cancelled = week.map(o => o.classId === 'pil' ? { ...o, cancelled: true } : o);
  assert.equal(overlapConflicts(at('19:00'), cancelled, { allowOverlap: false }).blocking.length, 0);
});

test('reservar: ventana, empezada y cancelada', () => {
  const occ = occs()[1]; // lunes 2026-10-05 19:00
  const s = CLASS_DEFAULTS;
  assert.equal(bookingState({ occ, now: { date: '2026-09-27', time: '23:59' }, settings: s }), 'not_yet');
  assert.equal(bookingState({ occ, now: { date: '2026-09-28', time: '00:00' }, settings: s }), 'open');
  assert.equal(bookingState({ occ, now: { date: '2026-10-05', time: '18:59' }, settings: s }), 'open');
  assert.equal(bookingState({ occ, now: { date: '2026-10-05', time: '19:00' }, settings: s }), 'started');
  assert.equal(bookingState({ occ: { ...occ, cancelled: true }, now: { date: '2026-10-05', time: '10:00' }, settings: s }), 'cancelled');
});

test('cancelar a tiempo o tarde, y corte de la lista de espera', () => {
  const occ = occs()[1];
  const s = CLASS_DEFAULTS;
  assert.equal(cancelKind({ occ, now: { date: '2026-10-05', time: '17:00' }, settings: s }), 'cancelled');
  assert.equal(cancelKind({ occ, now: { date: '2026-10-05', time: '17:01' }, settings: s }), 'late_cancel');
  assert.equal(canPromote({ occ, now: { date: '2026-10-05', time: '17:59' }, settings: s }), true);
  assert.equal(canPromote({ occ, now: { date: '2026-10-05', time: '18:00' }, settings: s }), false);
});

test('recordatorios: a su hora, una vez, y no los que ya habían pasado al reservar', () => {
  const occ = occs()[1];
  const base = { occ, reminders: [60, 15], sent: [], bookedAt: { date: '2026-10-04', time: '10:00' } };
  assert.deepEqual(remindersDue({ ...base, now: { date: '2026-10-05', time: '17:59' } }), []);
  assert.deepEqual(remindersDue({ ...base, now: { date: '2026-10-05', time: '18:00' } }), [60]);
  assert.deepEqual(remindersDue({ ...base, now: { date: '2026-10-05', time: '18:46' } }), [60, 15]);
  assert.deepEqual(remindersDue({ ...base, sent: [60], now: { date: '2026-10-05', time: '18:46' } }), [15]);
  assert.deepEqual(remindersDue({ ...base, now: { date: '2026-10-05', time: '19:00' } }), []);
  // Reservó 18:30: el de 1 hora ya había pasado.
  assert.deepEqual(remindersDue({ ...base, bookedAt: { date: '2026-10-05', time: '18:30' }, now: { date: '2026-10-05', time: '18:46' } }), [15]);
  assert.deepEqual(remindersDue({ ...base, occ: { ...occ, cancelled: true }, now: { date: '2026-10-05', time: '18:46' } }), []);
});

test('.ics: evento con la zona del gym, sala, profe y alarma', () => {
  const ics = buildIcs({ occ: occs()[1], gymTz: 'America/Argentina/Buenos_Aires', uid: 'b1@lauyim', stamp: '20261001T120000Z' });
  const lines = ics.split('\r\n');
  for (const line of ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:b1@lauyim', 'DTSTAMP:20261001T120000Z',
    'DTSTART;TZID=America/Argentina/Buenos_Aires:20261005T190000', 'DTEND;TZID=America/Argentina/Buenos_Aires:20261005T194500',
    'SUMMARY:Spinning', 'LOCATION:Sala 2', 'DESCRIPTION:Con Caro', 'TRIGGER:-PT1H', 'END:VEVENT', 'END:VCALENDAR']) {
    assert.ok(lines.includes(line), line);
  }
  // Comas y punto y coma se escapan; una clase que cruza la medianoche termina al día siguiente.
  const late = { ...occs()[1], start: '23:30', end: '00:15', type: { ...spinning, name: 'Yoga, nocturno; suave' } };
  const lateIcs = buildIcs({ occ: late, gymTz: 'UTC', uid: 'x', stamp: '20261001T120000Z' });
  assert.ok(lateIcs.includes('SUMMARY:Yoga\\, nocturno\\; suave'));
  assert.ok(lateIcs.includes('DTEND;TZID=UTC:20261006T001500'));
});

test('una fecha suspendida y sacada del calendario no aparece', () => {
  const hidden = { id: 'h1', classId: 'spin', slotId: 's-lun', date: '2026-10-05', start: '19:00', movedFrom: null, teacherUserId: null, teacherName: null, cancelled: true, hidden: true };
  assert.ok(!occs({ sessions: [hidden] }).some(o => o.key === 's-lun:2026-10-05'));
  assert.ok(occs({ sessions: [{ ...hidden, hidden: false }] }).find(o => o.key === 's-lun:2026-10-05').cancelled);
});

test('después de la clase: preguntar, resolver a las 24 h, tomar lista, calificar y el push', () => {
  const occ = occs()[1]; // lunes 2026-10-05 19:00–19:45
  const booking = { status: 'booked', answeredAt: null };
  const at = (date, time) => ({ date, time });
  assert.equal(canAsk({ occ, booking, now: at('2026-10-05', '19:44') }), false);
  assert.equal(canAsk({ occ, booking, now: at('2026-10-05', '19:45') }), true);
  assert.equal(canAsk({ occ, booking, now: at('2026-10-07', '19:44') }), true);
  assert.equal(canAsk({ occ, booking, now: at('2026-10-07', '19:45') }), false);
  assert.equal(canAsk({ occ, booking: { ...booking, answeredAt: 'x' }, now: at('2026-10-05', '20:00') }), false);
  assert.equal(canAsk({ occ, booking, attendanceTaken: true, now: at('2026-10-05', '20:00') }), false);
  assert.equal(resolveAttendance({ occ, booking, checkedIn: true, now: at('2026-10-06', '19:44') }), null);
  assert.deepEqual(resolveAttendance({ occ, booking, checkedIn: true, now: at('2026-10-06', '19:45') }), { status: 'attended', source: 'checkin' });
  assert.deepEqual(resolveAttendance({ occ, booking, checkedIn: false, now: at('2026-10-06', '19:45') }), { status: 'absent', source: 'timeout' });
  assert.equal(resolveAttendance({ occ, booking: { status: 'attended' }, checkedIn: false, now: at('2026-10-08', '00:00') }), null);
  assert.equal(canTakeAttendance({ occ, now: at('2026-10-05', '18:59') }), false);
  assert.equal(canTakeAttendance({ occ, now: at('2026-10-05', '19:00') }), true);
  assert.equal(canTakeAttendance({ occ, now: at('2026-10-12', '19:00') }), true);
  assert.equal(canTakeAttendance({ occ, now: at('2026-10-12', '19:01') }), false);
  assert.equal(canRate({ occ, booking: { status: 'attended' }, now: at('2026-10-12', '19:45') }), true);
  assert.equal(canRate({ occ, booking: { status: 'absent' }, now: at('2026-10-06', '10:00') }), false);
  assert.equal(afterPushDue({ occ, now: at('2026-10-05', '20:14'), minutes: 30 }), false);
  assert.equal(afterPushDue({ occ, now: at('2026-10-05', '20:15'), minutes: 30 }), true);
});

test('el entrenamiento de una clase: hora del gimnasio, músculos o ejercicios sin peso', () => {
  assert.equal(new Date(zonedToEpoch('2026-10-05', '19:00', 'America/Argentina/Buenos_Aires')).toISOString(), '2026-10-05T22:00:00.000Z');
  const occ = occs()[1];
  const w = classWorkout({ occ, bookingId: 'b1', tz: 'America/Argentina/Buenos_Aires' });
  assert.deepEqual({ ...w, start: undefined, end: undefined }, { id: 'cls-b1', d: '2026-10-05', start: undefined, end: undefined, name: 'Spinning', kind: 'class', classBookingId: 'b1', classId: 'spin', teacher: 'Caro', entries: [], muscleLoad: { muscles: ['quadriceps'], intensity: 'high' } });
  assert.equal(w.end - w.start, 45 * 60000);
  const ex = classWorkout({ occ: { ...occ, type: { ...occ.type, logMode: 'exercises', log: { exercises: [{ id: 'sq', sets: 2, reps: 10 }] } } }, bookingId: 'b2', tz: 'UTC' });
  assert.deepEqual(ex.entries, [{ id: 'sq', sets: [{ r: 10, done: true }, { r: 10, done: true }] }]);
  assert.equal(ex.muscleLoad, undefined);
});

test('estadísticas: ocupación, presentes, ausentes, tardías y promedio sin los que no calificaron', () => {
  const [pil, spin] = occs();
  const b = (status, rating = null, extra = {}) => ({ status, rating, waitlistPos: null, ...extra });
  const stats = classStats([
    { occ: spin, bookings: [b('attended', 5), b('attended'), b('absent'), b('late_cancel')] },
    { occ: { ...spin, date: '2026-10-12', key: 'x' }, bookings: [b('attended', 3), b('waitlist', null, { waitlistPos: 1 })] },
    { occ: pil, bookings: [] }
  ]);
  const s = stats.classes.find(c => c.name === 'Spinning');
  assert.deepEqual({ sessions: s.sessions, present: s.present, absent: s.absent, late: s.lateCancels, rating: s.rating, ratings: s.ratings, waitlist: s.withWaitlist }, { sessions: 2, present: 3, absent: 1, late: 1, rating: 4, ratings: 2, waitlist: 1 });
  // Cupo 12: 3/12 y 1/12 → 17 %.
  assert.equal(s.occupancy, 17);
  const p = stats.classes.find(c => c.name === 'Pilates');
  assert.deepEqual([p.rating, p.ratings, p.occupancy], [null, 0, 0]);
  assert.deepEqual(stats.teachers.map(t => [t.name, t.sessions, t.rating]), [['Ana', 1, null], ['Caro', 2, 4]]);
  assert.deepEqual(stats.slots.map(x => [x.weekday, x.start, x.sessions]), [[1, '18:30', 1], [1, '19:00', 2]]);
});

test('penalización: apagada, menos que el límite, bloqueado hasta y vencida', () => {
  const penalty = { on: true, absences: 3, windowDays: 30, blockDays: 7 };
  const dates = ['2026-09-20', '2026-09-28', '2026-10-01'];
  assert.equal(penaltyOf({ dates, today: '2026-10-02', penalty: { ...penalty, on: false } }), null);
  assert.equal(penaltyOf({ dates: dates.slice(1), today: '2026-10-02', penalty }), null);
  assert.deepEqual(penaltyOf({ dates, today: '2026-10-02', penalty }), { count: 3, until: '2026-10-08' });
  assert.equal(penaltyOf({ dates, today: '2026-10-08', penalty }), null);
  // Una de hace más de 30 días no cuenta.
  assert.equal(penaltyOf({ dates: ['2026-08-01', ...dates.slice(1)], today: '2026-10-02', penalty }), null);
});

test('sin cupo: capacity null se guarda, nunca llena y no cuenta para la ocupación', () => {
  const base = { name: 'Yoga', color: '#000000', durationMin: 60, logMode: 'muscles', log: { muscles: ['abs'], intensity: 'low' } };
  assert.equal(validateClassType({ ...base, capacity: null }).value.capacity, null);
  assert.equal(validateClassType({ ...base }).field, 'capacity');          // sin decir nada: hay que elegir
  assert.equal(validateClassType({ ...base, capacity: 0 }).field, 'capacity');
  assert.equal(capOf({ capacity: null }), Infinity);
  assert.equal(capOf({ capacity: 12 }), 12);
  const occ = { classId: 'y', key: 'k', date: '2026-10-05', start: '10:00', teacherName: '', type: { name: 'Yoga', color: '#000', capacity: null } };
  const stats = classStats([{ occ, bookings: [{ status: 'attended', rating: null, waitlistPos: null }] }]);
  assert.deepEqual([stats.classes[0].present, stats.classes[0].occupancy], [1, null]);
});

test('aviso a la profe: cuando faltan los minutos elegidos o menos, antes de que empiece', () => {
  const occ = { date: '2026-10-05', start: '19:00' };
  const at = time => ({ date: '2026-10-05', time });
  assert.equal(teacherReminderDue({ occ, now: at('17:59'), minutes: 60 }), false);
  assert.equal(teacherReminderDue({ occ, now: at('18:00'), minutes: 60 }), true);
  assert.equal(teacherReminderDue({ occ, now: at('18:50'), minutes: 60 }), true);
  assert.equal(teacherReminderDue({ occ, now: at('19:00'), minutes: 60 }), false);
  assert.equal(teacherReminderDue({ occ, now: at('18:30'), minutes: 0 }), false);
  assert.deepEqual(TEACHER_REMINDER_OPTIONS, [0, 30, 60, 120]);
});

test('cierres: validación y las fechas de adentro quedan suspendidas con el motivo', () => {
  const today = '2026-10-05';
  assert.deepEqual(validateClosure({ from: '2026-10-12', to: '2026-10-12', reason: ' Feriado ' }, { today }).value, { from: '2026-10-12', to: '2026-10-12', reason: 'Feriado' });
  assert.equal(validateClosure({ from: '2026-10-04', to: '2026-10-04' }, { today }).field, 'from');            // pasado
  assert.equal(validateClosure({ from: '2026-10-12', to: '2026-10-10' }, { today }).field, 'to');              // al revés
  assert.equal(validateClosure({ from: '2026-10-06', to: '2026-11-06' }, { today }).field, 'to');              // más de 31 días
  assert.equal(validateClosure({ from: '2026-10-12', to: '2026-10-12', reason: 'x'.repeat(41) }, { today }).field, 'reason');
  const existing = [{ id: 'c1', from: '2026-10-10', to: '2026-10-14' }];
  assert.equal(validateClosure({ from: '2026-10-14', to: '2026-10-16' }, { today, existing }).error, 'closure_overlap');
  assert.ok(validateClosure({ from: '2026-10-15', to: '2026-10-16' }, { today, existing }).value);

  const type = { id: 'c', name: 'Spinning', durationMin: 45, capacity: 10, archived: false };
  const slots = [{ id: 's', classId: 'c', weekday: 1, start: '19:00' }];                                     // lunes
  const occs = occurrencesBetween({ types: [type], slots, from: '2026-10-05', days: 14, closures: [{ id: 'k', from: '2026-10-12', to: '2026-10-12', reason: 'Feriado' }] });
  assert.deepEqual(occs.map(o => [o.date, o.cancelled, o.closed || null]), [['2026-10-05', false, null], ['2026-10-12', true, 'Feriado'], ['2026-10-19', false, null]].slice(0, 2));
  const noReason = occurrencesBetween({ types: [type], slots, from: '2026-10-12', days: 1, closures: [{ id: 'k', from: '2026-10-12', to: '2026-10-12', reason: '' }] });
  assert.equal(noReason[0].closed, 'Cerrado');
});
