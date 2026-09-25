/**
 * Cuotas v1: reglas puras de vencimiento, estado y deuda de un socio.
 *
 * Todo trabaja sobre fechas de calendario 'YYYY-MM-DD' en la zona horaria del gym. La
 * aritmética se hace en días UTC (Date.UTC), así que el resultado no depende de la tz del
 * servidor ni de cambios de horario. "Hoy" se calcula una sola vez por quien llama (API o
 * scheduler) con gymToday() y se pasa por parámetro: nada acá lee el reloj por su cuenta,
 * lo que también deja los tests sin mocks de tiempo.
 *
 * Únicas excepciones a "sin I/O": getBillingSettings(db), isBillingEnabled(db) y
 * getBillingNotifyHour(db), que leen admin_settings.
 */

export const BILLING_STATUSES = ['al_dia', 'por_vencer', 'vencido', 'bloqueado', 'sin_plan', 'prueba'];
export const PAYMENT_METHODS = ['efectivo', 'transferencia', 'otro'];

export const BILLING_DEFAULTS = Object.freeze({
  due_soon_days: 5,
  push_days_before: 3,
  grace_days: 5,
  trial_days: 1,
  payment_methods: PAYMENT_METHODS,
  gym_tz: 'America/Argentina/Buenos_Aires'
});
// Rango válido de cada ajuste entero. Una prueba dura al menos un día (el de hoy).
const INT_RANGES = { due_soon_days: [0, 30], push_days_before: [0, 30], grace_days: [0, 30], trial_days: [1, 30] };
const INT_SETTINGS = Object.keys(INT_RANGES);
export const BILLING_SETTING_KEYS = [...INT_SETTINGS, 'payment_methods', 'gym_tz'];

/* ---------- fechas YYYY-MM-DD ---------- */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

// Días desde epoch de una fecha de calendario; null si no es una fecha real (2026-02-30).
function epochDay(iso) {
  const m = ISO_DATE.exec(String(iso || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms / DAY_MS;
}

export const isIsoDate = iso => epochDay(iso) !== null;

export function addDays(iso, days) {
  const base = epochDay(iso);
  if (base === null) throw new Error('fecha inválida: ' + iso);
  return new Date((base + days) * DAY_MS).toISOString().slice(0, 10);
}

// b - a en días.
export function daysBetween(a, b) {
  const da = epochDay(a), db = epochDay(b);
  if (da === null || db === null) throw new Error('fecha inválida');
  return db - da;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// Fecha y hora locales del gym. Una tz inválida cae a UTC en vez de tirar: el scheduler no
// puede caerse por un ajuste mal cargado (igual que getLocalParts en scheduler.js).
export function gymClock(now = Date.now(), tz = BILLING_DEFAULTS.gym_tz) {
  const zone = isValidTimeZone(tz) ? tz : 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date(now));
  const g = type => parts.find(p => p.type === type)?.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

export const gymToday = (now = Date.now(), tz = BILLING_DEFAULTS.gym_tz) => gymClock(now, tz).date;

/* ---------- ajustes ---------- */

// Valida un parche de ajustes. Devuelve { value } con solo las claves recibidas, o { error }.
export function validateBillingSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Ajustes inválidos' };
  const value = {};
  for (const key of INT_SETTINGS) {
    if (input[key] === undefined) continue;
    const n = input[key];
    const [min, max] = INT_RANGES[key];
    if (!Number.isInteger(n) || n < min || n > max) return { error: `${key} debe ser un entero entre ${min} y ${max}` };
    value[key] = n;
  }
  if (input.payment_methods !== undefined) {
    const list = input.payment_methods;
    if (!Array.isArray(list) || !list.length || list.some(m => !PAYMENT_METHODS.includes(m))) {
      return { error: `payment_methods debe ser una lista no vacía de: ${PAYMENT_METHODS.join(', ')}` };
    }
    // Sin duplicados y en el orden canónico, para que el valor guardado sea estable.
    value.payment_methods = PAYMENT_METHODS.filter(m => list.includes(m));
  }
  if (input.gym_tz !== undefined) {
    if (!isValidTimeZone(input.gym_tz)) return { error: 'gym_tz debe ser una zona horaria IANA válida' };
    value.gym_tz = input.gym_tz;
  }
  return { value };
}

// Forma en que cada ajuste se guarda en admin_settings.value (siempre TEXT).
export function serializeBillingSetting(key, value) {
  return key === 'payment_methods' ? JSON.stringify(value) : String(value);
}

// Lee los ajustes de cuotas de admin_settings. Un valor ausente o corrupto cae a su default,
// uno por uno: un ajuste roto no invalida los demás.
export function getBillingSettings(db) {
  const rows = db.prepare(`SELECT key, value FROM admin_settings WHERE key IN (${BILLING_SETTING_KEYS.map(() => '?').join(', ')})`)
    .all(...BILLING_SETTING_KEYS);
  const settings = { ...BILLING_DEFAULTS, payment_methods: [...BILLING_DEFAULTS.payment_methods] };
  for (const { key, value } of rows) {
    let parsed;
    if (INT_SETTINGS.includes(key)) parsed = Number(value);
    else if (key === 'payment_methods') { try { parsed = JSON.parse(value); } catch { continue; } }
    else parsed = value;
    const checked = validateBillingSettings({ [key]: parsed });
    if (!checked.error) Object.assign(settings, checked.value);
  }
  return settings;
}

/* ---------- interruptor de cuotas y horario de avisos ---------- */
// Fuera de BILLING_SETTING_KEYS a propósito: no los toca PUT /api/admin/billing/settings.
// billing_enabled lo cambia solo el owner; billing_notify_hour sirve también sin cuotas
// (el recordatorio manual del socio sale a esa hora).

export const BILLING_ENABLED_SETTING = 'billing_enabled';
export const BILLING_NOTIFY_HOUR_SETTING = 'billing_notify_hour';
export const DEFAULT_BILLING_NOTIFY_HOUR = '12:00';

// Encendido salvo que se haya apagado explícitamente: las instancias que ya usaban cuotas
// (sin la clave guardada) siguen encendidas.
export function isBillingEnabled(db) {
  const row = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get(BILLING_ENABLED_SETTING);
  return row?.value !== '0';
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isValidNotifyHour = value => typeof value === 'string' && HH_MM.test(value);

// Un valor corrupto cae al default en vez de dejar de mandar avisos.
export function getBillingNotifyHour(db) {
  const row = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get(BILLING_NOTIFY_HOUR_SETTING);
  return isValidNotifyHour(row?.value) ? row.value : DEFAULT_BILLING_NOTIFY_HOUR;
}

/* ---------- estado, vencimiento y deuda ---------- */

// Prueba (trialUntil): hasta ese día inclusive está 'prueba'; después, 'bloqueado' en el acto,
// sin tolerancia. Un pago la cierra (trial_until = NULL), así que una prueba guardada siempre
// es "sin pago posterior". Manda sobre el plan: quien la empieza no tiene plan vigente.
export function billingStatus({ planId, dueDate, trialUntil } = {}, today, settings = BILLING_DEFAULTS) {
  if (isIsoDate(trialUntil)) return daysBetween(today, trialUntil) >= 0 ? 'prueba' : 'bloqueado';
  if (planId == null) return 'sin_plan';
  // Un plan sin vencimiento no debería existir (la API lo exige). Si aparece, no se bloquea
  // a nadie por un dato faltante.
  if (!isIsoDate(dueDate)) return 'al_dia';
  const late = daysBetween(dueDate, today);           // días pasados desde el vencimiento
  if (late > settings.grace_days) return 'bloqueado';
  if (late > 0) return 'vencido';
  if (-late <= settings.due_soon_days) return 'por_vencer';
  return 'al_dia';
}

// Nuevo vencimiento al registrar un pago de `durationDays`. Quien paga en término o dentro
// de la tolerancia conserva su fecha (el período arranca en su vencimiento actual); quien ya
// estaba bloqueado, o no tenía vencimiento, arranca un período nuevo hoy.
// period_end es el nuevo vencimiento: el día en que vuelve a deber.
export function nextDueDate(currentDue, today, durationDays, graceDays) {
  const keepsDate = isIsoDate(currentDue) && daysBetween(currentDue, today) <= graceDays;
  const periodStart = keepsDate ? currentDue : today;
  const dueDate = addDays(periodStart, durationDays);
  return { dueDate, periodStart, periodEnd: dueDate };
}

// Siempre un período por socio: no se acumulan cuotas impagas.
export const debtFor = (status, planPrice) =>
  (status === 'vencido' || status === 'bloqueado') ? Math.max(0, Math.trunc(Number(planPrice) || 0)) : 0;

// Deuda del socio: una prueba (en curso o vencida) no deja deuda.
export const memberDebt = (billing, status) => isIsoDate(billing?.trialUntil) ? 0 : debtFor(status, billing?.planPrice);

// Bloqueado porque terminó la prueba (no por una cuota vencida).
export const isTrialEnded = (billing, status) => status === 'bloqueado' && isIsoDate(billing?.trialUntil);

// Último día de una prueba de `trialDays` que empieza hoy: 1 día = solo hoy.
export const trialEndDate = (today, trialDays) => addDays(today, Math.max(1, trialDays) - 1);

// Plan vigente = asignado y todavía no bloqueado. Sin eso se puede empezar una prueba.
export const hasActivePlan = (billing, today, settings = BILLING_DEFAULTS) =>
  billing?.planId != null && billingStatus({ ...billing, trialUntil: null }, today, settings) !== 'bloqueado';

export const debtTotal = members => members.reduce((sum, m) => sum + (Number(m.debt) || 0), 0);

export function shouldSendDuePush({ planId, dueDate, pushSentForDue } = {}, today, settings = BILLING_DEFAULTS) {
  if (planId == null || !isIsoDate(dueDate)) return false;
  const left = daysBetween(today, dueDate);
  return left >= 0 && left <= settings.push_days_before && pushSentForDue !== dueDate;
}
