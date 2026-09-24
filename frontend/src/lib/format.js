// Formatting + date helpers (ported from the vanilla app, unit taken from the store where needed).
import { dateLocale, t } from './i18n-core.js'
export const todayISO = () => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
export const isoOf = d =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

// A workout's `d` is a LOCAL calendar day. `new Date('YYYY-MM-DD')` parses it as UTC midnight,
// which in UTC-3 is 21:00 of the previous day, so every date-to-time conversion goes through
// here instead. Only the strict 'YYYY-MM-DD' shape is a calendar day; anything else is null.
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
function localDayAt(iso, hour) {
  const m = ISO_DAY.exec(String(iso ?? ''))
  if (!m) return null
  const time = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour).getTime()
  return Number.isFinite(time) ? time : null
}
/** Local midnight that opens calendar day `iso`, or null when `iso` is not 'YYYY-MM-DD'. */
export const localDayStartOf = iso => localDayAt(iso, 0)
/** Local noon of calendar day `iso`, or null when `iso` is not 'YYYY-MM-DD'. */
export const localNoonOf = iso => localDayAt(iso, 12)

/**
 * When a workout happened, for every date and window question (recency, fatigue, strength,
 * rolling windows, chart position). Durations still read `end - start` directly.
 *
 * `start` is trusted only when it falls on the workout's own local day `d`. A workout marked
 * done after the fact used to be stamped with the time it was marked, so a `start` on another
 * day says when it was logged, not when it was trained; local noon of `d` stands in for it,
 * and for a workout with no `start` at all. A `d` that is not a plain calendar day cannot be
 * compared, so `start` (or the parsed `d`) is used as before.
 *
 * @param {{ start?: number, d?: string }} w Workout record.
 * @returns {number} Timestamp in milliseconds, NaN when neither field is usable.
 */
export function workoutTime(w) {
  const start = w?.start ? Number(w.start) : NaN
  const noon = localNoonOf(w?.d)
  if (noon == null) return Number.isFinite(start) ? start : new Date(w?.d).getTime()
  return Number.isFinite(start) && isoOf(new Date(start)) === w.d ? start : noon
}

export const DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function fmtDate(iso, long, withYear = false) {
  const d = new Date(iso + 'T12:00:00')
  const options = long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' }
  if (withYear) options.year = 'numeric'
  return d.toLocaleDateString(dateLocale(), options)
}
export function fmtDur(ms) {
  const m = Math.floor(ms / 60000)
  return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min'
}
// Imported history has no clock — an unknown duration is left out rather than shown as "0 min".
export const durPart = ms => (ms >= 60000 ? [fmtDur(ms)] : [])
// Numbers follow the UI language, like the dates above — a hardcoded locale put Swiss
// apostrophes ("7'535 kg") in front of every user, in every language.
export const fmtNum = n => (Math.round(n * 10) / 10).toLocaleString(dateLocale())
// Volume stays in the profile's unit throughout: the old shorthand turned anything over
// 10 000 into "t", which is wrong for a pound profile and made one list mix "18.8t" with
// "7'535 kg" — two numbers you can't compare at a glance.
export const fmtVol = (v, unit) => fmtNum(v) + ' ' + unit

// Cuotas: montos en pesos enteros con separador de miles es-AR ("$30.000") y fechas de
// calendario como dd/mm/aaaa. Son los únicos formatters de dinero y de esa fecha: no rearmar
// el formato en cada pantalla.
const PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
export const fmtPesos = n => '$' + PESOS.format(Math.trunc(Number(n) || 0))
export const fmtDateDMY = iso => {
  const m = ISO_DAY.exec(String(iso ?? ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}
// 'YYYY-MM-DD' + n días, en calendario puro (sin la tz del navegador).
export const addDaysISO = (iso, days) => {
  const m = ISO_DAY.exec(String(iso ?? ''))
  if (!m) return ''
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)).toISOString().slice(0, 10)
}
// Plural forms are not automatic when the English string is the key.
export const exCount = n => t(n === 1 ? '{0} exercise' : '{0} exercises', n)

export function weekKey(d) {
  const dt = new Date(d + 'T12:00:00')
  const day = (dt.getDay() + 6) % 7
  dt.setDate(dt.getDate() - day + 3)
  const jan4 = new Date(dt.getFullYear(), 0, 4)
  const week = 1 + Math.round(((dt - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7)
  return dt.getFullYear() + '-W' + String(week).padStart(2, '0')
}

export const localTZ = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
export const ACCENTS = { lime: '#30d158', sky: '#0a84ff', orange: '#ff9f0a', violet: '#bf5af2', pink: '#ff375f', red: '#ff453a', teal: '#40c8e0', gold: '#ffd60a' }