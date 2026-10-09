// Rutas de cierres del gimnasio (docs/superpowers/specs/2026-10-09-cierres-gym-design.md). server.js
// las suma con closureRoutes({ ... }) y le pasa lo suyo (sesión, permisos, auditoría, push). El
// scheduler usa sendPendingAnnouncements. La lógica está en closures.js y los datos en closures-db.js.
import { closureDays, validateClosure, closureOptions, announceAtFor, extensionTargets } from './closures.js';
import * as kdb from './closures-db.js';
import * as cdb from './classes-db.js';
import { addDays } from './classes.js';
import { getAdminSetting, getDatabase, getAllMemberBilling } from './database.js';
import { gymClock, getBillingSettings, isBillingEnabled } from './billing.js';
import { closurePush, closureAnnouncePush, closureReopenPush } from './push-messages.js';
import { classSettingsNow, closureImpact } from './classes-routes.js';

export const CLOSURE_NOTIFY_HOUR_SETTING = 'closure_notify_hour';
export const DEFAULT_CLOSURE_NOTIFY_HOUR = '08:00';
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const closureNotifyHour = () => { const v = getAdminSetting(CLOSURE_NOTIFY_HOUR_SETTING); return HH_MM.test(v || '') ? v : DEFAULT_CLOSURE_NOTIFY_HOUR; };

const gymTzNow = () => getBillingSettings(getDatabase()).gym_tz;
const todayNow = (ms = Date.now()) => gymClock(ms, gymTzNow()).date;
// Textos del registro de actividad: "lun 12/10", "mié 24/12 al vie 2/1".
const AUDIT_DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const auditDay = date => `${AUDIT_DAYS[new Date(date + 'T12:00:00Z').getUTCDay()]} ${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`;
const auditRange = ({ from, to }) => auditDay(from) + (to !== from ? ' al ' + auditDay(to) : '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// El aviso general: a todos los activos con push, menos los que ya recibieron el de su reserva.
export function sendAnnouncement(closure, { send, today }) {
  const ids = kdb.announcementRecipients(closure.notifiedIds);
  const payload = closureAnnouncePush({ ...closure, today });
  for (const id of ids) send(id, payload);
  return ids.length;
}

// Tick del scheduler: los avisos que ya tocan. Se marcan antes de enviar (un tick lento no repite).
export function sendPendingAnnouncements({ send, nowMs = Date.now() }) {
  const today = todayNow(nowMs);
  for (const closure of kdb.pendingAnnouncements(nowMs, today)) {
    if (kdb.markAnnounced(closure.id, nowMs)) sendAnnouncement(closure, { send, today });
  }
}

export function closureRoutes(d) {
  const { json, readBody } = d;
  const classesOn = () => classSettingsNow().enabled;
  const noImpact = () => ({ occs: [], people: new Map() });
  // Correr vencimientos toca las cuotas: cuotas prendido y permiso de cuotas (el owner tiene todo).
  const canExtend = user => isBillingEnabled(getDatabase()) && d.can(user, 'fees.manage');
  const targetsFor = today => extensionTargets(getAllMemberBilling(), today, getBillingSettings(getDatabase()),
    r => d.isFeeExempt({ id: r.userId, owner: r.owner ? 1 : 0, role_id: r.roleId }));
  const send = (uid, payload) => { Promise.resolve(d.sendPush(uid, payload)).catch(() => {}); };
  const adminView = c => {
    const ext = kdb.getExtensions({ closureId: c.id });
    return {
      id: c.id, from: c.from, to: c.to, reason: c.reason, notifyAll: c.notifyAll, announceAt: c.announceAt, announcedAt: c.announcedAt,
      notified: c.notifiedIds.length, extendDays: c.extendDays, extended: ext.filter(e => !e.revertedAt).length
    };
  };

  return {
  // Socio: todos los cierres (la racha mira semanas pasadas), solo lo público. Sin módulo de clases también.
  'GET /api/closures': async (req, res) => {
    const user = d.readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    json(res, 200, { today: todayNow(), closures: kdb.getClosures().map(c => ({ id: c.id, from: c.from, to: c.to, reason: c.reason })) });
  },

  // Staff: en curso, futuros y los de la última semana (la tarjeta muestra en curso y futuros).
  'GET /api/admin/closures': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const today = todayNow();
    json(res, 200, { today, closures: kdb.getClosures().filter(c => c.to >= addDays(today, -7)).map(adminView) });
  },

  'GET /api/admin/closures/preview': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const q = new URL(req.url, 'http://x').searchParams;
    const today = todayNow();
    const v = validateClosure({ from: q.get('from'), to: q.get('to') }, { today });
    if (v.error) return json(res, 400, v);
    const impact = classesOn() ? closureImpact(v.value) : noImpact();
    const out = {
      days: closureDays(v.value), classes: impact.occs.length, booked: impact.people.size,
      appMembers: kdb.announcementRecipients([...impact.people.keys()]).length,
      announceAt: announceAtFor({ from: v.value.from, nowMs: Date.now(), notifyHour: closureNotifyHour(), tz: gymTzNow() })
    };
    if (canExtend(user)) {
      const targets = targetsFor(today);
      out.extend = { members: targets.filter(t => t.field === 'due').length, trials: targets.filter(t => t.field === 'trial').length };
    }
    json(res, 200, out);
  },

  'POST /api/admin/closures': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const body = await readBody(req);
    const nowMs = Date.now();
    const today = todayNow(nowMs);
    const v = validateClosure(body, { today, existing: kdb.getClosures() });
    if (v.error) return json(res, v.error === 'closure_overlap' ? 409 : 400, v);
    const o = closureOptions(body, { days: closureDays(v.value) });
    if (o.error) return json(res, 400, o);
    if (o.value.extendDays && !canExtend(user)) return json(res, 403, { error: 'forbidden' });
    const impact = classesOn() ? closureImpact(v.value) : noImpact();
    // Las reservas se cancelan (sin promover a nadie); las fechas no se suspenden una por una: al
    // reabrir, vuelven.
    for (const occ of impact.occs) if (occ.sessionId) cdb.cancelSessionBookings(occ.sessionId);
    const announceAt = o.value.notifyAll ? announceAtFor({ from: v.value.from, nowMs, notifyHour: closureNotifyHour(), tz: gymTzNow() }) : null;
    const closure = kdb.addClosure({ ...v.value, createdBy: user.id, notifyAll: o.value.notifyAll, announceAt, notifiedIds: [...impact.people.keys()], extendDays: o.value.extendDays });
    const extended = o.value.extendDays ? kdb.applyExtensions(closure.id, targetsFor(today), o.value.extendDays, nowMs) : 0;
    for (const [uid, items] of impact.people) {
      send(uid, closurePush({ ...v.value, today, items: items.map(x => ({ name: x.type.name, start: x.start, date: x.date })) }));
    }
    if (announceAt != null && announceAt <= nowMs && kdb.markAnnounced(closure.id, nowMs)) sendAnnouncement(closure, { send, today });
    const parts = [plural(impact.occs.length, 'clase', 'clases'), `${impact.people.size} con reserva`];
    if (o.value.notifyAll) parts.push('aviso a todos');
    if (extended) parts.push(`vencimientos +${plural(o.value.extendDays, 'día', 'días')} a ${plural(extended, 'socio', 'socios')}`);
    d.audit(req, 'gym.closure.add', { user, msg: `${auditRange(v.value)}${v.value.reason ? ' · ' + v.value.reason : ''}: ${parts.join(', ')}` });
    json(res, 200, { closure: adminView(kdb.getClosure(closure.id)), notified: impact.people.size, classes: impact.occs.length, extended, announceAt });
  },

  // Reabrir: devuelve los días corridos (si se pide), cancela el aviso pendiente (se borra el cierre)
  // y, si ya se había avisado y era de hoy o mañana, avisa que al final abre.
  'POST /api/admin/closures/delete': async (req, res) => {
    const user = d.requireAdmin(req, res); if (!user) return;
    const { id, revert = true } = await readBody(req);
    const closure = kdb.getClosure(id);
    if (!closure) return json(res, 404, { error: 'not_found' });
    const open = kdb.getExtensions({ closureId: id }).filter(e => !e.revertedAt);
    if (open.length && revert && !canExtend(user)) return json(res, 403, { error: 'forbidden' });
    const reverted = open.length && revert ? kdb.revertExtensions(id) : 0;
    const today = todayNow();
    const told = closure.announcedAt ? kdb.announcementRecipients([]) : closure.notifiedIds;
    if (told.length && closure.from <= addDays(today, 1) && closure.to >= today) {
      const payload = closureReopenPush({ from: closure.from < today ? today : closure.from, today });
      for (const uid of told) send(uid, payload);
    }
    kdb.deleteClosure(id);
    d.audit(req, 'gym.closure.delete', { user, msg: auditRange(closure) + (closure.reason ? ' · ' + closure.reason : '') + (reverted ? ` · vencimientos devueltos a ${plural(reverted, 'socio', 'socios')}` : '') });
    json(res, 200, { ok: true, reverted });
  }
  };
}
