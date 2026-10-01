// Licencia mensual de la instancia, alineada con el contrato (cláusula Quinta): el abono de cada
// mes vence el día LICENSE_DUE_DAY (10); desde el día siguiente hay mora, y después de
// LICENSE_SUSPEND_AFTER_DAYS días de mora (15) el servicio se suspende. LICENSE_PAID_UNTIL es el
// último mes pagado (AAAA-MM): renovar es pasarlo al mes siguiente. Sin esa variable no hay
// control mensual (LICENSE_EXPIRES_AT sigue siendo un corte fijo aparte).
//
// Estados: ok | due (el mes siguiente al pagado, hasta el vencimiento) | overdue (en mora) |
// suspended. Las fechas son del gym (AAAA-MM-DD en su zona horaria).
import { addDays } from './billing.js';

const DEFAULT_DUE_DAY = 10;
const DEFAULT_SUSPEND_AFTER_DAYS = 15;

function intIn(raw, min, max) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { value: null };
  const n = Number(String(raw).trim());
  return Number.isInteger(n) && n >= min && n <= max ? { value: n } : { error: true };
}

// env → { config: { paidUntil, dueDay, suspendAfterDays } | null, errors: [texto] }. Un valor mal
// escrito nunca corta el servicio: se usa el valor por defecto (o no hay control) y se informa.
export function parseLicenseConfig(env = process.env) {
  const errors = [];
  const raw = String(env.LICENSE_PAID_UNTIL || '').trim();
  if (!raw) return { config: null, errors };
  const m = raw.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!m) return { config: null, errors: [`LICENSE_PAID_UNTIL='${raw}' no es un mes AAAA-MM: sin control mensual de la licencia.`] };
  const due = intIn(env.LICENSE_DUE_DAY, 1, 31);
  if (due.error) errors.push(`LICENSE_DUE_DAY='${env.LICENSE_DUE_DAY}' tiene que ser un día entre 1 y 31: se usa ${DEFAULT_DUE_DAY}.`);
  const after = intIn(env.LICENSE_SUSPEND_AFTER_DAYS, 0, 365);
  if (after.error) errors.push(`LICENSE_SUSPEND_AFTER_DAYS='${env.LICENSE_SUSPEND_AFTER_DAYS}' tiene que ser un entero entre 0 y 365: se usa ${DEFAULT_SUSPEND_AFTER_DAYS}.`);
  return {
    config: {
      paidUntil: { year: Number(m[1]), month: Number(m[2]) },
      dueDay: due.value ?? DEFAULT_DUE_DAY,
      suspendAfterDays: after.value ?? DEFAULT_SUSPEND_AFTER_DAYS
    },
    errors
  };
}

const pad = n => String(n).padStart(2, '0');
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// config (de parseLicenseConfig) + hoy del gym (AAAA-MM-DD) → { status, month?, dueDate?, suspendDate? }.
export function licenseState(config, today) {
  if (!config) return { status: 'ok' };
  const { year, month } = config.paidUntil;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const unpaid = `${nextYear}-${pad(nextMonth)}`;
  const monthStart = `${unpaid}-01`;
  const dueDate = `${unpaid}-${pad(Math.min(config.dueDay, daysInMonth(nextYear, nextMonth)))}`;
  const suspendDate = addDays(dueDate, config.suspendAfterDays + 1);
  if (today < monthStart) return { status: 'ok' };
  const status = today <= dueDate ? 'due' : today < suspendDate ? 'overdue' : 'suspended';
  return { status, month: unpaid, dueDate, suspendDate };
}
