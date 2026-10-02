// Clases en la base (docs/superpowers/specs/2026-10-01-clases-design.md): tablas y acceso a datos.
// La lógica (fechas, superposición, reglas de reserva) está en classes.js; acá solo se guarda y se
// lee, y las reservas que tocan el cupo van en una transacción. initDatabase (database.js) llama
// a migrateClasses.
import crypto from 'node:crypto';
import { getDatabase } from './database.js';

export function migrateClasses(db) {
  migrateClassTables(db);
  // Fecha suspendida que se sacó del calendario.
  try { db.exec('ALTER TABLE class_sessions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;'); } catch {}
  // Entrega 2: el socio contestó "¿Fuiste?" y la clase ya está en su historial.
  try { db.exec('ALTER TABLE class_bookings ADD COLUMN answered_at TEXT;'); } catch {}
  try { db.exec('ALTER TABLE class_bookings ADD COLUMN logged INTEGER NOT NULL DEFAULT 0;'); } catch {}
}

function migrateClassTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS class_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'dumbbell',
      description TEXT NOT NULL DEFAULT '',
      duration_min INTEGER NOT NULL,
      capacity INTEGER NOT NULL,
      teacher_user_id TEXT,
      teacher_name TEXT NOT NULL DEFAULT '',
      room TEXT NOT NULL DEFAULT '',
      log_mode TEXT NOT NULL DEFAULT 'muscles',
      log TEXT NOT NULL DEFAULT '{}',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS class_slots (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL REFERENCES class_types(id),
      weekday INTEGER NOT NULL,
      start TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS class_sessions (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL REFERENCES class_types(id),
      slot_id TEXT,
      date TEXT NOT NULL,
      start TEXT NOT NULL,
      moved_from TEXT,
      teacher_user_id TEXT,
      teacher_name TEXT,
      cancelled INTEGER NOT NULL DEFAULT 0,
      attendance_taken INTEGER NOT NULL DEFAULT 0,
      UNIQUE (slot_id, date)
    );
    CREATE INDEX IF NOT EXISTS class_sessions_date ON class_sessions(date);
    CREATE TABLE IF NOT EXISTS class_bookings (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES class_sessions(id),
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      waitlist_pos INTEGER,
      reminders TEXT NOT NULL DEFAULT '[60]',
      reminders_sent TEXT NOT NULL DEFAULT '[]',
      recurring_id TEXT,
      added_by TEXT,
      attendance_source TEXT,
      rating INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (session_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS class_bookings_user ON class_bookings(user_id);
    CREATE TABLE IF NOT EXISTS class_notices (
      user_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (user_id, session_key, kind)
    );
    CREATE TABLE IF NOT EXISTS class_prefs (
      user_id TEXT PRIMARY KEY,
      reminders TEXT NOT NULL DEFAULT '[60]'
    );
    CREATE TABLE IF NOT EXISTS class_recurring (
      id TEXT PRIMARY KEY,
      slot_id TEXT NOT NULL REFERENCES class_slots(id),
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (slot_id, user_id)
    );
  `);
}

const newId = prefix => prefix + '-' + crypto.randomBytes(6).toString('hex');
const nowIso = () => new Date().toISOString();
const parse = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };

function inTransaction(fn) {
  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn(db);
    db.exec('COMMIT');
    return out;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

// ---- clases ----

const typeFromRow = r => r && ({
  id: r.id, name: r.name, color: r.color, icon: r.icon, description: r.description, durationMin: r.duration_min,
  capacity: r.capacity, teacherUserId: r.teacher_user_id || null, teacherName: r.teacher_name || '', room: r.room || '',
  logMode: r.log_mode, log: parse(r.log, {}), archived: !!r.archived, createdAt: r.created_at
});

export function getClassTypes({ includeArchived = false } = {}) {
  const rows = getDatabase().prepare(`SELECT * FROM class_types ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY name COLLATE NOCASE`).all();
  return rows.map(typeFromRow);
}

export const getClassType = id => typeFromRow(getDatabase().prepare('SELECT * FROM class_types WHERE id = ?').get(id));

// Crea (sin id) o edita una clase ya validada (classes.js → validateClassType). null si el id no existe.
export function saveClassType({ id, name, color, icon, description, durationMin, capacity, teacherUserId, teacherName, room, logMode, log }) {
  const db = getDatabase();
  const values = [name, color, icon, description, durationMin, capacity, teacherUserId || null, teacherName || '', room || '', logMode, JSON.stringify(log)];
  if (id) {
    const res = db.prepare(`UPDATE class_types SET name = ?, color = ?, icon = ?, description = ?, duration_min = ?, capacity = ?,
      teacher_user_id = ?, teacher_name = ?, room = ?, log_mode = ?, log = ? WHERE id = ?`).run(...values, id);
    return res.changes ? getClassType(id) : null;
  }
  const created = newId('c');
  db.prepare(`INSERT INTO class_types (name, color, icon, description, duration_min, capacity, teacher_user_id, teacher_name, room, log_mode, log, id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...values, created, nowIso());
  return getClassType(created);
}

// Archivada: sin fechas nuevas ni reservas; lo guardado (y el historial de los socios) queda.
export const archiveClassType = id => getDatabase().prepare('UPDATE class_types SET archived = 1 WHERE id = ?').run(id).changes > 0;

// ---- horario semanal ----

const slotFromRow = r => r && ({ id: r.id, classId: r.class_id, weekday: r.weekday, start: r.start });

export function getClassSlots({ classId } = {}) {
  const db = getDatabase();
  const rows = classId
    ? db.prepare('SELECT * FROM class_slots WHERE class_id = ? ORDER BY weekday, start').all(classId)
    : db.prepare('SELECT * FROM class_slots ORDER BY weekday, start').all();
  return rows.map(slotFromRow);
}

export const getClassSlot = id => slotFromRow(getDatabase().prepare('SELECT * FROM class_slots WHERE id = ?').get(id));

export function saveClassSlot({ id, classId, weekday, start }) {
  const db = getDatabase();
  if (id) {
    const res = db.prepare('UPDATE class_slots SET weekday = ?, start = ? WHERE id = ?').run(weekday, start, id);
    return res.changes ? getClassSlot(id) : null;
  }
  const created = newId('s');
  db.prepare('INSERT INTO class_slots (id, class_id, weekday, start, created_at) VALUES (?, ?, ?, ?, ?)').run(created, classId, weekday, start, nowIso());
  return getClassSlot(created);
}

// Borra el bloque y sus reservas fijas. Las fechas ya guardadas quedan (server.js cancela las
// futuras con reservas antes de borrar).
export function deleteClassSlot(id) {
  return inTransaction(db => {
    db.prepare('DELETE FROM class_recurring WHERE slot_id = ?').run(id);
    return db.prepare('DELETE FROM class_slots WHERE id = ?').run(id).changes > 0;
  });
}

// ---- fechas guardadas ----

const sessionFromRow = r => r && ({
  id: r.id, classId: r.class_id, slotId: r.slot_id || null, date: r.date, start: r.start, movedFrom: r.moved_from || null,
  teacherUserId: r.teacher_user_id || null, teacherName: r.teacher_name || null, cancelled: !!r.cancelled, attendanceTaken: !!r.attendance_taken, hidden: !!r.hidden
});

// Fechas guardadas en [from, to).
export function getClassSessions({ from, to }) {
  return getDatabase().prepare('SELECT * FROM class_sessions WHERE date >= ? AND date < ? ORDER BY date, start').all(from, to).map(sessionFromRow);
}

export const getClassSession = id => sessionFromRow(getDatabase().prepare('SELECT * FROM class_sessions WHERE id = ?').get(id));

export const getSessionBySlot = (slotId, date) => sessionFromRow(getDatabase().prepare('SELECT * FROM class_sessions WHERE slot_id = ? AND date = ?').get(slotId, date));

// La fecha guardada de un bloque (la crea si no está). Sin bloque: una clase suelta nueva.
export function ensureClassSession({ classId, slotId, date, start }) {
  const db = getDatabase();
  if (slotId) {
    const found = getSessionBySlot(slotId, date);
    if (found) return found;
    const created = newId('x');
    db.prepare('INSERT OR IGNORE INTO class_sessions (id, class_id, slot_id, date, start) VALUES (?, ?, ?, ?, ?)').run(created, classId, slotId, date, start);
    return getSessionBySlot(slotId, date);
  }
  const created = newId('x');
  db.prepare('INSERT INTO class_sessions (id, class_id, slot_id, date, start) VALUES (?, ?, NULL, ?, ?)').run(created, classId, date, start);
  return getClassSession(created);
}

const SESSION_COLUMNS = { start: 'start', movedFrom: 'moved_from', teacherUserId: 'teacher_user_id', teacherName: 'teacher_name', cancelled: 'cancelled', attendanceTaken: 'attendance_taken', hidden: 'hidden' };

export function updateClassSession(id, patch) {
  const sets = [], values = [];
  for (const [key, column] of Object.entries(SESSION_COLUMNS)) {
    if (!(key in patch)) continue;
    sets.push(`${column} = ?`);
    values.push(typeof patch[key] === 'boolean' ? (patch[key] ? 1 : 0) : patch[key] ?? null);
  }
  if (sets.length) getDatabase().prepare(`UPDATE class_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  return getClassSession(id);
}

// ---- reservas ----

const ACTIVE = "('booked', 'waitlist')";

const bookingFromRow = r => r && ({
  id: r.id, sessionId: r.session_id, userId: r.user_id, status: r.status, waitlistPos: r.waitlist_pos ?? null,
  reminders: parse(r.reminders, [60]), remindersSent: parse(r.reminders_sent, []), recurringId: r.recurring_id || null,
  addedBy: r.added_by || null, attendanceSource: r.attendance_source || null, rating: r.rating ?? null,
  answeredAt: r.answered_at || null, logged: !!r.logged,
  createdAt: r.created_at, updatedAt: r.updated_at
});
// Reserva con su fecha (filas de un JOIN con class_sessions, columnas s_*).
const withSession = r => ({ ...bookingFromRow(r), session: sessionFromRow({
  id: r.session_id, class_id: r.s_class_id, slot_id: r.s_slot_id, date: r.s_date, start: r.s_start, moved_from: r.s_moved_from,
  teacher_user_id: r.s_teacher_user_id, teacher_name: r.s_teacher_name, cancelled: r.s_cancelled, attendance_taken: r.s_attendance_taken
}) });
const JOIN_SESSION = `SELECT b.*, s.class_id AS s_class_id, s.slot_id AS s_slot_id, s.date AS s_date, s.start AS s_start,
  s.moved_from AS s_moved_from, s.teacher_user_id AS s_teacher_user_id, s.teacher_name AS s_teacher_name,
  s.cancelled AS s_cancelled, s.attendance_taken AS s_attendance_taken
  FROM class_bookings b JOIN class_sessions s ON s.id = b.session_id`;

export const getBooking = id => bookingFromRow(getDatabase().prepare('SELECT * FROM class_bookings WHERE id = ?').get(id));

export function getBookingWithSession(id) {
  const row = getDatabase().prepare(`${JOIN_SESSION} WHERE b.id = ?`).get(id);
  return row ? withSession(row) : null;
}

export function getBookingsForSessions(ids) {
  if (!ids.length) return [];
  return getDatabase().prepare(`SELECT * FROM class_bookings WHERE session_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at, rowid`).all(...ids).map(bookingFromRow);
}

// Reservas de un socio desde una fecha, con su fecha guardada, por fecha y hora.
export function getUserBookings(userId, { from }) {
  return getDatabase().prepare(`${JOIN_SESSION} WHERE b.user_id = ? AND s.date >= ? ORDER BY s.date, s.start`).all(userId, from).map(withSession);
}

// Reservas en [from, to) con alguno de esos estados, con su fecha (scheduler).
export function getBookingsInRange({ from, to, statuses }) {
  return getDatabase().prepare(`${JOIN_SESSION} WHERE s.date >= ? AND s.date < ? AND b.status IN (${statuses.map(() => '?').join(',')}) ORDER BY s.date, s.start`)
    .all(from, to, ...statuses).map(withSession);
}

const BOOKING_COLUMNS = { status: 'status', waitlistPos: 'waitlist_pos', reminders: 'reminders', remindersSent: 'reminders_sent', attendanceSource: 'attendance_source', rating: 'rating', answeredAt: 'answered_at', logged: 'logged' };

export function updateBooking(id, patch) {
  const sets = ['updated_at = ?'], values = [nowIso()];
  for (const [key, column] of Object.entries(BOOKING_COLUMNS)) {
    if (!(key in patch)) continue;
    sets.push(`${column} = ?`);
    values.push(Array.isArray(patch[key]) ? JSON.stringify(patch[key]) : typeof patch[key] === 'boolean' ? (patch[key] ? 1 : 0) : patch[key] ?? null);
  }
  getDatabase().prepare(`UPDATE class_bookings SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  return getBooking(id);
}

export const countBooked = sessionId => Number(getDatabase().prepare("SELECT COUNT(*) AS n FROM class_bookings WHERE session_id = ? AND status = 'booked'").get(sessionId).n);

// Reserva (o lista de espera) en una transacción, así dos socios no se quedan con el último lugar.
// Si ya tiene una activa, la devuelve (created: false). force: el staff anota aunque esté lleno.
export function bookOrWaitlist({ sessionId, userId, capacity, reminders = [60], recurringId = null, addedBy = null, force = false }) {
  return inTransaction(db => {
    const existing = db.prepare('SELECT * FROM class_bookings WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
    if (existing && ['booked', 'waitlist'].includes(existing.status)) return { booking: bookingFromRow(existing), created: false };
    const booked = Number(db.prepare("SELECT COUNT(*) AS n FROM class_bookings WHERE session_id = ? AND status = 'booked'").get(sessionId).n);
    const full = booked >= capacity && !force;
    const pos = full ? Number(db.prepare("SELECT COALESCE(MAX(waitlist_pos), 0) AS n FROM class_bookings WHERE session_id = ? AND status = 'waitlist'").get(sessionId).n) + 1 : null;
    const status = full ? 'waitlist' : 'booked';
    const now = nowIso();
    if (existing) {
      db.prepare(`UPDATE class_bookings SET status = ?, waitlist_pos = ?, reminders = ?, reminders_sent = '[]', recurring_id = ?, added_by = ?,
        attendance_source = NULL, rating = NULL, created_at = ?, updated_at = ? WHERE id = ?`)
        .run(status, pos, JSON.stringify(reminders), recurringId, addedBy, now, now, existing.id);
      return { booking: bookingFromRow(db.prepare('SELECT * FROM class_bookings WHERE id = ?').get(existing.id)), created: true };
    }
    const id = newId('b');
    db.prepare(`INSERT INTO class_bookings (id, session_id, user_id, status, waitlist_pos, reminders, recurring_id, added_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, sessionId, userId, status, pos, JSON.stringify(reminders), recurringId, addedBy, now, now);
    return { booking: bookingFromRow(db.prepare('SELECT * FROM class_bookings WHERE id = ?').get(id)), created: true };
  });
}

// Cancela (kind: 'cancelled' | 'late_cancel') y, si promote y se liberó un lugar, pasa a la primera
// de la lista de espera a reservada. → { booking, promoted | null }.
export function cancelAndPromote({ bookingId, kind, promote, capacity }) {
  return inTransaction(db => {
    const row = db.prepare('SELECT * FROM class_bookings WHERE id = ?').get(bookingId);
    if (!row) return { booking: null, promoted: null };
    const now = nowIso();
    db.prepare('UPDATE class_bookings SET status = ?, waitlist_pos = NULL, updated_at = ? WHERE id = ?').run(kind, now, bookingId);
    let promoted = null;
    if (promote && row.status === 'booked') {
      const booked = Number(db.prepare("SELECT COUNT(*) AS n FROM class_bookings WHERE session_id = ? AND status = 'booked'").get(row.session_id).n);
      const first = booked < capacity && db.prepare("SELECT * FROM class_bookings WHERE session_id = ? AND status = 'waitlist' ORDER BY waitlist_pos, rowid LIMIT 1").get(row.session_id);
      if (first) {
        db.prepare("UPDATE class_bookings SET status = 'booked', waitlist_pos = NULL, updated_at = ? WHERE id = ?").run(now, first.id);
        promoted = bookingFromRow(db.prepare('SELECT * FROM class_bookings WHERE id = ?').get(first.id));
      }
    }
    return { booking: bookingFromRow(db.prepare('SELECT * FROM class_bookings WHERE id = ?').get(bookingId)), promoted };
  });
}

// Fecha suspendida: sus reservas y su lista de espera pasan a canceladas (sin contar como tardías).
// → los usuarios a avisar.
export function cancelSessionBookings(sessionId) {
  return inTransaction(db => {
    const users = db.prepare(`SELECT user_id FROM class_bookings WHERE session_id = ? AND status IN ${ACTIVE}`).all(sessionId).map(r => r.user_id);
    db.prepare(`UPDATE class_bookings SET status = 'cancelled', waitlist_pos = NULL, updated_at = ? WHERE session_id = ? AND status IN ${ACTIVE}`).run(nowIso(), sessionId);
    return users;
  });
}

// ---- reservas fijas ----

const recurringFromRow = r => r && ({ id: r.id, slotId: r.slot_id, userId: r.user_id, createdAt: r.created_at });

export function getRecurring({ slotId, userId } = {}) {
  const where = [], values = [];
  if (slotId) { where.push('slot_id = ?'); values.push(slotId); }
  if (userId) { where.push('user_id = ?'); values.push(userId); }
  return getDatabase().prepare(`SELECT * FROM class_recurring ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at, rowid`).all(...values).map(recurringFromRow);
}

export function addRecurring(slotId, userId) {
  getDatabase().prepare('INSERT OR IGNORE INTO class_recurring (id, slot_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(newId('r'), slotId, userId, nowIso());
  return getRecurring({ slotId, userId })[0];
}

export const removeRecurring = (slotId, userId) => getDatabase().prepare('DELETE FROM class_recurring WHERE slot_id = ? AND user_id = ?').run(slotId, userId).changes > 0;

// ---- preferencias del socio ----

// Recordatorios de entrada para sus reservas nuevas (Ajustes), o null si nunca los eligió.
export function getClassReminderDefaults(userId) {
  const row = getDatabase().prepare('SELECT reminders FROM class_prefs WHERE user_id = ?').get(userId);
  return row ? parse(row.reminders, null) : null;
}

export function setClassReminderDefaults(userId, reminders) {
  getDatabase().prepare('INSERT INTO class_prefs (user_id, reminders) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET reminders = excluded.reminders')
    .run(userId, JSON.stringify(reminders));
}

// ---- avisos que salen una sola vez ----

// true la primera vez para (socio, fecha, tipo); después false. Para avisos que no se repiten.
export function noticeOnce(userId, sessionKey, kind) {
  return getDatabase().prepare('INSERT OR IGNORE INTO class_notices (user_id, session_key, kind, sent_at) VALUES (?, ?, ?, ?)')
    .run(userId, sessionKey, kind, nowIso()).changes > 0;
}

// ---- asistencia y penalización ----

// ¿Registró Ingreso Físico ese día? (tabla attendance de database.js)
export const hasCheckin = (userId, date) => !!getDatabase().prepare('SELECT 1 FROM attendance WHERE user_id = ? AND date = ? LIMIT 1').get(userId, date);

// Fechas de sus ausencias y cancelaciones tardías desde `from` (excluido).
export function absenceDates(userId, from) {
  return getDatabase().prepare(`SELECT s.date FROM class_bookings b JOIN class_sessions s ON s.id = b.session_id
    WHERE b.user_id = ? AND b.status IN ('absent', 'late_cancel') AND s.date > ? ORDER BY s.date`).all(userId, from).map(r => r.date);
}

// Reservas de un socio en [from, to) con su fecha.
export function getUserBookingsBetween(userId, from, to) {
  return getDatabase().prepare(`${JOIN_SESSION} WHERE b.user_id = ? AND s.date >= ? AND s.date < ? ORDER BY s.date, s.start`).all(userId, from, to).map(withSession);
}
