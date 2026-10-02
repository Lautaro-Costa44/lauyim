// Rutas de clases (docs/superpowers/specs/2026-10-01-clases-design.md). server.js las suma a su
// tabla de rutas con classRoutes({ ... }) y le pasa lo suyo (sesión, permisos, auditoría, push).
// La lógica está en classes.js y los datos en classes-db.js.
import {
  CLASS_DEFAULTS, REMINDER_OPTIONS, classSettingsOf, validateClassSettings, validateClassType, validateSlot,
  addMinutes, addDays, weekdayOf, occurrencesBetween, overlapConflicts, conflictText, bookingState, cancelKind, canPromote, remindersDue, minutesLeft, buildIcs,
  canAsk, resolveAttendance, canTakeAttendance, canRate, afterPushDue, classWorkout, classStats, penaltyOf
} from './classes.js';
import * as cdb from './classes-db.js';
import { getAllUsers, getUserById, getAdminSetting, setAdminSetting, getDatabase } from './database.js';
import { gymClock, getBillingSettings } from './billing.js';
import { classChangePush, classReminderPush, classAfterPush, classMessagePush } from './push-messages.js';

export const CLASS_SETTINGS_KEY = 'classes';
const CHECK_WEEKS = 8;          // superposición de un bloque semanal: contra las próximas 8 semanas
const MAX_RANGE_DAYS = 42;
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const isTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const MESSAGE_MAX = 200;        // largo de un mensaje de la profe
const MESSAGES_PER_DATE = 3;    // mensajes por fecha y por persona del staff

// La profe de una fecha (con cuenta) no ocupa lugar en la clase que da: no se anota y, si le quedó
// una reserva de antes, no cuenta para cupo, lista, estadísticas ni "¿Fuiste?".
export const teachesOcc = (occ, userId) => !!occ?.teacherUserId && occ.teacherUserId === userId;

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

// Penalización vigente del socio (o null).
export function penaltyNow(userId, today = clockNow().date) {
  const penalty = classSettingsNow().penalty;
  if (!penalty.on) return null;
  return penaltyOf({ dates: cdb.absenceDates(userId, addDays(today, -penalty.windowDays)), today, penalty });
}

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
    if (!user || user.disabled) continue;
    const blocked = deps.isMembershipBlocked(user);
    const punished = !blocked && penaltyNow(r.userId, now.date);
    for (const occ of occs) {
      if (occ.slotId !== r.slotId || occ.type.archived || teachesOcc(occ, r.userId) || bookingState({ occ, now, settings }) !== 'open') continue;
      // Cuota vencida: esa fecha no se reserva y se avisa una sola vez.
      if (blocked) {
        if (cdb.noticeOnce(r.userId, occ.key, 'fee_blocked')) send(r.userId, classChangePush('fee_blocked', { name: occ.type.name, date: occ.date, today: now.date, start: occ.start, sessionId: occ.sessionId || occ.key }));
        continue;
      }
      if (punished) {
        if (cdb.noticeOnce(r.userId, occ.key, 'penalty_blocked')) send(r.userId, classChangePush('penalty_blocked', { name: occ.type.name, date: occ.date, today: now.date, start: occ.start, until: punished.until, sessionId: occ.sessionId || occ.key }));
        continue;
      }
      const session = occ.sessionId ? cdb.getClassSession(occ.sessionId) : cdb.ensureClassSession({ classId: occ.classId, slotId: occ.slotId, date: occ.date, start: occ.start });
      if (cdb.getBookingsForSessions([session.id]).some(b => b.userId === r.userId)) continue;
      const { booking } = cdb.bookOrWaitlist({ sessionId: session.id, userId: r.userId, capacity: occ.type.capacity, reminders: memberReminderDefaults(r.userId), recurringId: r.id });
      count++;
      if (booking.status === 'waitlist') send(r.userId, classChangePush('waitlisted', { name: occ.type.name, date: occ.date, today: now.date, start: occ.start, waitlistPos: booking.waitlistPos, sessionId: session.id }));
    }
  }
  return count;
}

// A las 24 h del fin: presentes por ingreso físico o ausentes. Y el push "¿Fuiste?" `minutes`
// después del fin (una vez). -> cuántas reservas resolvió.
export function runAfterClass({ send, now = clockNow() } = {}) {
  const settings = classSettingsNow();
  if (!settings.enabled) return 0;
  const from = addDays(now.date, -3);
  const bookings = cdb.getBookingsInRange({ from, to: addDays(now.date, 1), statuses: ['booked'] });
  if (!bookings.length) return 0;
  const occs = new Map(loadOccurrences(from, 4).filter(o => o.sessionId).map(o => [o.sessionId, o]));
  let resolved = 0;
  for (const b of bookings) {
    const occ = occs.get(b.sessionId);
    if (!occ || occ.cancelled || teachesOcc(occ, b.userId)) continue;
    const r = resolveAttendance({ occ, booking: b, checkedIn: cdb.hasCheckin(b.userId, occ.date), now });
    if (r) { cdb.updateBooking(b.id, { status: r.status, attendanceSource: r.source }); resolved++; continue; }
    if (settings.afterPush.on && !b.answeredAt && !b.session.attendanceTaken && afterPushDue({ occ, now, minutes: settings.afterPush.minutes })
      && cdb.noticeOnce(b.userId, occ.key, 'after')) {
      send(b.userId, classAfterPush({ name: occ.type.name, date: occ.date, sessionId: occ.sessionId }));
    }
  }
  return resolved;
}

// La profe no ocupa lugar en la clase que da: si quedó anotada (se anotó antes de que la pusieran
// de profe, o de antes de esta regla), se le cancela la reserva y entra la primera de la lista.
// -> cuántas canceló.
export function dropTeacherBookings({ send = () => {}, now = clockNow() } = {}) {
  const settings = classSettingsNow();
  if (!settings.enabled) return 0;
  const occs = loadOccurrences(now.date, settings.bookAheadDays + 1).filter(o => o.sessionId && o.teacherUserId && !o.cancelled && minutesLeft(o, now) > 0);
  if (!occs.length) return 0;
  const bySession = new Map(occs.map(o => [o.sessionId, o]));
  let dropped = 0;
  for (const b of cdb.getBookingsForSessions([...bySession.keys()])) {
    const occ = bySession.get(b.sessionId);
    if (!teachesOcc(occ, b.userId) || !['booked', 'waitlist'].includes(b.status)) continue;
    const out = cdb.cancelAndPromote({ bookingId: b.id, kind: 'cancelled', promote: b.status === 'booked' && canPromote({ occ, now, settings }), capacity: occ.type.capacity });
    if (out.promoted) send(out.promoted.userId, classChangePush('promoted', { name: occ.type.name, date: occ.date, today: now.date, start: occ.start, sessionId: occ.sessionId }));
    dropped++;
  }
  return dropped;
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
    if (!occ || !user || user.disabled || teachesOcc(occ, b.userId)) continue;
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
  // Permisos de clases (permissions.js): todas (manage), las suyas (own), ver todas (view_all),
  // anotar socios en cualquiera (book_members) y tomar lista en las suyas (attendance).
  const has = (user, ...codes) => codes.some(c => d.can(user, c));
  const isManager = user => has(user, 'classes.manage');
  const teacherOf = (user, occ) => !!occ && (occ.teacherUserId === user.id || occ.type?.teacherUserId === user.id);
  const canSee = (user, occ) => has(user, 'classes.manage', 'classes.view_all') || teacherOf(user, occ);
  const editableType = (user, type) => !!type && (isManager(user) || (has(user, 'classes.own') && type.teacherUserId === user.id));
  const editableOcc = (user, occ) => !!occ && (isManager(user) || (has(user, 'classes.own') && teacherOf(user, occ)));
  const canBookInto = (user, occ) => has(user, 'classes.book_members') || (has(user, 'classes.attendance') && teacherOf(user, occ));
  const NOT_YOURS = { error: 'forbidden', message: 'Solo podés cambiar las clases que das' };
  const canTakeList = (user, occ) => isManager(user) || (has(user, 'classes.attendance') && teacherOf(user, occ));
  const classOver = occ => minutesLeft(occ, now()) + occ.type.durationMin <= 0;
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

  const occView = (occ, counts, user) => ({
    key: occ.key, classId: occ.classId, slotId: occ.slotId, sessionId: occ.sessionId, date: occ.date, start: occ.start, end: occ.end,
    movedFrom: occ.movedFrom, teacherUserId: occ.teacherUserId, teacherName: occ.teacherName, room: occ.room, cancelled: occ.cancelled,
    name: occ.type.name, color: occ.type.color, icon: occ.type.icon, capacity: occ.type.capacity,
    booked: counts?.booked || 0, waitlist: counts?.waitlist || 0,
    ...(user ? { editable: editableOcc(user, occ), canBook: canBookInto(user, occ) } : {})
  });
  const countsBySession = occs => {
    const ids = occs.map(o => o.sessionId).filter(Boolean);
    const map = {};
    const bySession = new Map(occs.filter(o => o.sessionId).map(o => [o.sessionId, o]));
    for (const b of cdb.getBookingsForSessions(ids)) {
      if (teachesOcc(bySession.get(b.sessionId), b.userId)) continue;
      const c = map[b.sessionId] ||= { booked: 0, waitlist: 0, lateCancels: 0 };
      if (['booked', 'attended', 'absent'].includes(b.status)) c.booked++;
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
    const user = d.requireAdmin(req, res); if (!user) return;
    // Quien no ve todas: solo las clases que da. editable: las puede cambiar.
    const all = has(user, 'classes.manage', 'classes.view_all');
    const types = cdb.getClassTypes().filter(tp => all || tp.teacherUserId === user.id).map(tp => ({ ...tp, editable: editableType(user, tp) }));
    const ids = new Set(types.map(tp => tp.id));
    json(res, 200, {
      types, slots: cdb.getClassSlots().filter(sl => ids.has(sl.classId)), settings: settings(),
      teachers: isManager(user) ? staffTeachers() : [], canManage: isManager(user), canOwn: has(user, 'classes.own'), me: { id: user.id, name: user.name }
    });
  },
  'POST /api/admin/classes/types/save': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const body = await readBody(req);
    const id = typeof body.id === 'string' ? body.id : null;
    // Sin "todas las clases": solo las suyas, y la profe es siempre esta persona.
    if (!isManager(user)) {
      if (id && !editableType(user, cdb.getClassType(id))) return json(res, 403, NOT_YOURS);
      body.teacherUserId = user.id; body.teacherName = '';
    }
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
    if (!editableType(user, type)) return json(res, 403, NOT_YOURS);
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
    if (!editableType(user, type)) return json(res, 403, NOT_YOURS);
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
    if (!editableType(user, cdb.getClassType(slot.classId))) return json(res, 403, NOT_YOURS);
    for (const occ of futureOccs(o => o.slotId === id)) cancelOcc(occ);
    cdb.deleteClassSlot(id);
    d.audit(req, 'classes.slot.delete', { user, msg: `${cdb.getClassType(slot.classId)?.name || ''} ${slot.weekday} ${slot.start}` });
    json(res, 200, { ok: true });
  },
  'POST /api/admin/classes/overlap-check': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const body = await readBody(req);
    if (!isManager(user)) { body.teacherUserId = user.id; body.teacherName = ''; }
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
    const canManage = isManager(user);
    const occs = loadOccurrences(from, days).filter(o => canSee(user, o));
    const counts = countsBySession(occs);
    const live = occs.filter(o => !o.cancelled);
    const sum = (k) => live.reduce((n, o) => n + (counts[o.sessionId]?.[k] || 0), 0);
    const occupancy = live.length ? Math.round(100 * live.reduce((n, o) => n + Math.min(1, (counts[o.sessionId]?.booked || 0) / o.type.capacity), 0) / live.length) : 0;
    json(res, 200, {
      today, from, days, canManage, canOwn: has(user, 'classes.own'), canBook: has(user, 'classes.book_members'), settings: settings(),
      occurrences: occs.map(o => occView(o, counts[o.sessionId], user)),
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
      if (!editableType(user, type)) return json(res, 403, NOT_YOURS);
      if (!isDate(body.date) || !isTime(body.start)) return json(res, 400, { error: 'validation_error', message: 'Fecha u hora inválida' });
      const conflicts = conflictsFor({ type: withTeacherName(type), start: body.start, date: body.date });
      if (conflicts.blocking.length) return json(res, 409, { error: 'class_overlap', conflicts: conflicts.blocking, warnings: conflicts.warnings });
      const session = cdb.ensureClassSession({ classId: type.id, slotId: null, date: body.date, start: body.start });
      d.audit(req, 'classes.session.change', { user, msg: `${type.name} ${body.date} ${body.start} (suelta)` });
      return json(res, 200, { occurrence: occView(occOfSession(session), null, user), warnings: conflicts.warnings });
    }
    let occ = body.sessionId ? occOfSession(cdb.getClassSession(body.sessionId)) : (isDate(body.date) ? occOfKey(body.date, `${body.slotId}:${body.date}`) : null);
    if (!occ) return json(res, 404, { error: 'not_found' });
    if (!editableOcc(user, occ)) return json(res, 403, NOT_YOURS);
    if (('teacherUserId' in body || 'teacherName' in body) && !isManager(user)) return json(res, 403, { error: 'forbidden', message: 'Solo quien gestiona todas las clases cambia la profe' });
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
        notify(activeUsers(session.id), 'teacher', fresh, { prevTeacher: occ.teacherName });
        changes.push(`con ${fresh.teacherName || 'otra profe'}`);
      }
    }
    d.audit(req, 'classes.session.change', { user, msg: `${occ.type.name} ${occ.date} ${changes.join(', ')}` });
    json(res, 200, { occurrence: occView(occOfSession(cdb.getClassSession(session.id)), countsBySession([occ])[session.id], user) });
  },
  // Una fecha suspendida se puede sacar del calendario (de todos: staff y socios).
  'POST /api/admin/classes/sessions/hide': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const { sessionId } = await readBody(req);
    const session = cdb.getClassSession(sessionId);
    const occ = occOfSession(session);
    if (!occ) return json(res, 404, { error: 'not_found' });
    if (!editableOcc(user, occ)) return json(res, 403, NOT_YOURS);
    if (!occ.cancelled) return json(res, 409, { error: 'class_not_cancelled' });
    cdb.updateClassSession(session.id, { hidden: true });
    d.audit(req, 'classes.session.hide', { user, msg: `${occ.type.name} ${occ.date} ${occ.start}` });
    json(res, 200, { ok: true });
  },
  'GET /api/admin/classes/session': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const q = new URL(req.url, 'http://x').searchParams;
    const occ = q.get('sessionId') ? occOfSession(cdb.getClassSession(q.get('sessionId'))) : occOfKey(q.get('date'), `${q.get('slotId')}:${q.get('date')}`);
    if (!occ) return json(res, 404, { error: 'not_found' });
    if (!canSee(user, occ)) return json(res, 403, { error: 'forbidden' });
    const bookings = (occ.sessionId ? cdb.getBookingsForSessions([occ.sessionId]) : []).filter(b => !teachesOcc(occ, b.userId));
    const person = b => ({ bookingId: b.id, userId: b.userId, name: getUserById(b.userId)?.name || '', addedBy: b.addedBy, pos: b.waitlistPos, status: b.status, source: b.attendanceSource, answered: !!b.answeredAt });
    json(res, 200, {
      occurrence: occView(occ, countsBySession([occ])[occ.sessionId], user),
      canTakeAttendance: canTakeList(user, occ) && canTakeAttendance({ occ, now: now() }),
      attendanceTaken: !!(occ.sessionId && cdb.getClassSession(occ.sessionId)?.attendanceTaken),
      canMessage: canTakeList(user, occ) && !occ.cancelled && !classOver(occ),
      booked: bookings.filter(b => ['booked', 'attended', 'absent'].includes(b.status)).map(person),
      waitlist: bookings.filter(b => b.status === 'waitlist').sort((a, b) => a.waitlistPos - b.waitlistPos).map(person)
    });
  },
  'POST /api/admin/classes/sessions/add': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const body = await readBody(req);
    const occ = body.sessionId ? occOfSession(cdb.getClassSession(body.sessionId)) : (isDate(body.date) ? occOfKey(body.date, `${body.slotId}:${body.date}`) : null);
    if (!occ) return json(res, 404, { error: 'not_found' });
    if (!canBookInto(user, occ)) return json(res, 403, { error: 'forbidden' });
    if (occ.cancelled) return json(res, 409, { error: 'class_cancelled' });
    const person = getUserById(body.userId);
    if (!person || person.disabled) return json(res, 404, { error: 'El usuario no existe' });
    if (teachesOcc(occ, person.id)) return json(res, 409, { error: 'own_class', message: 'Es quien da la clase' });
    const session = occ.sessionId ? cdb.getClassSession(occ.sessionId) : cdb.ensureClassSession({ classId: occ.classId, slotId: occ.slotId, date: occ.date, start: occ.start });
    const { booking } = cdb.bookOrWaitlist({ sessionId: session.id, userId: person.id, capacity: occ.type.capacity, reminders: memberReminderDefaults(person.id), addedBy: user.id, force: true });
    d.audit(req, 'classes.booking.add', { user, target: person, msg: `${occ.type.name} ${occ.date} ${occ.start}` });
    notify([person.id], 'added', { ...occ, sessionId: session.id });
    json(res, 200, { booking });
  },

  // La profe (o quien gestiona todas) toma o corrige la lista: pisa respuestas e ingreso físico.
  'POST /api/admin/classes/sessions/attendance': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const { sessionId, present = [], absent = [] } = await readBody(req);
    const session = cdb.getClassSession(sessionId);
    const occ = occOfSession(session);
    if (!occ) return json(res, 404, { error: 'not_found' });
    if (!canTakeList(user, occ)) return json(res, 403, NOT_YOURS);
    if (!canTakeAttendance({ occ, now: now() })) return json(res, 409, { error: 'attendance_closed', message: 'La lista se toma desde que empieza hasta 7 días después' });
    const want = new Map([...absent.map(u => [u, 'absent']), ...present.map(u => [u, 'attended'])]);
    let changed = 0;
    for (const b of cdb.getBookingsForSessions([session.id])) {
      if (!want.has(b.userId) || teachesOcc(occ, b.userId) || !['booked', 'attended', 'absent'].includes(b.status)) continue;
      cdb.updateBooking(b.id, { status: want.get(b.userId), attendanceSource: 'teacher' });
      changed++;
    }
    cdb.updateClassSession(session.id, { attendanceTaken: true });
    d.audit(req, 'classes.attendance', { user, msg: `${occ.type.name} ${occ.date} ${occ.start}: ${present.length} presentes, ${absent.length} ausentes` });
    json(res, 200, { ok: true, changed });
  },
  // La profe (o quien gestiona todas) le escribe a quienes están anotados a una fecha; si quiere,
  // también a la lista de espera. Hasta MESSAGES_PER_DATE por fecha y persona, y no a una que pasó.
  'POST /api/admin/classes/sessions/message': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const body = await readBody(req);
    const occ = body.sessionId ? occOfSession(cdb.getClassSession(body.sessionId)) : (isDate(body.date) ? occOfKey(body.date, `${body.slotId}:${body.date}`) : null);
    if (!occ) return json(res, 404, { error: 'not_found' });
    if (!canTakeList(user, occ)) return json(res, 403, NOT_YOURS);
    const text = String(body.text || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > MESSAGE_MAX) return json(res, 400, { error: 'validation_error', field: 'text', message: `El mensaje va de 1 a ${MESSAGE_MAX} letras` });
    if (occ.cancelled || classOver(occ)) return json(res, 409, { error: 'class_over' });
    const statuses = body.waitlist ? ['booked', 'waitlist'] : ['booked'];
    const to = (occ.sessionId ? cdb.getBookingsForSessions([occ.sessionId]) : [])
      .filter(b => statuses.includes(b.status) && b.userId !== user.id && !teachesOcc(occ, b.userId)).map(b => b.userId);
    if (!to.length) return json(res, 409, { error: 'no_recipients' });
    let slot = 0;
    for (let i = 1; i <= MESSAGES_PER_DATE && !slot; i++) if (cdb.noticeOnce(user.id, occ.key, `message${i}`)) slot = i;
    if (!slot) return json(res, 429, { error: 'message_limit' });
    const payload = classMessagePush({ name: occ.type.name, date: occ.date, today: now().date, start: occ.start, sender: user.name, text, sessionId: occ.sessionId });
    for (const uid of new Set(to)) d.sendPush(uid, payload).catch(() => {});
    d.audit(req, 'classes.message', { user, msg: `${occ.type.name} ${occ.date} ${occ.start} a ${to.length}: ${text}` });
    json(res, 200, { sent: new Set(to).size, left: MESSAGES_PER_DATE - slot });
  },
  'GET /api/admin/classes/stats': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const weeks = new URL(req.url, 'http://x').searchParams.get('weeks') === '12' ? 12 : 4;
    const clock = now();
    const from = addDays(clock.date, -weeks * 7);
    const occs = loadOccurrences(from, weeks * 7 + 1)
      .filter(o => o.sessionId && !o.cancelled && canSee(user, o) && minutesLeft(o, clock) + o.type.durationMin <= 0);
    const bookings = cdb.getBookingsForSessions(occs.map(o => o.sessionId));
    const rows = occs.map(occ => ({ occ, bookings: bookings.filter(b => b.sessionId === occ.sessionId && !teachesOcc(occ, b.userId)) }));
    json(res, 200, { weeks, from, to: clock.date, ...classStats(rows) });
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
    // Los días de cada clase, para elegir cuáles son fijos desde la hoja de la clase.
    const live = new Set(cdb.getClassTypes().filter(tp => !tp.archived).map(tp => tp.id));
    const slots = cdb.getClassSlots().filter(sl => live.has(sl.classId)).map(sl => ({ ...sl, recurring: fixed.has(sl.id) }));
    json(res, 200, {
      enabled: true, today, from, days, tz: d.gymTz(), settings: publicSettings(s), reminderDefaults: memberReminderDefaults(user.id), penalty: penaltyNow(user.id, today), slots,
      occurrences: occs.map(o => ({ ...memberView(o, counts[o.sessionId], teachesOcc(o, user.id) ? null : mine.get(o.sessionId), fixed.has(o.slotId), bookingState({ occ: o, now: clock, settings: s })), teaching: teachesOcc(o, user.id) }))
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
    const STATE_ERRORS = { not_yet: 'booking_not_yet', started: 'booking_started', cancelled: 'booking_cancelled' };
    if (state !== 'open') return json(res, 409, { error: STATE_ERRORS[state] });
    if (teachesOcc(occ, user.id)) return json(res, 409, { error: 'own_class' });
    const punished = penaltyNow(user.id);
    if (punished) return json(res, 403, { error: 'booking_penalty', until: punished.until, count: punished.count });
    const session = occ.sessionId ? cdb.getClassSession(occ.sessionId) : cdb.ensureClassSession({ classId: occ.classId, slotId: occ.slotId, date: occ.date, start: occ.start });
    const { booking } = cdb.bookOrWaitlist({ sessionId: session.id, userId: user.id, capacity: occ.type.capacity, reminders: memberReminderDefaults(user.id) });
    json(res, 200, { booking: bookingView(booking) });
  },
  // "Anotarme a todas esta semana": cada fecha abierta de la clase en los próximos 7 días; las
  // llenas, a la lista de espera. Las que ya tiene no se tocan. -> cuántas reservó y cuántas en espera.
  'POST /api/classes/book-week': async (req, res) => {
    const user = member(req, res); if (!user) return;
    const s = settings();
    if (!s.enabled) return json(res, 409, { error: 'classes_disabled' });
    const { classId } = await readBody(req);
    const type = cdb.getClassType(classId);
    if (!type || type.archived) return json(res, 404, { error: 'not_found' });
    const punished = penaltyNow(user.id);
    if (punished) return json(res, 403, { error: 'booking_penalty', until: punished.until, count: punished.count });
    const clock = now();
    const out = { booked: 0, waitlist: 0 };
    for (const occ of loadOccurrences(clock.date, 7)) {
      if (occ.classId !== type.id || teachesOcc(occ, user.id) || bookingState({ occ, now: clock, settings: s }) !== 'open') continue;
      const session = occ.sessionId ? cdb.getClassSession(occ.sessionId) : cdb.ensureClassSession({ classId: occ.classId, slotId: occ.slotId, date: occ.date, start: occ.start });
      const { booking, created } = cdb.bookOrWaitlist({ sessionId: session.id, userId: user.id, capacity: occ.type.capacity, reminders: memberReminderDefaults(user.id) });
      if (created) out[booking.status === 'booked' ? 'booked' : 'waitlist']++;
    }
    json(res, 200, out);
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
    // inline: el iPhone lo abre y ofrece "Agregar al calendario" en vez de bajarlo como archivo.
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="clase.ics"', 'Cache-Control': 'no-store' });
    res.end(body);
  },

  // "¿Fuiste?" por contestar (ask) y clases presentes que faltan en el historial (log).
  'GET /api/classes/pending': async (req, res) => {
    const user = member(req, res); if (!user) return;
    const clock = now();
    const from = addDays(clock.date, -8);
    const mine = cdb.getUserBookingsBetween(user.id, from, addDays(clock.date, 1));
    const occs = new Map(loadOccurrences(from, 9).filter(o => o.sessionId).map(o => [o.sessionId, o]));
    const ask = [], log = [];
    for (const b of mine) {
      const occ = occs.get(b.sessionId);
      if (!occ || occ.cancelled || teachesOcc(occ, user.id)) continue;
      const info = { bookingId: b.id, name: occ.type.name, color: occ.type.color, icon: occ.type.icon, date: occ.date, start: occ.start, teacherName: occ.teacherName, rated: b.rating != null, canRate: canRate({ occ, booking: b, now: clock }) };
      if (canAsk({ occ, booking: b, attendanceTaken: b.session.attendanceTaken, now: clock })) ask.push(info);
      else if (b.status === 'attended' && !b.logged) log.push({ ...info, source: b.attendanceSource, workout: classWorkout({ occ, bookingId: b.id, tz: d.gymTz() }) });
    }
    json(res, 200, { ask, log });
  },
  'POST /api/classes/attendance': async (req, res) => {
    const user = member(req, res); if (!user) return;
    const { bookingId, attended, rating } = await readBody(req);
    const b = cdb.getBookingWithSession(bookingId);
    if (!b || b.userId !== user.id) return json(res, 404, { error: 'not_found' });
    const occ = occOfSession(b.session);
    if (!occ) return json(res, 404, { error: 'not_found' });
    const clock = now();
    if (!canAsk({ occ, booking: b, attendanceTaken: b.session.attendanceTaken, now: clock })) return json(res, 409, { error: 'attendance_closed' });
    const stars = Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
    const booking = cdb.updateBooking(b.id, { status: attended ? 'attended' : 'absent', attendanceSource: 'member', answeredAt: new Date().toISOString(), ...(attended && stars ? { rating: stars } : {}) });
    json(res, 200, { booking: bookingView(booking), workout: attended ? classWorkout({ occ, bookingId: b.id, tz: d.gymTz() }) : null });
  },
  'POST /api/classes/logged': async (req, res) => {
    const user = member(req, res); if (!user) return;
    const { bookingId } = await readBody(req);
    const b = cdb.getBooking(bookingId);
    if (!b || b.userId !== user.id) return json(res, 404, { error: 'not_found' });
    cdb.updateBooking(b.id, { logged: true });
    json(res, 200, { ok: true });
  },
  'POST /api/classes/rating': async (req, res) => {
    const user = member(req, res); if (!user) return;
    const { bookingId, rating } = await readBody(req);
    const b = cdb.getBookingWithSession(bookingId);
    if (!b || b.userId !== user.id) return json(res, 404, { error: 'not_found' });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return json(res, 400, { error: 'validation_error', message: 'La calificación va de 1 a 5' });
    const occ = occOfSession(b.session);
    if (!occ || !canRate({ occ, booking: b, now: now() })) return json(res, 409, { error: 'rating_closed' });
    cdb.updateBooking(b.id, { rating });
    json(res, 200, { ok: true });
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
