// Suplementos en la base (docs/superpowers/specs/2026-10-09-suplementos-design.md): tablas y acceso
// a datos. Las reglas (fechas, validación, recordatorios) están en supplements.js. initDatabase
// (database.js) llama a migrateSupplements.
import { getDatabase } from './database.js';

export function migrateSupplements(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS supplement_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      catalog_id TEXT,
      name TEXT,
      dose REAL,
      unit TEXT,
      scoop_g REAL,
      doses_per_day INTEGER NOT NULL DEFAULT 1,
      slot TEXT NOT NULL DEFAULT 'any',
      days TEXT NOT NULL DEFAULT 'daily',
      reminder_time TEXT,
      meta TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_supp_items_user ON supplement_items(user_id);
    CREATE TABLE IF NOT EXISTS supplement_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id TEXT REFERENCES supplement_items(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      source TEXT,
      amount REAL,
      comida_id INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_supp_logs_user_date ON supplement_logs(user_id, date);
    CREATE TABLE IF NOT EXISTS supplement_profile (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ack_version TEXT,
      ack_at TEXT,
      adult INTEGER,
      last_reminder_sent TEXT
    );
  `);
  // Un recordatorio por dosis: la lista de horas (JSON). reminder_time queda con la primera, para la
  // consulta de los que tienen recordatorio.
  try { db.exec('ALTER TABLE supplement_items ADD COLUMN reminder_times TEXT;'); } catch {}
}

const parse = v => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
const itemFromRow = r => r && ({
  id: r.id, catalogId: r.catalog_id || null, name: r.name || null, dose: r.dose, unit: r.unit || null, scoopG: r.scoop_g ?? null,
  doses: r.doses_per_day, slot: r.slot, days: r.days, reminderTimes: parse(r.reminder_times) || (r.reminder_time ? [r.reminder_time] : []), meta: parse(r.meta),
  status: r.status, createdAt: r.created_at, updatedAt: r.updated_at
});
const logFromRow = r => r && ({ id: r.id, itemId: r.item_id || null, date: r.date, source: r.source || null, amount: r.amount ?? 0, comidaId: r.comida_id ?? null, createdAt: r.created_at });
const nowIso = () => new Date().toISOString();

export const listItems = userId => getDatabase().prepare('SELECT * FROM supplement_items WHERE user_id = ? ORDER BY created_at, id').all(userId).map(itemFromRow);
export const getItem = (userId, id) => itemFromRow(getDatabase().prepare('SELECT * FROM supplement_items WHERE user_id = ? AND id = ?').get(userId, id)) || null;

export function saveItem(userId, item) {
  const db = getDatabase();
  const at = nowIso();
  const times = Array.isArray(item.reminderTimes) ? item.reminderTimes : [];
  const values = [item.catalogId || null, item.name || null, item.dose ?? null, item.unit || null, item.scoopG ?? null, item.doses || 1, item.slot || 'any', item.days || 'daily', times[0] || null, times.length ? JSON.stringify(times) : null, item.meta ? JSON.stringify(item.meta) : null];
  const res = db.prepare(`UPDATE supplement_items SET catalog_id = ?, name = ?, dose = ?, unit = ?, scoop_g = ?, doses_per_day = ?, slot = ?, days = ?, reminder_time = ?, reminder_times = ?, meta = ?, updated_at = ?
    WHERE id = ? AND user_id = ?`).run(...values, at, item.id, userId);
  if (!res.changes) {
    db.prepare(`INSERT INTO supplement_items (catalog_id, name, dose, unit, scoop_g, doses_per_day, slot, days, reminder_time, reminder_times, meta, updated_at, id, user_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`).run(...values, at, item.id, userId, at);
  }
  return getItem(userId, item.id);
}

export const setItemStatus = (userId, id, status) => getDatabase().prepare('UPDATE supplement_items SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(status, nowIso(), id, userId).changes > 0;

export function deleteItem(userId, id) {
  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const r of db.prepare('SELECT comida_id FROM supplement_logs WHERE user_id = ? AND item_id = ? AND comida_id IS NOT NULL').all(userId, id)) {
      db.prepare('DELETE FROM comidas_registradas WHERE id = ? AND user_id = ?').run(r.comida_id, userId);
    }
    db.prepare('DELETE FROM supplement_logs WHERE user_id = ? AND item_id = ?').run(userId, id);
    const n = db.prepare('DELETE FROM supplement_items WHERE user_id = ? AND id = ?').run(userId, id).changes;
    db.exec('COMMIT');
    return n > 0;
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}

export const listLogs = (userId, fromDate) => getDatabase().prepare('SELECT * FROM supplement_logs WHERE user_id = ? AND date >= ? ORDER BY date, created_at, id').all(userId, fromDate).map(logFromRow);
export const getLog = (userId, id) => logFromRow(getDatabase().prepare('SELECT * FROM supplement_logs WHERE user_id = ? AND id = ?').get(userId, id)) || null;

export function addLog(userId, log) {
  const existing = getLog(userId, log.id);
  if (existing) return existing;
  getDatabase().prepare('INSERT INTO supplement_logs (id, user_id, item_id, date, source, amount, comida_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(log.id, userId, log.itemId || null, log.date, log.source || null, log.amount ?? 0, log.comidaId ?? null, nowIso());
  return getLog(userId, log.id);
}

export function deleteLog(userId, id) {
  const row = getLog(userId, id);
  if (!row) return null;
  const db = getDatabase();
  if (row.comidaId) db.prepare('DELETE FROM comidas_registradas WHERE id = ? AND user_id = ?').run(row.comidaId, userId);
  db.prepare('DELETE FROM supplement_logs WHERE user_id = ? AND id = ?').run(userId, id);
  return row;
}

export function getProfile(userId) {
  const r = getDatabase().prepare('SELECT * FROM supplement_profile WHERE user_id = ?').get(userId);
  return { ackVersion: r?.ack_version || null, ackAt: r?.ack_at || null, adult: r?.adult ?? null, lastReminderSent: parse(r?.last_reminder_sent) || {} };
}
const ensureProfile = userId => getDatabase().prepare('INSERT OR IGNORE INTO supplement_profile (user_id) VALUES (?)').run(userId);
export function setAck(userId, version, adult) {
  ensureProfile(userId);
  getDatabase().prepare('UPDATE supplement_profile SET ack_version = ?, ack_at = ?, adult = COALESCE(?, adult) WHERE user_id = ?').run(version, nowIso(), adult ?? null, userId);
}
export function markReminderSent(userId, itemId, date) {
  ensureProfile(userId);
  const sent = { ...getProfile(userId).lastReminderSent, [itemId]: date };
  getDatabase().prepare('UPDATE supplement_profile SET last_reminder_sent = ? WHERE user_id = ?').run(JSON.stringify(sent), userId);
}
export const itemsWithReminders = () => getDatabase()
  .prepare("SELECT * FROM supplement_items WHERE status = 'active' AND reminder_time IS NOT NULL ORDER BY user_id, created_at, id").all()
  .map(r => ({ ...itemFromRow(r), userId: r.user_id }));

// "Borrar mis datos de salud": todo lo de suplementos (las comidas de proteína las borra deleteHealthData).
export function deleteSupplementData(db, userId) {
  db.prepare('DELETE FROM supplement_logs WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM supplement_items WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM supplement_profile WHERE user_id = ?').run(userId);
}
