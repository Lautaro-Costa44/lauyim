// Clases grupales (docs/superpowers/specs/2026-10-01-clases-design.md). Puro: validación, fechas
// de cada clase a partir del horario semanal, superposición, reglas de reserva, recordatorios y
// el .ics. Sin base ni HTTP: server.js y scheduler.js le pasan los datos. Fechas y horas son las
// del gimnasio (gymClock), como 'YYYY-MM-DD' y 'HH:MM'; `now` es { date, time }.

export const CLASS_DEFAULTS = Object.freeze({ enabled: true, bookAheadDays: 7, cancelHours: 2, waitlistCutoffMin: 60, allowOverlap: false });
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
  if (!intIn(body.capacity, [1, 200])) return { error: 'El cupo va de 1 a 200', field: 'capacity' };
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

// Fechas de clases en [from, from + days): las del horario semanal (de las clases no archivadas)
// más las sesiones guardadas, que pisan a la calculada del mismo bloque y fecha (cambio de hora,
// de profe, cancelada) o son clases sueltas (sin bloque). userNames: { userId: nombre } para las
// profes con cuenta. Ordenadas por fecha, hora y nombre.
export function occurrencesBetween({ types, slots, sessions = [], from, days, userNames = {} }) {
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
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.type.name.localeCompare(b.type.name));
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
