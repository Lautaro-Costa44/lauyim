// Reglas de suplementos del lado del servidor (docs/superpowers/specs/2026-10-09-suplementos-design.md):
// validación de items y tomas, ventana de fechas, la comida que crea una toma de proteína y cuándo
// toca un recordatorio. El catálogo con el contenido vive en el cliente (frontend/src/lib/suplementos-data.js);
// acá solo los ids seguibles.
import { addDays } from './classes.js';

export const SUPP_ACK_VERSION = '2026-10-09';
export const SLOTS = ['morning', 'pre', 'post', 'meals', 'night', 'any'];
export const DAYS = ['daily', 'training'];
export const UNITS = ['g', 'mg', 'ml', 'caps', 'ui', 'dosis'];
export const CAFFEINE_SOURCES = ['mate', 'cafe', 'espresso', 'energizante', 'capsula', 'preentreno', 'otro'];
export const CATALOG_IDS = ['creatina', 'cafeina', 'betaalanina', 'proteina', 'electrolitos', 'colageno', 'vitaminad', 'hierro', 'omega3', 'magnesio', 'multivitaminico'];
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;

export const supplementsEnabled = value => value !== '0';

export function validateItem(b) {
  if (!b || typeof b !== 'object') return { error: 'Datos inválidos' };
  if (!ID.test(String(b.id || ''))) return { error: 'id inválido' };
  const catalogId = b.catalogId ?? null;
  if (catalogId !== null && !CATALOG_IDS.includes(catalogId)) return { error: 'Ese suplemento no se puede seguir' };
  const name = catalogId ? null : String(b.name || '').trim();
  if (!catalogId && (!name || name.length > 40)) return { error: 'Poné un nombre (máx. 40 caracteres)' };
  if (b.dose != null && !num(b.dose, 100000)) return { error: 'Dosis inválida' };
  if (b.unit != null && !UNITS.includes(b.unit)) return { error: 'Unidad inválida' };
  if (b.scoopG != null && !num(b.scoopG, 200)) return { error: 'Scoop inválido' };
  const doses = b.doses ?? 1;
  if (!Number.isInteger(doses) || doses < 1 || doses > 6) return { error: 'Las dosis van de 1 a 6' };
  if (!SLOTS.includes(b.slot || 'any')) return { error: 'Momento inválido' };
  if (!DAYS.includes(b.days || 'daily')) return { error: 'Días inválidos' };
  // Un recordatorio por dosis como máximo: lista de horas HH:MM, ordenada y sin repetir.
  const times = b.reminderTimes ?? [];
  if (!Array.isArray(times) || times.length > doses || !times.every(x => HHMM.test(x))) return { error: 'Hora inválida' };
  const reminderTimes = [...new Set(times)].sort();
  let meta = null;
  if (b.meta != null) {
    const m = b.meta.macros, mg = b.meta.mgPerScoop;
    if (m && !['proteina', 'calorias', 'carbos', 'grasas'].every(k => num(m[k], 2000))) return { error: 'Valores por scoop inválidos' };
    if (mg != null && !num(mg, 1000)) return { error: 'mg por scoop inválidos' };
    meta = { ...(m ? { macros: { proteina: m.proteina, calorias: m.calorias, carbos: m.carbos, grasas: m.grasas } } : {}), ...(mg != null ? { mgPerScoop: mg } : {}) };
  }
  return { value: { id: b.id, catalogId, name, dose: b.dose ?? null, unit: b.unit ?? null, scoopG: b.scoopG ?? null, doses, slot: b.slot || 'any', days: b.days || 'daily', reminderTimes, meta } };
}

export const logDateOk = (date, today) => DATE.test(date || '') && date <= addDays(today, 1) && date >= addDays(today, -8);

export function validateLog(b, { today, item }) {
  if (!b || typeof b !== 'object' || !ID.test(String(b.id || ''))) return { error: 'id inválido' };
  if (!logDateOk(b.date, today)) return { error: 'Solo hoy y hasta 7 días atrás' };
  const source = b.source ?? null;
  if (source === null) {
    if (!item || item.id !== b.itemId) return { error: 'Ese suplemento no existe' };
  } else if (!CAFFEINE_SOURCES.includes(source)) return { error: 'Fuente inválida' };
  if (!num(b.amount ?? 0, source ? 1000 : 100000)) return { error: 'Cantidad inválida' };
  return { value: { id: b.id, itemId: source ? null : b.itemId, date: b.date, source, amount: b.amount ?? 0 } };
}

const DEFAULT_SCOOP = 30, DEFAULT_MACROS = { proteina: 24, calorias: 120, carbos: 3, grasas: 1.5 };
const r1 = n => Math.round(n * 10) / 10;
const franjaOf = (date, today, time) => date !== today ? 'extra' : time < '11:00' ? 'desayuno' : time < '15:00' ? 'almuerzo' : time < '19:00' ? 'merienda' : 'cena';
export function proteinMeal({ item, amount, date, today, time }) {
  const scoop = item.scoopG > 0 ? item.scoopG : DEFAULT_SCOOP;
  const m = item.meta?.macros || DEFAULT_MACROS;
  const k = amount / scoop;
  return { fecha: date, franja: franjaOf(date, today, time), nombre_alimento: 'Proteína en polvo', cantidad_gramos: amount,
    calorias: r1(m.calorias * k), proteina: r1(m.proteina * k), carbohidratos: r1(m.carbos * k), grasas: r1(m.grasas * k) };
}

const minutes = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
// El recordatorio de la dosis `index` (0 = la primera; las horas van ordenadas) a la hora `time`: toca
// si ese día todavía no se marcaron index + 1 dosis. createdDate: el día local del alta (created_at se
// guarda en UTC); sin él, la fecha UTC. lastSent: el último día en que salió este recordatorio.
export function reminderDue({ item, time, index = 0, localDate, localTime, lastSent, taken, trainingDay, createdDate }) {
  if (item.status !== 'active' || !time || lastSent === localDate) return false;
  if (localDate < (createdDate || String(item.createdAt || '').slice(0, 10))) return false;
  if (item.days === 'training' && !trainingDay) return false;
  if (taken > index || taken >= Math.max(1, item.doses || 1)) return false;
  const diff = minutes(localTime) - minutes(time);
  return diff >= 0 && diff < 5;
}
