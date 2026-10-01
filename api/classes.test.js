import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CLASS_DEFAULTS, REMINDER_OPTIONS, MUSCLE_SLUGS, classSettingsOf, validateClassSettings, validateClassType, validateSlot,
  addMinutes, occurrencesBetween, overlapConflicts, conflictText, bookingState, cancelKind, canPromote, remindersDue, buildIcs
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
  assert.deepEqual(CLASS_DEFAULTS, { enabled: true, bookAheadDays: 7, cancelHours: 2, waitlistCutoffMin: 60, allowOverlap: false });
  assert.equal(classSettingsOf(JSON.stringify({ bookAheadDays: 14 })).bookAheadDays, 14);
  assert.equal(classSettingsOf('roto').cancelHours, 2);
  assert.equal(classSettingsOf({ bookAheadDays: 99 }).bookAheadDays, 7);
  assert.deepEqual(validateClassSettings({ enabled: false, bookAheadDays: 3, cancelHours: 0, waitlistCutoffMin: 30, allowOverlap: true }).value,
    { enabled: false, bookAheadDays: 3, cancelHours: 0, waitlistCutoffMin: 30, allowOverlap: true });
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
