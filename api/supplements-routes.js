// Rutas de suplementos (docs/superpowers/specs/2026-10-09-suplementos-design.md). server.js las suma con
// supplementRoutes({ ... }); el scheduler usa sendSupplementReminders y sync.js usa writeGuard. La
// lógica está en supplements.js y los datos en supplements-db.js. El staff no ve nada de esto.
import * as sdb from './supplements-db.js';
import { SUPP_ACK_VERSION, validateItem, validateLog, proteinMeal, reminderDue, supplementsEnabled } from './supplements.js';
import { getAdminSetting, setAdminSetting, getDatabase, getUserState } from './database.js';
import { gymClock, getBillingSettings } from './billing.js';
import { addDays } from './classes.js';
import { supplementReminderPush } from './push-messages.js';

export const SUPPLEMENTS_SETTING = 'supplements_enabled';
export const supplementsOn = () => supplementsEnabled(getAdminSetting(SUPPLEMENTS_SETTING));
const gymTz = () => getBillingSettings(getDatabase()).gym_tz;
const clock = (ms = Date.now(), tz = gymTz()) => gymClock(ms, tz);
const edadOf = userId => getDatabase().prepare('SELECT edad FROM user_state WHERE user_id = ?').get(userId)?.edad ?? null;
export function adultOf(userId) {
  const edad = Number(edadOf(userId));
  if (edad > 0) return edad >= 18 ? 'adult' : 'minor';
  const a = sdb.getProfile(userId).adult;
  return a === 1 ? 'adult' : a === 0 ? 'minor' : 'unknown';
}
// Escritura permitida: módulo prendido, consentimiento de salud, aviso vigente aceptado y no es menor.
// → null o [status, body]. Las rutas ya pasan por el gate de salud de server.js; esto cubre además las
// tomas que llegan por la cola de sync (POST /api/data/sync), que no pasa por ese gate.
export function writeGuard(user) {
  if (!supplementsOn()) return [404, { error: 'supplements_off' }];
  if (getDatabase().prepare('SELECT health_consent FROM users WHERE id = ?').get(user.id)?.health_consent === 'declined') return [403, { error: 'health_consent_required' }];
  if (sdb.getProfile(user.id).ackVersion !== SUPP_ACK_VERSION) return [409, { error: 'supplements_ack_required' }];
  if (adultOf(user.id) === 'minor') return [403, { error: 'supplements_minor' }];
  return null;
}

// Toma de un item o fuente de cafeína, con la comida si es proteína. La usa también sync.js.
export function applyLog(userId, body) {
  const now = clock();
  const item = body?.itemId ? sdb.getItem(userId, String(body.itemId)) : null;
  const v = validateLog(body, { today: now.date, item });
  if (v.error) return { error: v.error };
  const existing = sdb.getLog(userId, v.value.id);
  if (existing) return { log: existing };
  let comidaId = null;
  if (item?.catalogId === 'proteina' && v.value.amount > 0) {
    const m = proteinMeal({ item, amount: v.value.amount, date: v.value.date, today: now.date, time: now.time });
    comidaId = Number(getDatabase().prepare(`INSERT INTO comidas_registradas (user_id, fecha, franja, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, m.fecha, m.franja, m.nombre_alimento, m.cantidad_gramos, m.calorias, m.proteina, m.carbohidratos, m.grasas).lastInsertRowid);
  }
  return { log: sdb.addLog(userId, { ...v.value, comidaId }) };
}

export function supplementRoutes(d) {
  const { json, readBody } = d;
  const member = (req, res) => {
    const user = d.readSession(req);
    if (!user) { json(res, 401, { error: 'No has iniciado sesión' }); return null; }
    if (!supplementsOn()) { json(res, 404, { error: 'supplements_off' }); return null; }
    return user;
  };
  const writer = (req, res) => {
    const user = member(req, res); if (!user) return null;
    const g = writeGuard(user);
    if (g) { json(res, g[0], g[1]); return null; }
    return user;
  };
  return {
    'GET /api/supplements': async (req, res) => {
      const user = member(req, res); if (!user) return;
      const today = clock().date;
      const p = sdb.getProfile(user.id);
      json(res, 200, { enabled: true, ackVersion: SUPP_ACK_VERSION, profile: { ackVersion: p.ackVersion, adult: p.adult }, adult: adultOf(user.id), today,
        items: sdb.listItems(user.id), logs: sdb.listLogs(user.id, addDays(today, -400)) });
    },
    'POST /api/supplements/ack': async (req, res) => {
      const user = member(req, res); if (!user) return;
      const body = await readBody(req);
      if (body.version !== SUPP_ACK_VERSION) return json(res, 409, { error: 'ack_version_changed', version: SUPP_ACK_VERSION });
      sdb.setAck(user.id, SUPP_ACK_VERSION, typeof body.adult === 'boolean' ? (body.adult ? 1 : 0) : null);
      json(res, 200, { ok: true });
    },
    'POST /api/supplements/items': async (req, res) => {
      const user = writer(req, res); if (!user) return;
      const v = validateItem(await readBody(req));
      if (v.error) return json(res, 400, { error: v.error });
      json(res, 200, { item: sdb.saveItem(user.id, v.value) });
    },
    'POST /api/supplements/items/archive': async (req, res) => {
      const user = writer(req, res); if (!user) return;
      const body = await readBody(req);
      if (!sdb.setItemStatus(user.id, String(body.id || ''), body.archived ? 'archived' : 'active')) return json(res, 404, { error: 'not_found' });
      json(res, 200, { item: sdb.getItem(user.id, String(body.id)) });
    },
    'POST /api/supplements/items/delete': async (req, res) => {
      const user = writer(req, res); if (!user) return;
      const body = await readBody(req);
      if (!sdb.deleteItem(user.id, String(body.id || ''))) return json(res, 404, { error: 'not_found' });
      json(res, 200, { ok: true });
    },
    'POST /api/supplements/log': async (req, res) => {
      const user = writer(req, res); if (!user) return;
      const out = applyLog(user.id, await readBody(req));
      if (out.error) return json(res, 400, { error: out.error });
      json(res, 200, { log: out.log });
    },
    'POST /api/supplements/log/delete': async (req, res) => {
      const user = writer(req, res); if (!user) return;
      const body = await readBody(req);
      if (!sdb.deleteLog(user.id, String(body.id || ''))) return json(res, 404, { error: 'not_found' });
      json(res, 200, { ok: true });
    },
    'GET /api/owner/supplements': async (req, res) => {
      const owner = d.requireOwner(req, res); if (!owner) return;
      json(res, 200, { enabled: supplementsOn() });
    },
    'PUT /api/owner/supplements': async (req, res) => {
      const owner = d.requireOwner(req, res); if (!owner) return;
      const body = await readBody(req);
      if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled debe ser true o false' });
      setAdminSetting(SUPPLEMENTS_SETTING, body.enabled ? '1' : '0');
      d.audit(req, body.enabled ? 'owner.supplements.enabled' : 'owner.supplements.disabled', { user: owner });
      json(res, 200, { enabled: body.enabled });
    },
  };
}

// Recordatorios: por item con hora, en la zona del socio (reminder_settings.tz o la del gimnasio),
// solo si toca, falta tomarlo y no se mandó hoy. Socios sin consentimiento, sin aviso, menores o
// desactivados no reciben nada. sendSupplementReminders es sincrónica: `send` no se espera.
export function sendSupplementReminders({ send, nowMs = Date.now() }) {
  if (!supplementsOn()) return;
  const db = getDatabase();
  const byUser = new Map();
  for (const item of sdb.itemsWithReminders()) (byUser.get(item.userId) || byUser.set(item.userId, []).get(item.userId)).push(item);
  for (const [userId, items] of byUser) {
    const u = db.prepare('SELECT u.disabled, u.health_consent, rs.tz FROM users u LEFT JOIN reminder_settings rs ON rs.user_id = u.id WHERE u.id = ?').get(userId);
    if (!u || u.disabled || u.health_consent === 'declined') continue;
    if (writeGuard({ id: userId })) continue;
    const local = clock(nowMs, u.tz || gymTz());
    const profile = sdb.getProfile(userId);
    const logs = sdb.listLogs(userId, local.date).filter(l => l.date === local.date);
    let state = null;
    for (const item of items) {
      const taken = logs.filter(l => l.itemId === item.id).length;
      const due = { item, localDate: local.date, localTime: local.time, lastSent: profile.lastReminderSent[item.id] || null, taken };
      // Primero lo barato (hora, ya enviado, ya tomado); el estado del socio solo si hace falta saber
      // si hoy entrena.
      if (!reminderDue({ ...due, trainingDay: true })) continue;
      if (item.days === 'training') {
        state = state || getUserState(userId) || {};
        if (!isTrainingDay(state, local.date)) continue;
      }
      sdb.markReminderSent(userId, item.id, local.date);
      send(userId, supplementReminderPush({ name: item.name, catalogId: item.catalogId, dose: item.dose, unit: item.unit, doses: item.doses }));
    }
  }
}

// Igual que el cliente (frontend/src/lib/suplementos.js, isTrainingDay): rutina del plan o un workout ese día.
function isTrainingDay(state, date) {
  const ov = state?.dayPlan?.[date];
  if (ov === 'rest' || (ov && typeof ov === 'object' && ['descanso', 'completado'].includes(ov.estado))) return (state.workouts || []).some(w => w.d === date);
  const planned = (ov && typeof ov === 'object' && ov.estado === 'rutina' && ov.rutinaId) || (typeof ov === 'string' && ov)
    || state?.week?.[new Date(`${date}T12:00:00`).getDay()] || null;
  return !!planned || (state?.workouts || []).some(w => w.d === date);
}
