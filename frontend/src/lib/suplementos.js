// Lógica pura de suplementos (docs/superpowers/specs/2026-10-09-suplementos-design.md): qué toca
// cada día, racha, cumplimiento, niveles del heatmap, cafeína del día y etiquetas de dosis.
import { fichaById, SLOTS, UNITS } from './suplementos-data.js'
import { effectiveRoutineId } from './history.js'
import { isoOf } from './format.js'

const dayNum = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000
export const addDays = (iso, n) => new Date((dayNum(iso) + n) * 86400000).toISOString().slice(0, 10)
export const canLogDate = (iso, today) => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') && iso <= today && iso >= addDays(today, -7)

const CAFFEINE_DAY_MAX = 400, CAFFEINE_SINGLE_REF = 200
const round10 = n => Math.round(n / 10) * 10
export function caffeineRange(weightKg) {
  if (!(weightKg > 0)) return null
  return { min: Math.min(CAFFEINE_DAY_MAX, round10(3 * weightKg)), max: Math.min(CAFFEINE_DAY_MAX, round10(6 * weightKg)), dayMax: CAFFEINE_DAY_MAX, singleRef: CAFFEINE_SINGLE_REF }
}
export const isOverCaffeine = total => total > CAFFEINE_DAY_MAX

// Día local del alta. createdAt llega del servidor en UTC ("2026-10-10T00:30:00Z" puede ser el 9 a la
// noche en Argentina); un día suelto ("2026-10-09") se usa tal cual.
export const startDay = createdAt => {
  const s = String(createdAt || '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const ms = Date.parse(s)
  return Number.isNaN(ms) ? '' : isoOf(new Date(ms))
}
export const isTrainingDay = (S, iso) => !!effectiveRoutineId(S, iso) || (S?.workouts || []).some(w => w.d === iso)
export const isDueOn = (item, iso, trainingDay) => item.status === 'active'
  && iso >= startDay(item.createdAt)
  && (item.days !== 'training' || !!trainingDay)
export const takenOn = (logs, itemId, iso) => logs.reduce((n, l) => n + (l.itemId === itemId && l.date === iso ? 1 : 0), 0)
const doses = item => Math.max(1, item.doses || 1)
// Desde cuándo cuenta: el alta o la primera toma registrada, la que sea antes (quien agrega hoy lo
// que ya venía tomando puede marcar los días anteriores y que sumen a la racha).
export function sinceOf(item, logs) {
  let since = startDay(item.createdAt) || '9999-12-31'
  for (const l of logs) if (l.itemId === item.id && l.date < since) since = l.date
  return since
}
const counting = (item, logs) => ({ ...item, status: 'active', createdAt: sinceOf(item, logs) })
const complete = (item, logs, iso) => takenOn(logs, item.id, iso) >= doses(item)

// Días seguidos completos entre los que tocaban. Hoy incompleto no corta (todavía hay tiempo).
export function streakOf(item, logs, today, trainingDayOf) {
  const it = counting(item, logs)
  let n = 0
  for (let i = 0; i < 400; i++) {
    const iso = addDays(today, -i)
    if (iso < it.createdAt) break
    if (!isDueOn(it, iso, trainingDayOf(iso))) continue
    if (complete(item, logs, iso)) n++
    else if (i > 0) break
  }
  return n
}

export function adherence30(item, logs, today, trainingDayOf) {
  const it = counting(item, logs)
  let due = 0, done = 0
  for (let i = 0; i < 30; i++) {
    const iso = addDays(today, -i)
    if (!isDueOn(it, iso, trainingDayOf(iso))) continue
    const ok = complete(item, logs, iso)
    if (i === 0 && !ok) continue
    due++; if (ok) done++
  }
  return due ? Math.round((done / due) * 100) : null
}

export function dayLevel(item, logs, iso, trainingDayOf) {
  if (!isDueOn(counting(item, logs), iso, trainingDayOf(iso))) return 0
  const taken = takenOn(logs, item.id, iso), need = doses(item)
  if (!taken) return 0
  if (taken < need) return taken * 2 >= need ? 2 : 1
  return streakOf(item, logs, iso, trainingDayOf) >= 7 ? 4 : 3
}

export function caffeineTotal(logs, items, iso) {
  const caffeineItems = new Set(items.filter(i => i.catalogId === 'cafeina').map(i => i.id))
  return Math.round(logs.filter(l => l.date === iso && (l.source || caffeineItems.has(l.itemId))).reduce((s, l) => s + (Number(l.amount) || 0), 0))
}

export function overDose(item, logs, iso) {
  const max = fichaById(item.catalogId)?.dayMax
  if (!max) return null
  const total = logs.filter(l => l.itemId === item.id && l.date === iso).reduce((s, l) => s + (Number(l.amount) || 0), 0)
  return total > max ? total : null
}

export const itemName = item => item.catalogId ? (fichaById(item.catalogId)?.name || item.name || '') : (item.name || '')
const fmt = n => String(Math.round(n * 100) / 100).replace('.', ',')
export const perTake = item => Math.round(((Number(item.dose) || 0) / doses(item)) * 100) / 100
const unitLabel = (unit, n) => unit === 'caps' ? (n === 1 ? 'cápsula' : 'cápsulas') : unit === 'dosis' ? (n === 1 ? 'dosis' : 'dosis') : (UNITS.find(u => u.id === unit)?.label || unit || '')
const scoops = n => { const halves = Math.round(n * 2); const whole = Math.floor(halves / 2); return (whole ? String(whole) : '') + (halves % 2 ? '½' : '') || '0' }
export function doseLabel(item) {
  const take = perTake(item)
  // Sin dosis cargada (indicación profesional o uno propio): solo las tomas.
  if (!(take > 0)) return doses(item) > 1 ? `${doses(item)} dosis` : 'Dosis indicada'
  if (doses(item) > 1) return `${doses(item)} dosis · ${fmt(take)} ${unitLabel(item.unit, take)} c/u`
  if (item.scoopG > 0 && item.unit === 'g') return `${scoops(take / item.scoopG)} scoop · ${fmt(take)} g`
  return `${fmt(take)} ${unitLabel(item.unit, take)}`
}

// Gramos de proteína de una dosis de proteína en polvo (los del scoop de la etiqueta; sin scoop, 30 g):
// 30 g de polvo no son 30 g de proteína.
export function proteinPerTake(item) {
  if (item.catalogId !== 'proteina') return null
  const m = item.meta?.macros || fichaById('proteina')?.macrosPerScoop
  if (!m) return null
  return Math.round(((m.proteina || 0) * perTake(item) / (item.scoopG > 0 ? item.scoopG : 30)) * 10) / 10
}

export const groupBySlot = items => SLOTS
  .map(slot => ({ slot, items: items.filter(i => (i.slot || 'any') === slot.id) }))
  .filter(g => g.items.length)

export function adultStatus({ edad, adult }) {
  if (Number(edad) > 0) return Number(edad) >= 18 ? 'adult' : 'minor'
  if (adult === 1 || adult === true) return 'adult'
  if (adult === 0 || adult === false) return 'minor'
  return 'unknown'
}
