// Cierres del gimnasio en la base: la tabla class_closures (nació con clases; no se renombra) con
// las columnas del aviso general y la extensión, y closure_extensions (qué vencimiento se corrió a
// quién, para devolverlo al reabrir y para anular un pago). migrateClasses llama a migrateClosures.
import crypto from 'node:crypto';
import { getDatabase } from './database.js';
import { addDays } from './classes.js';

export function migrateClosures(db) {
  for (const col of ['notify_all INTEGER NOT NULL DEFAULT 0', 'announce_at INTEGER', 'announced_at INTEGER', 'notified_ids TEXT', 'extend_days INTEGER NOT NULL DEFAULT 0']) {
    try { db.exec(`ALTER TABLE class_closures ADD COLUMN ${col};`); } catch {}
  }
  db.exec(`CREATE TABLE IF NOT EXISTS closure_extensions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    closure_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    field TEXT NOT NULL CHECK (field IN ('due', 'trial')),
    days INTEGER NOT NULL,
    before TEXT,
    after TEXT,
    applied_at INTEGER NOT NULL,
    reverted_at INTEGER
  );`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_closure_extensions_user ON closure_extensions(user_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_closure_extensions_closure ON closure_extensions(closure_id);');
}

const parseIds = s => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const closureFromRow = r => r && ({
  id: r.id, from: r.from_date, to: r.to_date, reason: r.reason || '', createdBy: r.created_by || null, createdAt: r.created_at,
  notifyAll: r.notify_all === 1, announceAt: r.announce_at ?? null, announcedAt: r.announced_at ?? null,
  notifiedIds: parseIds(r.notified_ids), extendDays: r.extend_days || 0
});

// Los cierres que tocan [from, to] (fechas incluidas). Sin rango, todos.
export function getClosures({ from, to } = {}) {
  const db = getDatabase();
  const rows = from && to
    ? db.prepare('SELECT * FROM class_closures WHERE to_date >= ? AND from_date <= ? ORDER BY from_date').all(from, to)
    : db.prepare('SELECT * FROM class_closures ORDER BY from_date').all();
  return rows.map(closureFromRow);
}

export const getClosure = id => closureFromRow(getDatabase().prepare('SELECT * FROM class_closures WHERE id = ?').get(id));

export function addClosure({ from, to, reason = '', createdBy = null, notifyAll = false, announceAt = null, notifiedIds = [], extendDays = 0 }) {
  const id = 'k' + crypto.randomBytes(8).toString('hex');
  getDatabase().prepare(`INSERT INTO class_closures (id, from_date, to_date, reason, created_by, created_at, notify_all, announce_at, notified_ids, extend_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, from, to, reason, createdBy, new Date().toISOString(), notifyAll ? 1 : 0, announceAt, JSON.stringify(notifiedIds), extendDays);
  return getClosure(id);
}

export const deleteClosure = id => getDatabase().prepare('DELETE FROM class_closures WHERE id = ?').run(id).changes > 0;

// Avisos generales que ya tocan y no salieron, de cierres que todavía no terminaron.
export const pendingAnnouncements = (nowMs, today) => getDatabase()
  .prepare('SELECT * FROM class_closures WHERE notify_all = 1 AND announced_at IS NULL AND announce_at IS NOT NULL AND announce_at <= ? AND to_date >= ? ORDER BY from_date')
  .all(nowMs, today).map(closureFromRow);

// Marca el aviso como enviado (antes de mandarlo: un tick lento no lo repite). false si ya estaba.
export const markAnnounced = (id, nowMs) => getDatabase()
  .prepare('UPDATE class_closures SET announced_at = ? WHERE id = ? AND announced_at IS NULL').run(nowMs, id).changes === 1;

// Socios que reciben el aviso general: cuenta activa y aprobada, con alguna suscripción push.
export function announcementRecipients(excludeIds = []) {
  const skip = new Set(excludeIds);
  return getDatabase().prepare(`SELECT u.id FROM users u WHERE u.disabled = 0
      AND (u.approval_status IS NULL OR u.approval_status <> 'pending')
      AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id)
    ORDER BY u.id`).all()
    .map(r => r.id).filter(id => !skip.has(id));
}

const extFromRow = r => ({ id: r.id, closureId: r.closure_id, userId: r.user_id, field: r.field, days: r.days, before: r.before, after: r.after, appliedAt: r.applied_at, revertedAt: r.reverted_at ?? null });

export function getExtensions({ closureId, userId } = {}) {
  const db = getDatabase();
  const rows = closureId ? db.prepare('SELECT * FROM closure_extensions WHERE closure_id = ? ORDER BY id').all(closureId)
    : userId ? db.prepare('SELECT * FROM closure_extensions WHERE user_id = ? ORDER BY id').all(userId)
    : db.prepare('SELECT * FROM closure_extensions ORDER BY id').all();
  return rows.map(extFromRow);
}

const COLUMN = { due: 'due_date', trial: 'trial_until' };

// Una transacción propia, o la de quien llama si ya hay una abierta.
function inTransaction(db, fn) {
  let own = false;
  try { db.exec('BEGIN IMMEDIATE'); own = true; } catch (error) {
    if (!String(error?.message || '').toLowerCase().includes('within a transaction')) throw error;
  }
  try {
    const out = fn();
    if (own) db.exec('COMMIT');
    return out;
  } catch (error) {
    if (own) { try { db.exec('ROLLBACK'); } catch {} }
    throw error;
  }
}

// Corre `days` el vencimiento (o la prueba) de cada destino y lo registra. Todo o nada.
export function applyExtensions(closureId, targets, days, nowMs = Date.now()) {
  if (!days || !targets?.length) return 0;
  const db = getDatabase();
  return inTransaction(db, () => {
    let n = 0;
    for (const t of targets) {
      const col = COLUMN[t.field];
      if (!col) continue;
      const row = db.prepare(`SELECT ${col} AS v FROM member_billing WHERE user_id = ?`).get(t.userId);
      if (!row?.v) continue;
      const after = addDays(row.v, days);
      db.prepare(`UPDATE member_billing SET ${col} = ?, push_sent_for_due = NULL, updated_at = ? WHERE user_id = ?`).run(after, nowMs, t.userId);
      db.prepare('INSERT INTO closure_extensions (closure_id, user_id, field, days, before, after, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(closureId, t.userId, t.field, days, row.v, after, nowMs);
      n++;
    }
    return n;
  });
}

// Devuelve los días: resta `days` al valor actual (respeta los pagos del medio). Si el socio ya no
// tiene ese campo (sin plan, prueba cerrada por un pago), solo se marca.
export function revertExtensions(closureId, nowMs = Date.now()) {
  const db = getDatabase();
  const open = getExtensions({ closureId }).filter(e => !e.revertedAt);
  if (!open.length) return 0;
  return inTransaction(db, () => {
    for (const e of open) {
      const col = COLUMN[e.field];
      const row = db.prepare(`SELECT ${col} AS v FROM member_billing WHERE user_id = ?`).get(e.userId);
      if (row?.v) db.prepare(`UPDATE member_billing SET ${col} = ?, push_sent_for_due = NULL, updated_at = ? WHERE user_id = ?`).run(addDays(row.v, -e.days), nowMs, e.userId);
      db.prepare('UPDATE closure_extensions SET reverted_at = ? WHERE id = ?').run(nowMs, e.id);
    }
    return open.length;
  });
}
