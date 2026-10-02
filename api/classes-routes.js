// Rutas de clases (docs/superpowers/specs/2026-10-01-clases-design.md). server.js las suma a su
// tabla de rutas con classRoutes({ ... }) y le pasa lo suyo (sesión, permisos, auditoría, push).
// La lógica está en classes.js y los datos en classes-db.js.
import {
  CLASS_DEFAULTS, REMINDER_OPTIONS, classSettingsOf, validateClassSettings, validateClassType, validateSlot,
  addMinutes, addDays, weekdayOf, occurrencesBetween, overlapConflicts, conflictText, bookingState, cancelKind, canPromote, remindersDue, minutesLeft, buildIcs
} from './classes.js';
import * as cdb from './classes-db.js';
import { getAllUsers, getUserById, getAdminSetting, setAdminSetting, getDatabase } from './database.js';
import { gymClock, getBillingSettings } from './billing.js';
import { classChangePush, classReminderPush } from './push-messages.js';

export const CLASS_SETTINGS_KEY = 'classes';
const CHECK_WEEKS = 8;          // superposición de un bloque semanal: contra las próximas 8 semanas
const MAX_RANGE_DAYS = 42;
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const isTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export const classSettingsNow = () => classSettingsOf(getAdminSetting(CLASS_SETTINGS_KEY));
// Módulo prendido y con al menos una clase activa: lo que decide si el socio ve la pestaña.
export const classesAvailable = () => classSettingsNow().enabled && cdb.getClassTypes().length > 0;

// Recordatorios de entrada del socio (Ajustes), solo valores conocidos. Sin elegir: 1 hora antes.
export function memberReminderDefaults(userId) {
  const saved = cdb.getClassReminderDefaults(userId);
  return Array.isArray(saved) ? REMINDER_OPTIONS.filter(m => saved.includes(m)) : [60];
}

// Todas las fechas de clases de [from, from + days), con los nombres de las profes con cuenta.
export function loadOccurrences(from, days) {
  const userNames = Object.fromEntries(getAllUsers().map(u => [u.id, u.name]));
  return occurrencesBetween({
    types: cdb.getClassTypes({ includeArchived: true }), slots: cdb.getClassSlots(),
    sessions: cdb.getClassSessions({ from, to: addDays(from, days) }), from, days, userNames
  });
}
const occOfKey = (date, key) => loadOccurrences(date, 1).find(o => o.key === key) || null;
const occOfSession = session => session ? occOfKey(session.date, session.slotId ? `${session.slotId}:${session.date}` : session.id) : null;

// Lo que server.js le pasa a classRoutes y usan también las reservas fijas y los recordatorios del
// scheduler (sin server, en los tests del scheduler, nadie está bloqueado). La zona es la de cuotas.
let deps = { isMembershipBlocked: () => false, gymTz: () => getBillingSettings(getDatabase()).gym_tz };
export const classClock = (ms = Date.now()) => gymClock(ms, deps.gymTz());
const clockNow = classClock;

// Reserva sola las fechas abiertas de las reservas fijas (todas, o las de un bloque o un socio).
// Una fecha que el socio ya tuvo (aunque la haya cancelado) no se vuelve a reservar. send(userId,
// payload): aviso si quedó en la lista de espera. -> cuántas reservó.
export function materializeRecurring({ slotId, userId, send = () => {}, now = clockNow() } = {}) {
  const settings = classSettingsNow();
  if (!settings.enabled) return 0;
  const recurring = cdb.getRecurring({ slotId, userId });
  if (!recurring.length) return 0;
  const occs = loadOccurrences(now.date, settings.bookAheadDays + 1);
  let count = 0;
  for (const r of recurring) {
    const user = getUserById(r.userId);
    if (!user || user.disabled || deps.isMembershipBlocked(user)) continue;
    for (const occ of occs) {
      if (occ.slotId !== r.slotId || occ.type.archived || bookingState({ occ, now, settings }) !== 'open') continue;
      const session = occ.sessionId ? cdb.getClassSession(occ.sessionId) : cdb.ensureClassSession({ classId: occ.classId, slotId: occ.slotId, date: occ.date, start: occ.start });
      if (cdb.getBookingsForSessions([session.id]).some(b => b.userId === r.userId)) continue;
      const { booking } = cdb.bookOrWaitlist({ sessionId: session.id, userId: r.userId, capacity: occ.type.capacity, reminders: memberReminderDefaults(r.userId), recurringId: r.id });
      count++;
      if (booking.status === 'waitlist') send(r.userId, classChangePush('waitlisted', { name: occ.type.name, date: occ.date, today: now.date, start: occ.start, sessionId: session.id }));
    }
  }
  return count;
}

// Recordatorios que tocan ahora (reservas de hoy y mañana). Si varios llegaron juntos, uno solo; el
// texto dice lo que falta de verdad. -> cuántos mandó.
export function sendClassReminders({ send, now = clockNow() } = {}) {
  if (!classSettingsNow().enabled) return 0;
  const bookings = cdb.getBookingsInRange({ from: now.date, to: addDays(now.date, 2), statuses: ['booked'] });
  if (!bookings.length) return 0;
  const occs = new Map(loadOccurrences(now.date, 2).filter(o => o.sessionId).map(o => [o.sessionId, o]));
  let sent = 0;
  for (const b of bookings) {
    const occ = occs.get(b.sessionId);
    const user = getUserById(b.userId);
    if (!occ || !user || user.disabled) continue;
    const due = remindersDue({ occ, reminders: b.reminders, sent: b.remindersSent, now, bookedAt: clockNow(Date.parse(b.createdAt)) });
    if (!due.length) continue;
    cdb.updateBooking(b.id, { remindersSent: [...b.remindersSent, ...due] });
    send(b.userId, classReminderPush({ name: occ.type.name, date: occ.date, today: now.date, start: occ.start, movedFrom: occ.movedFrom, teacher: occ.teacherName, room: occ.room, minutes: minutesLeft(occ, now), sessionId: occ.sessionId }));
    sent++;
  }
  return sent;
}

export function classRoutes(d) {
  // d: { json, readBody, readSession, requireAdmin, requireOwner, audit, sendPush, can, gymTz, isMembershipBlocked, isInactiveAccount }
  const { json, readBody } = d;
  deps = { isMembershipBlocked: d.isMembershipBlocked, gymTz: d.gymTz };
  const now = () => gymClock(Date.now(), d.gymTz());
  const settings = classSettingsNow;
  const notify = (userIds, kind, occ, extra = {}) => {
    const today = now().date;
    for (const uid of new Set(userIds)) {
      d.sendPush(uid, classChangePush(kind, { name: occ.type.name, date: occ.date, today, start: occ.start, movedFrom: occ.movedFrom, teacher: occ.teacherName, sessionId: occ.sessionId || occ.key, ...extra })).catch(() => {});
    }
  };
  const activeUsers = sessionId => cdb.getBookingsForSessions([sessionId]).filter(b => ['booked', 'waitlist'].includes(b.status)).map(b => b.userId);
  const teacherOf = (user, occ) => !!occ && occ.teacherUserId === user.id;
  const canSee = (user, occ) => d.can(user, 'classes.manage') || teacherOf(user, occ);
  const staffTeachers = () => getAllUsers().filter(u => !u.disabled && (u.owner || u.role_id)).map(u => ({ id: u.id, name: u.name }));
  const withText = list => list.map(c => ({ ...c, text: conflictText(c) }));
  // Junta los conflictos de varias fechas: uno por clase, día de la semana y hora.
  const dedupe = list => { const seen = new Set(); return list.filter(c => { const k = `${c.reason}|${c.name}|${weekdayOf(c.date)}|${c.start}`; if (seen.has(k)) return false; seen.add(k); return true; }); };

  // Conflictos de un candidato: una fecha ({ date }) o un bloque semanal ({ weekday }) de las
  // próximas 8 semanas. type: lo que importa de la clase (duración, sala, profe).
  function conflictsFor({ type, start, date, weekday, ownKey, ownSlotId }) {
    const today = now().date;
    const allowOverlap = settings().allowOverlap;
    const from = date || today;
    const days = date ? 1 : CHECK_WEEKS * 7;
    const occs = loadOccurrences(from, days);
    const dates = date ? [date] : Array.from({ length: days }, (_, i) => addDays(from, i)).filter(x => weekdayOf(x) === weekday);
    const out = { blocking: [], warnings: [] };
    for (const day of dates) {
      const key = ownKey || (ownSlotId ? `${ownSlotId}:${day}` : '__nuevo__');
      const candidate = { key, date: day, start, end: addMinutes(start, type.durationMin), room: type.room || '', teacherUserId: type.teacherUserId || null, teacherName: type.teacherName || '' };
      const r = overlapConflicts(candidate, occs, { allowOverlap });
      out.blocking.push(...r.blocking); out.warnings.push(...r.warnings);
    }
    return { blocking: withText(dedupe(out.blocking)), warnings: withText(dedupe(out.warnings)) };
  }
  // Para el candidato: el nombre de la profe con cuenta, como lo ven los demás.
  const withTeacherName = type => type.teacherUserId ? { ...type, teacherName: getUserById(type.teacherUserId)?.name || '' } : type;

  const occView = (occ, counts) => ({
    key: occ.key, classId: occ.classId, slotId: occ.slotId, sessionId: occ.sessionId, date: occ.date, start: occ.start, end: occ.end,
    movedFrom: occ.movedFrom, teacherUserId: occ.teacherUserId, teacherName: occ.teacherName, room: occ.room, cancelled: occ.cancelled,
    name: occ.type.name, color: occ.type.color, icon: occ.type.icon, capacity: occ.type.capacity,
    booked: counts?.booked || 0, waitlist: counts?.waitlist || 0
  });
  const countsBySession = occs => {
    const ids = occs.map(o => o.sessionId).filter(Boolean);
    const map = {};
    for (const b of cdb.getBookingsForSessions(ids)) {
      const c = map[b.sessionId] ||= { booked: 0, waitlist: 0, lateCancels: 0 };
      if (b.status === 'booked') c.booked++;
      else if (b.status === 'waitlist') c.waitlist++;
      else if (b.status === 'late_cancel') c.lateCancels++;
    }
    return map;
  };
  // Cancela una fecha con reservas (fecha suspendida, bloque borrado o clase archivada) y avisa.
  const cancelOcc = occ => {
    if (!occ.sessionId) return;
    cdb.updateClassSession(occ.sessionId, { cancelled: true });
    notify(cdb.cancelSessionBookings(occ.sessionId), 'cancelled', occ);
  };
  // Fechas guardadas de hoy en adelante de un bloque o de una clase.
  const futureOccs = pick => loadOccurrences(now().date, MAX_RANGE_DAYS).filter(o => o.sessionId && !o.cancelled && pick(o));

  // Socio con sesión y cuenta activa.
  const member = (req, res) => {
    const user = d.readSession(req);
    if (!user) { json(res, 401, { error: 'No has iniciado sesión' }); return null; }
    if (d.isInactiveAccount(user)) { json(res, 403, { error: 'account_not_active' }); return null; }
    return user;
  };
  const publicSettings = s => ({ bookAheadDays: s.bookAheadDays, cancelHours: s.cancelHours });
  const bookingView = b => b && ({ id: b.id, status: b.status, waitlistPos: b.waitlistPos, reminders: b.reminders });
  const memberView = (occ, counts, mine, recurring, state) => ({
    key: occ.key, classId: occ.classId, slotId: occ.slotId, sessionId: occ.sessionId, date: occ.date, start: occ.start, end: occ.end,
    movedFrom: occ.movedFrom, teacherName: occ.teacherName, room: occ.room, cancelled: occ.cancelled,
    name: occ.type.name, color: occ.type.color, icon: occ.type.icon, description: occ.type.description, durationMin: occ.type.durationMin,
    logMode: occ.type.logMode, log: occ.type.log, capacity: occ.type.capacity,
    booked: counts?.booked || 0, waitlist: counts?.waitlist || 0, state, recurring, myBooking: mine ? bookingView(mine) : null
  });

  return {
  // ---------------- staff ----------------
  'GET /api/admin/classes/types': async (req, res) => {
    if (!d.requireAdmin(req, res)) return;
    json(res, 200, { types: cdb.getClassTypes(), slots: cdb.getClassSlots(), teachers: staffTeachers(), settings: settings() });
  },
  'POST /api/admin/classes/types/save': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const body = await readBody(req);
    const id = typeof body.id === 'string' ? body.id : null;
    const activeNames = cdb.getClassTypes().filter(t => t.id !== id).map(t => t.name);
    const checked = validateClassType(body, { activeNames });
    if (checked.error) return json(res, 400, { error: 'validation_error', message: checked.error, field: checked.field });
    if (checked.value.teacherUserId && !staffTeachers().some(t => t.id === checked.value.teacherUserId)) {
      return json(res, 400, { error: 'validation_error', message: 'La profe tiene que tener un rol', field: 'teacherUserId' });
    }
    const type = cdb.saveClassType({ ...checked.value, id });
    if (!type) return json(res, 404, { error: 'not_found' });
    d.audit(req, 'classes.type.save', { user, msg: type.name });
    json(res, 200, { type });
  },
  'POST /api/admin/classes/types/archive': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const { id } = await readBody(req);
    const type = cdb.getClassType(id);
    if (!type) return json(res, 404, { error: 'not_found' });
    for (const occ of futureOccs(o => o.classId === id)) cancelOcc(occ);
    cdb.archiveClassType(id);
    for (const slot of cdb.getClassSlots({ classId: id })) for (const r of cdb.getRecurring({ slotId: slot.id })) cdb.removeRecurring(slot.id, r.userId);
    d.audit(req, 'classes.type.archive', { user, msg: type.name });
    json(res, 200, { ok: true });
  },
  'POST /api/admin/classes/slots/save': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const body = await readBody(req);
    const checked = validateSlot(body);
    if (checked.error) return json(res, 400, { error: 'validation_error', message: checked.error, field: checked.field });
    const current = body.id ? cdb.getClassSlot(body.id) : null;
    if (body.id && !current) return json(res, 404, { error: 'not_found' });
    const type = cdb.getClassType(current?.classId || body.classId);
    if (!type || type.archived) return json(res, 404, { error: 'not_found' });
    const { weekday, start } = checked.value;
    const conflicts = conflictsFor({ type: withTeacherName(type), start, weekday, ownSlotId: current?.id });
    if (conflicts.blocking.length) return json(res, 409, { error: 'class_overlap', conflicts: conflicts.blocking, warnings: conflicts.warnings });
    // Fechas ya guardadas del bloque: otro día, se cancelan; otra hora, se mueven (y se avisa).
    if (current && (current.weekday !== weekday || current.start !== start)) {
      for (const occ of futureOccs(o => o.slotId === current.id && !o.movedFrom)) {
        if (current.weekday !== weekday) cancelOcc(occ);
        else {
          cdb.updateClassSession(occ.sessionId, { start });
          notify(activeUsers(occ.sessionId), 'moved', { ...occ, start, movedFrom: occ.start });
        }
      }
    }
    const slot = cdb.saveClassSlot({ id: current?.id, classId: type.id, weekday, start });
    d.audit(req, 'classes.slot.save', { user, msg: `${type.name} ${weekday} ${start}` });
    json(res, 200, { slot, warnings: conflicts.warnings });
  },
  'POST /api/admin/classes/slots/delete': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const { id } = await readBody(req);
    const slot = cdb.getClassSlot(id);
    if (!slot) return json(res, 404, { error: 'not_found' });
    for (const occ of futureOccs(o => o.slotId === id)) cancelOcc(occ);
    cdb.deleteClassSlot(id);
    d.audit(req, 'classes.slot.delete', { user, msg: `${cdb.getClassType(slot.classId)?.name || ''} ${slot.weekday} ${slot.start}` });
    json(res, 200, { ok: true });
  },
  'POST /api/admin/classes/overlap-check': async (req, res) => {
    if (!d.requireAdmin(req, res)) return;
    const body = await readBody(req);
    if (!isTime(body.start) || !(isDate(body.date) || Number.isInteger(body.weekday))) return json(res, 400, { error: 'validation_error' });
    const saved = body.classId ? cdb.getClassType(body.classId) : null;
    const type = withTeacherName({
      durationMin: Number.isInteger(body.durationMin) ? body.durationMin : saved?.durationMin || 60,
      room: typeof body.room === 'string' ? body.room : saved?.room || '',
      teacherUserId: body.teacherUserId !== undefined ? body.teacherUserId || null : saved?.teacherUserId || null,
      teacherName: typeof body.teacherName === 'string' ? body.teacherName : saved?.teacherName || ''
    });
    json(res, 200, conflictsFor({ type, start: body.start, date: isDate(body.date) ? body.date : null, weekday: body.weekday, ownSlotId: body.slotId || null, ownKey: body.key || null }));
  },
  'GET /api/admin/classes/calendar': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const q = new URL(req.url, 'http://x').searchParams;
    const today = now().date;
    const from = isDate(q.get('from')) ? q.get('from') : today;
    const days = Math.min(MAX_RANGE_DAYS, Math.max(1, Number(q.get('days')) || 7));
    const canManage = d.can(user, 'classes.manage');
    const occs = loadOccurrences(from, days).filter(o => canSee(user, o));
    const counts = countsBySession(occs);
    const live = occs.filter(o => !o.cancelled);
    const sum = (k) => live.reduce((n, o) => n + (counts[o.sessionId]?.[k] || 0), 0);
    const occupancy = live.length ? Math.round(100 * live.reduce((n, o) => n + Math.min(1, (counts[o.sessionId]?.booked || 0) / o.type.capacity), 0) / live.length) : 0;
    json(res, 200, {
      today, from, days, canManage, settings: settings(),
      occurrences: occs.map(o => occView(o, counts[o.sessionId])),
      summary: { classes: live.length, occupancy, lateCancels: sum('lateCancels'), waitlist: sum('waitlist') }
    });
  },
  'POST /api/admin/classes/sessions/change': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const body = await readBody(req);
    const allowOverlap = settings().allowOverlap;
    // Clase suelta: sin bloque ni fecha guardada.
    if (!body.slotId && !body.sessionId) {
      const type = cdb.getClassType(body.classId);
      if (!type || type.archived) return json(res, 404, { error: 'not_found' });
      if (!isDate(body.date) || !isTime(body.start)) return json(res, 400, { error: 'validation_error', message: 'Fecha u hora inválida' });
      const conflicts = conflictsFor({ type: withTeacherName(type), start: body.start, date: body.date });
      if (conflicts.blocking.length) return json(res, 409, { error: 'class_overlap', conflicts: conflicts.blocking, warnings: conflicts.warnings });
      const session = cdb.ensureClassSession({ classId: type.id, slotId: null, date: body.date, start: body.start });
      d.audit(req, 'classes.session.change', { user, msg: `${type.name} ${body.date} ${body.start} (suelta)` });
      return json(res, 200, { occurrence: occView(occOfSession(session)), warnings: conflicts.warnings });
    }
    let occ = body.sessionId ? occOfSession(cdb.getClassSession(body.sessionId)) : (isDate(body.date) ? occOfKey(body.date, `${body.slotId}:${body.date}`) : null);
    if (!occ) return json(res, 404, { error: 'not_found' });
    const session = occ.sessionId ? cdb.getClassSession(occ.sessionId) : cdb.ensureClassSession({ classId: occ.classId, slotId: occ.slotId, date: occ.date, start: occ.start });
    occ = { ...occ, sessionId: session.id };
    const changes = [];
    if (body.cancelled === true && !occ.cancelled) {
      cancelOcc(occ);
      changes.push('suspendida');
    } else {
      if (isTime(body.start) && body.start !== occ.start) {
        const conflicts = conflictsFor({ type: { ...occ.type, teacherUserId: occ.teacherUserId, teacherName: occ.teacherName }, start: body.start, date: occ.date, ownKey: occ.key });
        if (conflicts.blocking.length && !allowOverlap) return json(res, 409, { error: 'class_overlap', conflicts: conflicts.blocking, warnings: conflicts.warnings });
        const original = occ.movedFrom || occ.start;
        cdb.updateClassSession(session.id, { start: body.start, movedFrom: body.start === original ? null : original });
        notify(activeUsers(session.id), 'moved', { ...occ, start: body.start, movedFrom: occ.start });
        changes.push(`a las ${body.start}`);
      }
      if ('teacherUserId' in body || 'teacherName' in body) {
        const teacherUserId = typeof body.teacherUserId === 'string' && body.teacherUserId ? body.teacherUserId : null;
        if (teacherUserId && !staffTeachers().some(t => t.id === teacherUserId)) return json(res, 400, { error: 'validation_error', field: 'teacherUserId', message: 'La profe tiene que tener un rol' });
        const teacherName = teacherUserId ? null : String(body.teacherName || '').trim().slice(0, 40) || null;
        cdb.updateClassSession(session.id, { teacherUserId, teacherName });
        const fresh = occOfSession(cdb.getClassSession(session.id));
        notify(activeUsers(session.id), 'teacher', fresh);
        changes.push(`con ${fresh.teacherName || 'otra profe'}`);
      }
    }
    d.audit(req, 'classes.session.change', { user, msg: `${occ.type.name} ${occ.date} ${changes.join(', ')}` });
    json(res, 200, { occurrence: occView(occOfSession(cdb.getClassSession(session.id)), countsBySession([occ])[session.id]) });
  },
  'GET /api/admin/classes/session': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const q = new URL(req.url, 'http://x').searchParams;
    const occ = q.get('sessionId') ? occOfSession(cdb.getClassSession(q.get('sessionId'))) : occOfKey(q.get('date'), `${q.get('slotId')}:${q.get('date')}`);
    if (!occ) return json(res, 404, { error: 'not_found' });
    if (!canSee(user, occ)) return json(res, 403, { error: 'forbidden' });
    const bookings = occ.sessionId ? cdb.getBookingsForSessions([occ.sessionId]) : [];
    const person = b => ({ bookingId: b.id, userId: b.userId, name: getUserById(b.userId)?.name || '', addedBy: b.addedBy, pos: b.waitlistPos });
    json(res, 200, {
      occurrence: occView(occ, countsBySession([occ])[occ.sessionId]),
      booked: bookings.filter(b => b.status === 'booked').map(person),
      waitlist: bookings.filter(b => b.status === 'waitlist').sort((a, b) => a.waitlistPos - b.waitlistPos).map(person)
    });
  },
  'POST /api/admin/classes/sessions/add': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const body = await readBody(req);
    const occ = body.sessionId ? occOfSession(cdb.getClassSession(body.sessionId)) : (isDate(body.date) ? occOfKey(body.date, `${body.slotId}:${body.date}`) : null);
    if (!occ) return json(res, 404, { error: 'not_found' });
    if (!canSee(user, occ)) return json(res, 403, { error: 'forbidden' });
    if (occ.cancelled) return json(res, 409, { error: 'class_cancelled' });
    const person = getUserById(body.userId);
    if (!person || person.disabled) return json(res, 404, { error: 'El usuario no existe' });
    const session = occ.sessionId ? cdb.getClassSession(occ.sessionId) : cdb.ensureClassSession({ classId: occ.classId, slotId: occ.slotId, date: occ.date, start: occ.start });
    const { booking } = cdb.bookOrWaitlist({ sessionId: session.id, userId: person.id, capacity: occ.type.capacity, reminders: memberReminderDefaults(person.id), addedBy: user.id, force: true });
    d.audit(req, 'classes.booking.add', { user, target: person, msg: `${occ.type.name} ${occ.date} ${occ.start}` });
    json(res, 200, { booking });
  },

  // ---------------- socio ----------------
  'GET /api/classes': async (req, res) => {
    const user = member(req, res); if (!user) return;
    const s = settings();
    const q = new URL(req.url, 'http://x').searchParams;
    const today = now().date;
    const from = isDate(q.get('from')) ? q.get('from') : today;
    const days = Math.min(MAX_RANGE_DAYS, Math.max(1, Number(q.get('days')) || s.bookAheadDays));
    if (!s.enabled) return json(res, 200, { enabled: false, today, from, days, occurrences: [], settings: publicSettings(s) });
    const occs = loadOccurrences(from, days).filter(o => !(o.type.archived && !o.sessionId));
    const counts = countsBySession(occs);
    const mine = new Map(cdb.getUserBookings(user.id, { from }).map(b => [b.sessionId, b]));
    const fixed = new Set(cdb.getRecurring({ userId: user.id }).map(r => r.slotId));
    const clock = now();
    json(res, 200, {
      enabled: true, today, from, days, settings: publicSettings(s), reminderDefaults: memberReminderDefaults(user.id),
      occurrences: occs.map(o => memberView(o, counts[o.sessionId], mine.get(o.sessionId), fixed.has(o.slotId), bookingState({ occ: o, now: clock, settings: s })))
    });
  },
  'POST /api/classes/book': async (req, res) => {
    const user = member(req, res); if (!user) return;
    const s = settings();
    if (!s.enabled) return json(res, 409, { error: 'classes_disabled' });
    const body = await readBody(req);
    const occ = body.sessionId ? occOfSession(cdb.getClassSession(body.sessionId)) : (isDate(body.date) ? occOfKey(body.date, `${body.slotId}:${body.date}`) : null);
    if (!occ || occ.type.archived) return json(res, 404, { error: 'not_found' });
    const state = bookingState({ occ, now: now(), settings: s });
    if (state !== 'open') return json(res, 409, { error: 'booking_' + state });
    const session = occ.sessionId ? cdb.getClassSession(occ.sessionId) : cdb.ensureClassSession({ classId: occ.classId, slotId: occ.slotId, date: occ.date, start: occ.start });
    const { booking } = cdb.bookOrWaitlist({ sessionId: session.id, userId: user.id, capacity: occ.type.capacity, reminders: memberReminderDefaults(user.id) });
    json(res, 200, { booking: bookingView(booking) });
  },
  'POST /api/classes/cancel': async (req, res) => {
    const user = member(req, res); if (!user) return;
    const { bookingId } = await readBody(req);
    const b = cdb.getBookingWithSession(bookingId);
    if (!b || b.userId !== user.id || !['booked', 'waitlist'].includes(b.status)) return json(res, 404, { error: 'not_found' });
    const occ = occOfSession(b.session);
    if (!occ) return json(res, 404, { error: 'not_found' });
    const s = settings();
    const clock = now();
    if (bookingState({ occ, now: clock, settings: s }) === 'started') return json(res, 409, { error: 'booking_started' });
    const kind = b.status === 'waitlist' ? 'cancelled' : cancelKind({ occ, now: clock, settings: s });
    const out = cdb.cancelAndPromote({ bookingId: b.id, kind, promote: canPromote({ occ, now: clock, settings: s }), capacity: occ.type.capacity });
    if (out.promoted) notify([out.promoted.userId], 'promoted', occ);
    json(res, 200, { booking: bookingView(out.booking), kind });
  },
  'PUT /api/classes/reminders': async (req, res) => {
    const user = member(req, res); if (!user) return;
    const { bookingId, reminders } = await readBody(req);
    const b = cdb.getBooking(bookingId);
    if (!b || b.userId !== user.id) return json(res, 404, { error: 'not_found' });
    if (!Array.isArray(reminders) || reminders.some(m => !REMINDER_OPTIONS.includes(m))) return json(res, 400, { error: 'validation_error', message: 'Recordatorio inválido' });
    const chosen = REMINDER_OPTIONS.filter(m => reminders.includes(m));
    const booking = cdb.updateBooking(b.id, { reminders: chosen, remindersSent: b.remindersSent.filter(m => chosen.includes(m)) });
    json(res, 200, { booking: bookingView(booking) });
  },
  'PUT /api/classes/reminder-defaults': async (req, res) => {
    const user = member(req, res); if (!user) return;
    const { reminders } = await readBody(req);
    if (!Array.isArray(reminders) || reminders.some(m => !REMINDER_OPTIONS.includes(m))) return json(res, 400, { error: 'validation_error', message: 'Recordatorio inválido' });
    const chosen = REMINDER_OPTIONS.filter(m => reminders.includes(m));
    cdb.setClassReminderDefaults(user.id, chosen);
    json(res, 200, { reminderDefaults: chosen });
  },
  'POST /api/classes/recurring': async (req, res) => {
    const user = member(req, res); if (!user) return;
    if (!settings().enabled) return json(res, 409, { error: 'classes_disabled' });
    const { slotId } = await readBody(req);
    const slot = cdb.getClassSlot(slotId);
    const type = slot && cdb.getClassType(slot.classId);
    if (!slot || !type || type.archived) return json(res, 404, { error: 'not_found' });
    cdb.addRecurring(slot.id, user.id);
    const booked = materializeRecurring({ slotId: slot.id, userId: user.id, send: (uid, payload) => d.sendPush(uid, payload).catch(() => {}) });
    json(res, 200, { recurring: true, booked });
  },
  'POST /api/classes/recurring/delete': async (req, res) => {
    const user = member(req, res); if (!user) return;
    const { slotId } = await readBody(req);
    cdb.removeRecurring(slotId, user.id);
    json(res, 200, { recurring: false });
  },
  'GET /api/classes/ics': async (req, res) => {
    const user = member(req, res); if (!user) return;
    const b = cdb.getBookingWithSession(new URL(req.url, 'http://x').searchParams.get('booking'));
    if (!b || b.userId !== user.id) return json(res, 404, { error: 'not_found' });
    const occ = occOfSession(b.session);
    if (!occ) return json(res, 404, { error: 'not_found' });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const body = buildIcs({ occ, gymTz: d.gymTz(), uid: `${b.id}@lauyim`, stamp });
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="clase.ics"', 'Cache-Control': 'no-store' });
    res.end(body);
  },

  // ---------------- owner ----------------
  'GET /api/owner/classes/settings': async (req, res) => {
    if (!d.requireOwner(req, res)) return;
    json(res, 200, { settings: settings() });
  },
  'PUT /api/owner/classes/settings': async (req, res) => {
    const owner = d.requireOwner(req, res); if (!owner) return;
    const body = await readBody(req);
    const checked = validateClassSettings({ ...settings(), ...(body && typeof body === 'object' ? body : {}) });
    if (checked.error) return json(res, 400, { error: 'validation_error', message: checked.error, field: checked.field });
    setAdminSetting(CLASS_SETTINGS_KEY, JSON.stringify(checked.value));
    d.audit(req, 'owner.classes.settings', { user: owner, msg: checked.value.enabled ? 'clases prendidas' : 'clases apagadas' });
    json(res, 200, { settings: checked.value });
  },
  };
}

export { CLASS_DEFAULTS };
