// Ingreso Físico: la tablet o notebook de recepción donde el socio tipea su DNI y queda registrado
// que vino. Reglas y acceso a datos, sin HTTP (server.js arma las rutas). Todo recibe `db`.
//
// - Dispositivos: token de 32 bytes aleatorios; en la base solo su sha256. Alcance: solo los
//   endpoints /api/checkin/*.
// - lookup devuelve, por cada socio que coincide, un ticket opaco de un solo uso, atado al
//   dispositivo y que vence en TICKET_TTL_MS. confirm solo acepta un ticket: nunca un id.
// - Asistencia: una fila por socio y día (gym_tz), PRIMARY KEY (user_id, date). Las fichas sin
//   app también son filas de users, así que user_id sirve para todos.
import crypto from 'node:crypto';

export const CHECKIN_SETTINGS = {
  enabled: 'ingreso_fisico_enabled',
  mode: 'ingreso_fisico_mode',
  digits: 'ingreso_fisico_digits',
  showStatus: 'ingreso_fisico_show_status',
};
export const CHECKIN_MODES = ['full', 'last'];
export const CHECKIN_DIGITS = [3, 4, 5];
export const MAX_CANDIDATES = 5;
export const TICKET_TTL_MS = 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;
const MAX_DEVICE_NAME = 40;

/* ---------- opciones (admin_settings) ---------- */

// getSetting(key, fallback) → string | fallback. Sin valor guardado: apagado, DNI completo,
// 4 dígitos, mostrando el estado de cuota.
export function readCheckinSettings(getSetting) {
  const digits = Number(getSetting(CHECKIN_SETTINGS.digits, '4'));
  const mode = getSetting(CHECKIN_SETTINGS.mode, 'full');
  return {
    enabled: getSetting(CHECKIN_SETTINGS.enabled, 'false') === 'true',
    mode: CHECKIN_MODES.includes(mode) ? mode : 'full',
    digits: CHECKIN_DIGITS.includes(digits) ? digits : 4,
    showStatus: getSetting(CHECKIN_SETTINGS.showStatus, 'true') !== 'false',
  };
}

// Parche de opciones → { value } (solo lo recibido) o { error }.
export function validateCheckinSettings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'validation_error' };
  const value = {};
  for (const key of ['enabled', 'showStatus']) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'boolean') return { error: 'validation_error' };
    value[key] = body[key];
  }
  if (body.mode !== undefined) {
    if (!CHECKIN_MODES.includes(body.mode)) return { error: 'validation_error' };
    value.mode = body.mode;
  }
  if (body.digits !== undefined) {
    if (!CHECKIN_DIGITS.includes(body.digits)) return { error: 'validation_error' };
    value.digits = body.digits;
  }
  if (!Object.keys(value).length) return { error: 'validation_error' };
  return { value };
}

/* ---------- dispositivos ---------- */

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');

export function createDevice(db, { name, createdBy }) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_DEVICE_NAME);
  if (!clean) return { error: 'validation_error' };
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const row = db.prepare('INSERT INTO checkin_devices (name, token_hash, created_by, created_at) VALUES (?, ?, ?, ?)')
    .run(clean, sha256(token), createdBy || null, now);
  return { token, device: { id: Number(row.lastInsertRowid), name: clean, createdAt: now, lastUsedAt: null } };
}

// Dispositivo activo de un token, o null. La búsqueda va por el hash (índice único) y además se
// compara en tiempo constante.
export function findDevice(db, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const hash = sha256(token);
  const row = db.prepare('SELECT * FROM checkin_devices WHERE token_hash = ? AND revoked_at IS NULL').get(hash);
  if (!row) return null;
  const a = Buffer.from(row.token_hash, 'hex'), b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return row;
}

// last_used_at con throttle: como mucho una escritura por minuto por dispositivo.
export function touchDevice(db, device, now = Date.now()) {
  if (device.last_used_at && now - device.last_used_at < TOUCH_EVERY_MS) return;
  db.prepare('UPDATE checkin_devices SET last_used_at = ? WHERE id = ?').run(now, device.id);
}

export const listDevices = db => db.prepare('SELECT id, name, created_at, last_used_at FROM checkin_devices WHERE revoked_at IS NULL ORDER BY created_at DESC').all()
  .map(r => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at }));

export function revokeDevice(db, id) {
  const r = db.prepare('UPDATE checkin_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(Date.now(), Number(id));
  if (r.changes) dropTicketsOf(Number(id));
  return r.changes > 0;
}

export function revokeAllDevices(db) {
  const r = db.prepare('UPDATE checkin_devices SET revoked_at = ? WHERE revoked_at IS NULL').run(Date.now());
  tickets.clear();
  return r.changes;
}

/* ---------- tickets (memoria) ---------- */

const tickets = new Map();   // ticket → { userId, deviceId, exp }
function newTicket(userId, deviceId, now) {
  for (const [k, v] of tickets) if (v.exp <= now) tickets.delete(k);
  const ticket = crypto.randomBytes(18).toString('base64url');
  tickets.set(ticket, { userId, deviceId, exp: now + TICKET_TTL_MS });
  return ticket;
}
function takeTicket(ticket, deviceId, now) {
  if (typeof ticket !== 'string') return null;
  const t = tickets.get(ticket);
  if (!t) return null;
  // Uno ajeno no se consume: el dispositivo dueño todavía lo puede usar.
  if (t.deviceId !== deviceId) return null;
  tickets.delete(ticket);
  return t.exp > now ? t : null;
}
function dropTicketsOf(deviceId) { for (const [k, v] of tickets) if (v.deviceId === deviceId) tickets.delete(k); }

/* ---------- búsqueda y registro ---------- */

// "Juan Pérez García" → "Juan P." (nunca el DNI ni el apellido completo).
export function shortName(fullName) {
  const words = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words.length > 1 ? `${words[0]} ${words[1][0].toUpperCase()}.` : words[0];
}

// Socios que pueden registrar un ingreso: con DNI cargado, no desactivados ni pendientes de
// aprobación (tampoco rechazados: quedan desactivados).
const ACTIVE_WITH_DNI = `
  SELECT u.id AS user_id, COALESCE(NULLIF(mp.full_name, ''), u.name) AS name, NULLIF(TRIM(mp.full_name), '') AS full_name,
    u.name AS nick, mp.dni_norm
  FROM member_profile mp JOIN users u ON u.id = mp.user_id
  WHERE mp.dni_norm IS NOT NULL AND COALESCE(u.disabled, 0) = 0 AND u.approval_status IS NULL`;

/**
 * @returns {{ error: 'validation_error' } | { status: 'not_found' } | { status: 'too_many' } |
 *           { status: 'found', candidates: [{ ticket, name }] }}
 */
export function lookup(db, { query, settings, deviceId, now = Date.now() }) {
  const digits = String(query ?? '').replace(/\D/g, '');
  let rows;
  if (settings.mode === 'full') {
    const norm = digits.replace(/^0+/, '');
    if (norm.length < 6 || norm.length > 8) return { error: 'validation_error' };
    rows = db.prepare(`${ACTIVE_WITH_DNI} AND mp.dni_norm = ?`).all(norm);
  } else {
    // Últimos N dígitos; se aceptan más (hasta 8) cuando hay muchas coincidencias.
    if (digits.length < settings.digits || digits.length > 8) return { error: 'validation_error' };
    rows = db.prepare(`${ACTIVE_WITH_DNI} AND substr(mp.dni_norm, -?) = ?`).all(digits.length, digits);
  }
  if (!rows.length) return { status: 'not_found' };
  if (rows.length > MAX_CANDIDATES) return { status: 'too_many' };
  const candidates = rows.map(r => ({ ticket: newTicket(r.user_id, deviceId, now), name: shortName(r.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return { status: 'found', candidates };
}

/**
 * Registra el ingreso de hoy del socio del ticket.

 * @returns {{ error: 'invalid_ticket' } | { status: 'not_found' } | { userId, already: boolean }}
 */
export function confirm(db, { ticket, deviceId, today, now = Date.now() }) {
  const t = takeTicket(ticket, deviceId, now);
  if (!t) return { error: 'invalid_ticket' };
  // La cuenta pudo darse de baja en los segundos entre la búsqueda y la confirmación.
  const active = db.prepare(`${ACTIVE_WITH_DNI} AND u.id = ?`).get(t.userId);
  if (!active) return { status: 'not_found' };
  // Sin SELECT previo: la clave primaria decide si ya había uno hoy (sin carrera entre dos taps).
  const r = db.prepare("INSERT OR IGNORE INTO attendance (user_id, date, source, device_id, created_at) VALUES (?, ?, 'physical', ?, ?)")
    .run(t.userId, today, deviceId, now);
  return { userId: t.userId, name: active.name, fullName: active.full_name, nick: active.nick, already: r.changes === 0 };
}

// Ingresos de un día para la sección del admin (más nuevo primero). La asistencia se guarda
// sin vencimiento: cualquier día anterior se puede consultar.
//   fullName: nombre y apellido de la ficha (null si no se cargó); nick: nombre de usuario.
export function dayCheckins(db, date) {
  return db.prepare(`
    SELECT a.user_id, a.source, a.created_at, NULLIF(TRIM(mp.full_name), '') AS full_name, u.name AS nick
    FROM attendance a JOIN users u ON u.id = a.user_id LEFT JOIN member_profile mp ON mp.user_id = a.user_id
    WHERE a.date = ? ORDER BY a.created_at DESC`).all(date)
    .map(r => ({ userId: r.user_id, fullName: r.full_name, nick: r.nick, source: r.source, at: r.created_at }));
}

// Solo para tests.
export const _tickets = tickets;
