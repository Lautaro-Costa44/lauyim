// Clases grupales (docs/superpowers/specs/2026-10-01-clases-design.md). Puro: validación, fechas
// de cada clase a partir del horario semanal, superposición, reglas de reserva, recordatorios y
// el .ics. Sin base ni HTTP: server.js y scheduler.js le pasan los datos. Fechas y horas son las
// del gimnasio (gymClock), como 'YYYY-MM-DD' y 'HH:MM'; `now` es { date, time }.

export const CLASS_DEFAULTS = Object.freeze({
  enabled: true, bookAheadDays: 7, cancelHours: 2, waitlistCutoffMin: 60, allowOverlap: false,
  // Push "¿Fuiste?" después de la clase (entrega 2) y penalización por ausencias (entrega 3).
  afterPush: Object.freeze({ on: true, minutes: 30 }),
  penalty: Object.freeze({ on: false, absences: 3, windowDays: 30, blockDays: 7 })
});
const NESTED_RANGES = {
  afterPush: { minutes: [0, 180] },
  penalty: { absences: [1, 10], windowDays: [7, 90], blockDays: [1, 30] }
};
const NESTED_LABELS = {
  afterPush: { minutes: 'El aviso después de la clase va de 0 a 180 minutos' },
  penalty: { absences: 'Las ausencias van de 1 a 10', windowDays: 'Los días que se miran van de 7 a 90', blockDays: 'Los días sin reservar van de 1 a 30' }
};
// Recordatorios posibles, en minutos antes de la clase.
export const REMINDER_OPTIONS = Object.freeze([300, 120, 60, 30, 15]);
export const INTENSITIES = Object.freeze(['low', 'medium', 'high']);
export const LOG_MODES = Object.freeze(['muscles', 'exercises']);
// Copia de MUSCLES de frontend/src/lib/muscles.js (la API no importa el frontend; classes.test.js
// verifica que coincidan).
export const MUSCLE_SLUGS = Object.freeze([
  'trapezius', 'deltoids', 'chest', 'upper-back', 'serratus',
  'biceps', 'triceps', 'forearm',
  'abs', 'obliques', 'lower-back',
  'gluteal', 'quadriceps', 'hamstring', 'adductors', 'hip-flexors',
  'calves', 'tibialis',
]);
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const MAX_NAME = 40, MAX_DESCRIPTION = 500, MAX_ROOM = 30, MAX_TEACHER = 40, MAX_EXERCISES = 30;
const SETTING_RANGES = { bookAheadDays: [1, 30], cancelHours: [0, 48], waitlistCutoffMin: [0, 720] };

const clean = v => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim() : '';
const norm = v => clean(v).toLowerCase();
const intIn = (v, [lo, hi]) => Number.isInteger(v) && v >= lo && v <= hi;
const isTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

// ---- ajustes ----

// Lo guardado en admin_settings (JSON o nada) → ajustes completos; un valor fuera de rango vuelve al defecto.
export function classSettingsOf(stored) {
  let saved = stored;
  if (typeof stored === 'string') { try { saved = JSON.parse(stored); } catch { saved = null; } }
  if (!saved || typeof saved !== 'object') saved = {};
  const out = { ...CLASS_DEFAULTS };
  if (typeof saved.enabled === 'boolean') out.enabled = saved.enabled;
  if (typeof saved.allowOverlap === 'boolean') out.allowOverlap = saved.allowOverlap;
  for (const [k, range] of Object.entries(SETTING_RANGES)) if (intIn(saved[k], range)) out[k] = saved[k];
  for (const [group, ranges] of Object.entries(NESTED_RANGES)) {
    const src = saved[group] && typeof saved[group] === 'object' ? saved[group] : {};
    out[group] = { ...CLASS_DEFAULTS[group] };
    if (typeof src.on === 'boolean') out[group].on = src.on;
    for (const [k, range] of Object.entries(ranges)) if (intIn(src[k], range)) out[group][k] = src[k];
  }
  return out;
}

export function validateClassSettings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Datos inválidos' };
  const value = { ...CLASS_DEFAULTS };
  for (const k of ['enabled', 'allowOverlap']) if (body[k] !== undefined) value[k] = body[k] === true;
  const labels = { bookAheadDays: 'Los días para reservar van de 1 a 30', cancelHours: 'Las horas para cancelar van de 0 a 48', waitlistCutoffMin: 'El corte de la lista de espera va de 0 a 720 minutos' };
  for (const [k, range] of Object.entries(SETTING_RANGES)) {
    if (body[k] === undefined) continue;
    if (!intIn(body[k], range)) return { error: labels[k], field: k };
    value[k] = body[k];
  }
  for (const [group, ranges] of Object.entries(NESTED_RANGES)) {
    value[group] = { ...CLASS_DEFAULTS[group] };
    const src = body[group];
    if (src === undefined) continue;
    if (!src || typeof src !== 'object') return { error: 'Datos inválidos', field: group };
    if (src.on !== undefined) value[group].on = src.on === true;
    for (const [k, range] of Object.entries(ranges)) {
      if (src[k] === undefined) continue;
      if (!intIn(src[k], range)) return { error: NESTED_LABELS[group][k], field: `${group}.${k}` };
      value[group][k] = src[k];
    }
  }
  return { value };
}

// ---- clase y horario ----

function validateLog(logMode, log) {
  if (!LOG_MODES.includes(logMode)) return { error: 'Elegí cómo se registra la clase', field: 'logMode' };
  const bad = message => ({ error: message, field: 'log' });
  if (!log || typeof log !== 'object') return bad('Faltan los datos de la clase');
  if (logMode === 'muscles') {
    const muscles = Array.isArray(log.muscles) ? [...new Set(log.muscles)] : [];
    if (!muscles.length) return bad('Marcá al menos un músculo');
    if (muscles.some(m => !MUSCLE_SLUGS.includes(m))) return bad('Músculo desconocido');
    if (!INTENSITIES.includes(log.intensity)) return bad('Elegí la intensidad');
    return { value: { muscles, intensity: log.intensity } };
  }
  const exercises = Array.isArray(log.exercises) ? log.exercises : [];
  if (!exercises.length) return bad('Agregá al menos un ejercicio');
  if (exercises.length > MAX_EXERCISES) return bad(`Hasta ${MAX_EXERCISES} ejercicios`);
  const value = [];
  for (const e of exercises) {
    if (!e || typeof e.id !== 'string' || !e.id) return bad('Ejercicio inválido');
    if (!intIn(e.sets, [1, 10])) return bad('Las series van de 1 a 10');
    if (!intIn(e.reps, [1, 100])) return bad('Las repeticiones van de 1 a 100');
    value.push({ id: e.id, sets: e.sets, reps: e.reps });
  }
  return { value: { exercises: value } };
}

// body → { value } o { error, field }. activeNames: los nombres de las otras clases activas.
export function validateClassType(body, { activeNames = [] } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Datos inválidos' };
  const name = clean(body.name);
  if (!name) return { error: 'Poné un nombre', field: 'name' };
  if (name.length > MAX_NAME) return { error: `El nombre admite hasta ${MAX_NAME} caracteres`, field: 'name' };
  if (activeNames.some(n => norm(n) === name.toLowerCase())) return { error: 'Ya hay una clase con ese nombre', field: 'name' };
  if (typeof body.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(body.color)) return { error: 'El color tiene que ser un código #RRGGBB', field: 'color' };
  const icon = typeof body.icon === 'string' && /^[a-zA-Z]{1,40}$/.test(body.icon) ? body.icon : 'dumbbell';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length > MAX_DESCRIPTION) return { error: `La descripción admite hasta ${MAX_DESCRIPTION} caracteres`, field: 'description' };
  if (!intIn(body.durationMin, [15, 240])) return { error: 'La duración va de 15 a 240 minutos', field: 'durationMin' };
  // null: sin cupo (gimnasios chicos o clases tranquilas): se anota quien quiera, sin lista de espera.
  if (body.capacity !== null && !intIn(body.capacity, [1, 200])) return { error: 'El cupo va de 1 a 200', field: 'capacity' };
  const teacherUserId = typeof body.teacherUserId === 'string' && body.teacherUserId ? body.teacherUserId : null;
  const teacherName = teacherUserId ? '' : clean(body.teacherName);
  if (teacherName.length > MAX_TEACHER) return { error: `El nombre de la profe admite hasta ${MAX_TEACHER} caracteres`, field: 'teacherName' };
  const room = clean(body.room);
  if (room.length > MAX_ROOM) return { error: `La sala admite hasta ${MAX_ROOM} caracteres`, field: 'room' };
  const log = validateLog(body.logMode, body.log);
  if (log.error) return log;
  return { value: { name, color: body.color.toLowerCase(), icon, description, durationMin: body.durationMin, capacity: body.capacity, teacherUserId, teacherName, room, logMode: body.logMode, log: log.value } };
}

export function validateSlot(body) {
  if (!body || typeof body !== 'object') return { error: 'Datos inválidos' };
  if (!intIn(body.weekday, [0, 6])) return { error: 'Día inválido', field: 'weekday' };
  if (!isTime(body.start)) return { error: 'La hora tiene que ser HH:MM', field: 'start' };
  return { value: { weekday: body.weekday, start: body.start } };
}

// ---- fechas y horas ----

const toMin = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const fmtMin = m => { const d = ((m % 1440) + 1440) % 1440; return String(Math.floor(d / 60)).padStart(2, '0') + ':' + String(d % 60).padStart(2, '0'); };
export const addMinutes = (time, n) => fmtMin(toMin(time) + n);
const dayNumber = date => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86400000;
const dateOf = n => new Date(n * 86400000).toISOString().slice(0, 10);
export const addDays = (date, n) => dateOf(dayNumber(date) + n);
export const weekdayOf = date => new Date(dayNumber(date) * 86400000).getUTCDay();
// Minutos absolutos de una fecha y hora (para comparar y restar).
const stamp = (date, time) => dayNumber(date) * 1440 + toMin(time);
const minutesUntil = (occ, now) => stamp(occ.date, occ.start) - stamp(now.date, now.time);
// Minutos que faltan para que empiece una fecha (negativo si ya empezó).
export const minutesLeft = minutesUntil;

// Aviso a la profe antes de su clase: minutos posibles (0 apagado) y si ya toca (faltan `minutes`
// o menos y todavía no empezó).
export const TEACHER_REMINDER_OPTIONS = [0, 30, 60, 120];
export const teacherReminderDue = ({ occ, now, minutes }) => {
  const left = minutesUntil(occ, now);
  return minutes > 0 && left > 0 && left <= minutes;
};

// Fechas de clases en [from, from + days): las del horario semanal (de las clases no archivadas)
// más las sesiones guardadas, que pisan a la calculada del mismo bloque y fecha (cambio de hora,
// de profe, cancelada) o son clases sueltas (sin bloque). userNames: { userId: nombre } para las
// profes con cuenta. Ordenadas por fecha, hora y nombre.
// closures: días en que el gimnasio cierra; sus fechas quedan suspendidas con `closed` (el motivo).
export function occurrencesBetween({ types, slots, sessions = [], from, days, userNames = {}, closures = [] }) {
  const byId = new Map(types.map(t => [t.id, t]));
  const to = addDays(from, days);
  const out = new Map();
  const build = (type, { key, slotId, session, date, start }) => {
    const ownTeacher = session && (session.teacherUserId || session.teacherName);
    const teacherUserId = ownTeacher ? session.teacherUserId || null : type.teacherUserId || null;
    const teacherName = teacherUserId ? userNames[teacherUserId] || '' : (ownTeacher ? session.teacherName : type.teacherName) || '';
    const begin = session?.start || start;
    return {
      key, classId: type.id, slotId: slotId || null, sessionId: session?.id || null, date, start: begin,
      end: addMinutes(begin, type.durationMin), movedFrom: session?.movedFrom || null,
      teacherUserId, teacherName, room: type.room || '', cancelled: !!session?.cancelled, type
    };
  };
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const wd = weekdayOf(date);
    for (const slot of slots) {
      const type = byId.get(slot.classId);
      if (!type || type.archived || slot.weekday !== wd) continue;
      const key = `${slot.id}:${date}`;
      out.set(key, build(type, { key, slotId: slot.id, date, start: slot.start }));
    }
  }
  for (const session of sessions) {
    if (session.date < from || session.date >= to) continue;
    const type = byId.get(session.classId);
    if (!type) continue;
    const key = session.slotId ? `${session.slotId}:${session.date}` : session.id;
    // Suspendida y sacada del calendario: no aparece (ni la calculada del bloque).
    if (session.hidden) { out.delete(key); continue; }
    out.set(key, build(type, { key, slotId: session.slotId, session, date: session.date, start: session.start }));
  }
  const closedOn = date => closures.find(c => c.from <= date && date <= c.to);
  for (const occ of out.values()) {
    const closure = closedOn(occ.date);
    if (closure) { occ.cancelled = true; occ.closed = closure.reason || 'Cerrado'; }
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.type.name.localeCompare(b.type.name));
}

// Un cierre del gimnasio: de hoy en adelante, de 1 a 31 días, sin pisar otro y con un motivo corto.
export const CLOSURE_MAX_DAYS = 31;
export function validateClosure(body, { today, existing = [] } = {}) {
  const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
  const from = body?.from, to = body?.to || body?.from;
  if (!isDay(from) || from < today) return { error: 'validation_error', field: 'from', message: 'Elegí una fecha de hoy en adelante' };
  if (!isDay(to) || to < from) return { error: 'validation_error', field: 'to', message: 'La fecha final tiene que ser igual o posterior' };
  if (dayNumber(to) - dayNumber(from) + 1 > CLOSURE_MAX_DAYS) return { error: 'validation_error', field: 'to', message: `Un cierre dura hasta ${CLOSURE_MAX_DAYS} días` };
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length > 40) return { error: 'validation_error', field: 'reason', message: 'El motivo admite hasta 40 letras' };
  if (existing.some(c => c.from <= to && from <= c.to)) return { error: 'closure_overlap', message: 'Ya hay un cierre en esos días' };
  return { value: { from, to, reason } };
}

// ---- superposición ----

const sameTeacher = (a, b) => a.teacherUserId
  ? a.teacherUserId === b.teacherUserId
  : !b.teacherUserId && !!norm(a.teacherName) && norm(a.teacherName) === norm(b.teacherName);

// candidate: { key, date, start, end, room, teacherUserId, teacherName } contra las fechas
// existentes. Misma fecha, horarios que se pisan y misma sala (o alguna sin sala): bloquea, o
// avisa si se permite. Misma profe a la vez: siempre aviso. Ignora la propia fecha y las canceladas.
export function overlapConflicts(candidate, occurrences, { allowOverlap = false } = {}) {
  const blocking = [], warnings = [];
  const s1 = toMin(candidate.start), e1 = s1 + ((toMin(candidate.end) - s1 + 1440) % 1440 || 1440);
  for (const o of occurrences) {
    if (o.key === candidate.key || o.cancelled || o.date !== candidate.date) continue;
    const s2 = toMin(o.start), e2 = s2 + ((toMin(o.end) - s2 + 1440) % 1440 || 1440);
    if (!(s1 < e2 && s2 < e1)) continue;
    const info = { name: o.type.name, date: o.date, start: o.start, end: o.end, room: o.room, teacher: o.teacherName };
    const roomClash = !candidate.room || !o.room || norm(candidate.room) === norm(o.room);
    if (roomClash) (allowOverlap ? warnings : blocking).push({ reason: 'room', ...info });
    else if (sameTeacher(candidate, o)) warnings.push({ reason: 'teacher', ...info });
  }
  return { blocking, warnings };
}

// Texto del aviso de un conflicto.
export function conflictText(c) {
  const day = WEEKDAYS[weekdayOf(c.date)];
  if (c.reason === 'teacher') return `${c.teacher} ya da ${c.name} el ${day} de ${c.start} a ${c.end}.`;
  return `Ya hay ${c.name} el ${day} de ${c.start} a ${c.end}${c.room ? ` en ${c.room}` : ''}${c.teacher ? `, con ${c.teacher}` : ''}.`;
}

// ---- reservas ----

// 'cancelled' (esa fecha se suspendió) | 'started' | 'not_yet' (todavía no abre) | 'open'.
export function bookingState({ occ, now, settings }) {
  if (occ.cancelled) return 'cancelled';
  if (minutesUntil(occ, now) <= 0) return 'started';
  if (now.date < addDays(occ.date, -settings.bookAheadDays)) return 'not_yet';
  return 'open';
}

// Cancelar con al menos cancelHours de anticipación: 'cancelled'; después, 'late_cancel'.
export const cancelKind = ({ occ, now, settings }) => minutesUntil(occ, now) >= settings.cancelHours * 60 ? 'cancelled' : 'late_cancel';

// La lista de espera sube a alguien solo si faltan más de waitlistCutoffMin.
export const canPromote = ({ occ, now, settings }) => minutesUntil(occ, now) > settings.waitlistCutoffMin;

// Recordatorios (minutos antes) que tocan ahora: su hora llegó, la clase no empezó, no se mandaron
// y no habían pasado ya cuando se reservó.
export function remindersDue({ occ, reminders, sent = [], now, bookedAt }) {
  if (occ.cancelled) return [];
  const left = minutesUntil(occ, now);
  if (left <= 0) return [];
  const bookedLeft = bookedAt ? minutesUntil(occ, bookedAt) : Infinity;
  return reminders.filter(m => !sent.includes(m) && left <= m && bookedLeft >= m);
}

// ---- .ics ----

const icsText = v => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsLocal = (date, time) => date.replace(/-/g, '') + 'T' + time.replace(':', '') + '00';

// Evento iCalendar de una fecha de clase. stamp: DTSTAMP en UTC (YYYYMMDDTHHMMSSZ).
export function buildIcs({ occ, gymTz, uid, stamp: dtstamp }) {
  const startMin = stamp(occ.date, occ.start);
  const endMin = startMin + occ.type.durationMin;
  const endDate = dateOf(Math.floor(endMin / 1440));
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//lauyim//clases//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=${gymTz}:${icsLocal(occ.date, occ.start)}`,
    `DTEND;TZID=${gymTz}:${icsLocal(endDate, fmtMin(endMin))}`,
    `SUMMARY:${icsText(occ.type.name)}`
  ];
  if (occ.room) lines.push(`LOCATION:${icsText(occ.room)}`);
  if (occ.teacherName) lines.push(`DESCRIPTION:${icsText('Con ' + occ.teacherName)}`);
  lines.push('BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(occ.type.name)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ---- después de la clase (entrega 2) ----

export const ATTENDANCE_WINDOWS = Object.freeze({ askHours: 48, resolveHours: 24, teacherDays: 7, ratingDays: 7 });
// Minutos desde que terminó (negativo si no terminó) y desde que empezó.
const sinceEnd = (occ, now) => -minutesUntil(occ, now) - occ.type.durationMin;
const sinceStart = (occ, now) => -minutesUntil(occ, now);

// ¿Se le pregunta "¿Fuiste?"? Reservada, sin respuesta ni lista, terminó hace menos de 48 h.
export function canAsk({ occ, booking, attendanceTaken, now }) {
  const m = sinceEnd(occ, now);
  return booking.status === 'booked' && !booking.answeredAt && !attendanceTaken && m >= 0 && m < ATTENDANCE_WINDOWS.askHours * 60;
}

// A las 24 h del fin, una reserva sin lista ni respuesta: presente si tuvo ingreso físico ese día,
// si no, ausente. null si todavía no toca o ya se resolvió.
export function resolveAttendance({ occ, booking, checkedIn, now }) {
  if (booking.status !== 'booked' || booking.answeredAt) return null;
  if (sinceEnd(occ, now) < ATTENDANCE_WINDOWS.resolveHours * 60) return null;
  return checkedIn ? { status: 'attended', source: 'checkin' } : { status: 'absent', source: 'timeout' };
}

// La profe toma (o corrige) la lista desde que empieza hasta 7 días después.
export function canTakeAttendance({ occ, now }) {
  const m = sinceStart(occ, now);
  return !occ.cancelled && m >= 0 && m <= ATTENDANCE_WINDOWS.teacherDays * 1440;
}

// Calificar: presente, hasta 7 días después del fin.
export const canRate = ({ occ, booking, now }) => booking.status === 'attended' && sinceEnd(occ, now) <= ATTENDANCE_WINDOWS.ratingDays * 1440;

// Push "¿Fuiste?": `minutes` después del fin, antes de que venza la pregunta.
export function afterPushDue({ occ, now, minutes }) {
  const m = sinceEnd(occ, now);
  return m >= minutes && m < ATTENDANCE_WINDOWS.askHours * 60;
}

// Fecha y hora del gimnasio → milisegundos (con la zona horaria del gimnasio).
export function zonedToEpoch(date, time, tz) {
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5));
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const g = t => Number(parts.find(p => p.type === t).value);
  const asLocal = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  return guess - (asLocal - guess);
}

// El entrenamiento que una clase suma al historial del socio (kind: 'class'). Modo músculos: sin
// ejercicios, con muscleLoad para la fatiga. Modo ejercicios: las series de la profe, sin peso.
export function classWorkout({ occ, bookingId, tz }) {
  const start = zonedToEpoch(occ.date, occ.start, tz);
  const log = occ.type.log || {};
  const base = {
    id: 'cls-' + bookingId, d: occ.date, start, end: start + occ.type.durationMin * 60000, name: occ.type.name,
    kind: 'class', classBookingId: bookingId, classId: occ.classId, teacher: occ.teacherName || ''
  };
  if (occ.type.logMode === 'exercises') {
    return { ...base, entries: (log.exercises || []).map(e => ({ id: e.id, sets: Array.from({ length: e.sets }, () => ({ r: e.reps, done: true })) })) };
  }
  return { ...base, entries: [], muscleLoad: { muscles: [...(log.muscles || [])], intensity: log.intensity || 'medium' } };
}

// ---- números (entrega 3) ----

const avg = list => list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
// Ocupación promedio en %, sin las clases sin cupo; null si todas son sin cupo (0 si no hubo fechas).
const occupancyPct = list => {
  const limited = list.filter(o => o != null);
  return list.length && !limited.length ? null : Math.round(100 * (avg(limited) || 0));
};
// Cupo para reservar: sin cupo, nunca se llena.
export const capOf = type => type?.capacity ?? Infinity;
const round1 = v => v == null ? null : Math.round(v * 10) / 10;

// rows: [{ occ, bookings }] de fechas pasadas no suspendidas. → por clase, por profe y por bloque
// (día de la semana × hora). Ocupación en %, calificación promedio solo de quienes calificaron.
export function classStats(rows) {
  const byClass = new Map(), byTeacher = new Map(), bySlot = new Map();
  const bucket = (map, key, init) => { if (!map.has(key)) map.set(key, { ...init, occ: [], ratings: [] }); return map.get(key); };
  for (const { occ, bookings } of rows) {
    const booked = bookings.filter(b => ['booked', 'attended', 'absent'].includes(b.status)).length;
    const occupancy = occ.type.capacity == null ? null : Math.min(1, booked / occ.type.capacity);
    const ratings = bookings.filter(b => Number.isInteger(b.rating)).map(b => b.rating);
    const counts = {
      present: bookings.filter(b => b.status === 'attended').length,
      absent: bookings.filter(b => b.status === 'absent').length,
      lateCancels: bookings.filter(b => b.status === 'late_cancel').length,
      waitlisted: bookings.some(b => b.waitlistPos != null || b.status === 'waitlist')
    };
    const add = item => { item.occ.push({ occupancy, ...counts }); item.ratings.push(...ratings); };
    add(bucket(byClass, occ.classId, { classId: occ.classId, name: occ.type.name, color: occ.type.color }));
    if (occ.teacherName) add(bucket(byTeacher, occ.teacherUserId || 'n:' + occ.teacherName.toLowerCase(), { teacherUserId: occ.teacherUserId || null, name: occ.teacherName }));
    add(bucket(bySlot, `${weekdayOf(occ.date)}|${occ.start}`, { weekday: weekdayOf(occ.date), start: occ.start }));
  }
  const close = ({ occ, ratings, ...rest }) => ({
    ...rest, sessions: occ.length,
    occupancy: occupancyPct(occ.map(o => o.occupancy)),
    present: occ.reduce((n, o) => n + o.present, 0), absent: occ.reduce((n, o) => n + o.absent, 0),
    lateCancels: occ.reduce((n, o) => n + o.lateCancels, 0), withWaitlist: occ.filter(o => o.waitlisted).length,
    rating: round1(avg(ratings)), ratings: ratings.length
  });
  const sortBy = (list, f) => [...list].sort(f);
  return {
    classes: sortBy([...byClass.values()].map(close), (a, b) => a.name.localeCompare(b.name)),
    teachers: sortBy([...byTeacher.values()].map(close), (a, b) => a.name.localeCompare(b.name)),
    slots: sortBy([...bySlot.values()].map(close), (a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.start.localeCompare(b.start))
  };
}

// Penalización: ausencias y cancelaciones tardías de los últimos windowDays (dates: las fechas de
// esas clases). Con `absences` o más, bloqueado hasta blockDays después de la última. → null o
// { count, until } (until: primer día en que vuelve a poder reservar).
export function penaltyOf({ dates, today, penalty }) {
  if (!penalty?.on) return null;
  const from = addDays(today, -penalty.windowDays);
  const recent = dates.filter(d => d > from && d <= today).sort();
  if (recent.length < penalty.absences) return null;
  const until = addDays(recent[recent.length - 1], penalty.blockDays);
  return until > today ? { count: recent.length, until } : null;
}
