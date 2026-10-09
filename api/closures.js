// Cierres del gimnasio (docs/superpowers/specs/2026-10-09-cierres-gym-design.md): lo puro. Validar
// fechas y opciones, cuándo sale el aviso general, a quién se le corre el vencimiento y cuántos días
// suma una extensión al anular un pago. Los datos están en closures-db.js; las rutas, en closures-routes.js.
import { addDays, zonedToEpoch } from './classes.js';
import { gymClock, billingStatus } from './billing.js';

export const CLOSURE_MAX_DAYS = 31;
const dayNumber = date => Date.parse(date + 'T00:00:00Z') / 86400000;
const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));

export const closureDays = ({ from, to }) => dayNumber(to) - dayNumber(from) + 1;

// Un cierre: de hoy en adelante, de 1 a 31 días, sin pisar otro y con un motivo corto.
export function validateClosure(body, { today, existing = [] } = {}) {
  const from = body?.from, to = body?.to || body?.from;
  if (!isDay(from) || from < today) return { error: 'validation_error', field: 'from', message: 'Elegí una fecha de hoy en adelante' };
  if (!isDay(to) || to < from) return { error: 'validation_error', field: 'to', message: 'La fecha final tiene que ser igual o posterior' };
  if (closureDays({ from, to }) > CLOSURE_MAX_DAYS) return { error: 'validation_error', field: 'to', message: `Un cierre dura hasta ${CLOSURE_MAX_DAYS} días` };
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length > 40) return { error: 'validation_error', field: 'reason', message: 'El motivo admite hasta 40 letras' };
  if (existing.some(c => c.from <= to && from <= c.to)) return { error: 'closure_overlap', message: 'Ya hay un cierre en esos días' };
  return { value: { from, to, reason } };
}

// Avisar a todos (prendido salvo false explícito) y cuántos días correr los vencimientos (0 a días cerrados).
export function closureOptions(body, { days }) {
  const extendDays = body?.extendDays == null ? 0 : body.extendDays;
  if (!Number.isInteger(extendDays) || extendDays < 0 || extendDays > days) {
    return { error: 'validation_error', field: 'extendDays', message: `Los días a correr van de 0 a ${days}` };
  }
  return { value: { notifyAll: body?.notifyAll !== false, extendDays } };
}

// El aviso general sale la próxima vez que el reloj del gimnasio marque `notifyHour`. Si ese día ya
// es posterior al primero del cierre (un cierre para hoy creado después de la hora), sale ahora.
export function announceAtFor({ from, nowMs, notifyHour, tz }) {
  const clock = gymClock(nowMs, tz);
  const day = clock.time < notifyHour ? clock.date : addDays(clock.date, 1);
  if (day > from) return nowMs;
  return zonedToEpoch(day, notifyHour, tz);
}

// A quiénes se les corre la fecha: activos, no exentos, al día o por vencer (el vencimiento) o en
// prueba vigente (la prueba). Los vencidos y bloqueados ya debían antes del cierre.
// rows: getAllMemberBilling() (userId, planId, dueDate, trialUntil, disabled, pending).
export function extensionTargets(rows, today, settings, isExempt = () => false) {
  const out = [];
  for (const r of rows || []) {
    if (r.disabled || r.pending || isExempt(r)) continue;
    const status = billingStatus({ planId: r.planId, dueDate: r.dueDate, trialUntil: r.trialUntil }, today, settings);
    if (status === 'prueba') out.push({ userId: r.userId, field: 'trial', before: r.trialUntil });
    else if ((status === 'al_dia' || status === 'por_vencer') && r.dueDate) out.push({ userId: r.userId, field: 'due', before: r.dueDate });
  }
  return out;
}

// Días de vencimiento corridos por cierres después de `sinceMs` (un pago) y no devueltos.
export const extensionDaysSince = (extensions, sinceMs) => (extensions || [])
  .filter(e => e.field === 'due' && !e.revertedAt && e.appliedAt > sinceMs)
  .reduce((sum, e) => sum + e.days, 0);
