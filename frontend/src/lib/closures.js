// Cierres del gimnasio en el cliente (docs/superpowers/specs/2026-10-09-cierres-gym-design.md): la API
// y los helpers de fechas. Sin imports de classes.js (classes.js re-exporta closureOn y closureLabel).
import { api } from './api.js'

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })
export const closuresApi = {
  member: () => api('/api/closures'),
  list: () => api('/api/admin/closures'),
  preview: (from, to) => api(`/api/admin/closures/preview?from=${from}&to=${to}`),
  add: body => post('/api/admin/closures', body),
  remove: (id, revert = true) => post('/api/admin/closures/delete', { id, revert }),
}

const dayNum = date => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86400000
const addDays = (date, n) => new Date((dayNum(date) + n) * 86400000).toISOString().slice(0, 10)
const weekday = date => new Date(dayNum(date) * 86400000).getUTCDay()
const SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const dm = date => `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`

// "Lun 12/10" o "2/1 al 15/1".
export const closureLabel = c => c.from === c.to ? `${SHORT[weekday(c.from)]} ${dm(c.from)}` : `${dm(c.from)} al ${dm(c.to)}`
// El cierre que toca una fecha (o null).
export const closureOn = (closures, date) => (closures || []).find(c => c.from <= date && date <= c.to) || null
// Para frases: "hoy", "mañana", "el lunes 12" o "del 24/12 al 2/1".
export function closureLongLabel(c, today) {
  if (c.from !== c.to) return `del ${dm(c.from)} al ${dm(c.to)}`
  if (c.from === today) return 'hoy'
  if (c.from === addDays(today, 1)) return 'mañana'
  return `el ${LONG[weekday(c.from)]} ${Number(c.from.slice(8, 10))}`
}
// El cierre para el banner de Inicio: empieza dentro de `aheadDays` o está en curso. El más próximo.
export const upcomingClosure = (closures, today, aheadDays = 7) => [...(closures || [])]
  .filter(c => c.to >= today && c.from <= addDays(today, aheadDays))
  .sort((a, b) => a.from.localeCompare(b.from))[0] || null
// Las fechas cerradas de la semana que empieza el lunes `mondayIso`.
export function weekClosedDays(closures, mondayIso) {
  const out = []
  for (let i = 0; i < 7; i++) { const iso = addDays(mondayIso, i); if (closureOn(closures, iso)) out.push(iso) }
  return out
}
