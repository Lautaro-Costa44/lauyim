// Clases grupales en el cliente (docs/superpowers/specs/2026-10-01-clases-design.md): etiquetas,
// estado del botón de cada fecha y las llamadas a la API. Las reglas (ventana, cupo, lista de
// espera) las decide el servidor; acá solo se muestran.
import { api } from './api.js'

export const REMINDER_OPTIONS = [300, 120, 60, 30, 15]
export const reminderLabel = m => m >= 60 ? `${m / 60} h` : `${m} min`
// Sin cupo (capacity null): solo cuántos hay.
export const capacityText = (booked, capacity) => capacity == null ? `${booked}` : `${booked}/${capacity}`
export const timeRange = occ => `${occ.start}–${occ.end}`
export const INTENSITY_LABELS = { low: 'Baja', medium: 'Media', high: 'Alta' }
export const intensityLabel = key => INTENSITY_LABELS[key] || ''

const WEEKDAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const dayNum = date => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86400000
export const addDays = (date, n) => new Date((dayNum(date) + n) * 86400000).toISOString().slice(0, 10)
export const weekdayOf = date => new Date(dayNum(date) * 86400000).getUTCDay()
export const shortDay = date => `${WEEKDAYS_SHORT[weekdayOf(date)]} ${Number(date.slice(8, 10))}`

// Chips de días desde hoy: "Hoy", "Mañana", "Mié 7"…
export function dayChips(today, days) {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i)
    return { date, label: i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : shortDay(date) }
  })
}

// Link de Google Calendar con el evento ya cargado (abre la app en Android). tz: la del gimnasio.
export function googleCalendarUrl(occ, tz) {
  const stamp = (date, time) => date.replace(/-/g, '') + 'T' + time.replace(':', '') + '00'
  const endDate = occ.end < occ.start ? addDays(occ.date, 1) : occ.date
  const params = new URLSearchParams({ action: 'TEMPLATE', text: occ.name, dates: `${stamp(occ.date, occ.start)}/${stamp(endDate, occ.end)}` })
  if (tz) params.set('ctz', tz)
  if (occ.room) params.set('location', occ.room)
  if (occ.teacherName) params.set('details', 'Con ' + occ.teacherName)
  return 'https://calendar.google.com/calendar/render?' + params.toString()
}

export const conflictMessages = result => result ? [...(result.blocking || []), ...(result.warnings || [])].map(c => c.text) : []

// Botón de una fecha para el socio: { key, label, disabled }. Una reserva cancelada no cuenta.
export function buttonState({ state, booked, capacity, myBooking, teaching, planFull }) {
  if (teaching) return { key: 'teaching', label: 'La das vos', disabled: true }
  const mine = myBooking && ['booked', 'waitlist'].includes(myBooking.status) ? myBooking : null
  if (mine?.status === 'booked') return { key: 'booked', label: 'Anotado', disabled: false }
  if (mine?.status === 'waitlist') return { key: 'waiting', label: `En espera (n.º ${mine.waitlistPos})`, disabled: false }
  if (state === 'cancelled') return { key: 'cancelled', label: 'Suspendida', disabled: true }
  if (state === 'started') return { key: 'started', label: 'Empezó', disabled: true }
  if (state === 'not_yet') return { key: 'not_yet', label: 'Todavía no abre', disabled: true }
  if (planFull) return { key: 'plan', label: 'Límite del plan', disabled: true }
  if (capacity != null && booked >= capacity) return { key: 'waitlist', label: 'Lista de espera', disabled: false }
  return { key: 'book', label: 'Anotarme', disabled: false }
}

const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) })
const put = (url, body) => api(url, { method: 'PUT', body: JSON.stringify(body) })
// Una fecha: por su fecha guardada, o por bloque y fecha.
const occQuery = occ => occ.sessionId ? `sessionId=${encodeURIComponent(occ.sessionId)}` : `slotId=${encodeURIComponent(occ.slotId)}&date=${occ.date}`

export const classesApi = {
  // socio
  // Sin rango: desde hoy, los días de la ventana de reserva.
  // Con límite en el plan, las fechas de semanas (o meses) ya completos vienen marcadas (planFull).
  list: (from, days) => api(from ? `/api/classes?from=${from}&days=${days}` : '/api/classes')
    .then(d => d?.planLimit ? { ...d, occurrences: markPlanFull(d.occurrences, d.planLimit) } : d),
  book: ({ slotId, date, sessionId }) => post('/api/classes/book', { slotId, date, sessionId }),
  cancel: bookingId => post('/api/classes/cancel', { bookingId }),
  setReminders: (bookingId, reminders) => put('/api/classes/reminders', { bookingId, reminders }),
  setReminderDefaults: reminders => put('/api/classes/reminder-defaults', { reminders }),
  recurring: (slotId, on) => post(on ? '/api/classes/recurring' : '/api/classes/recurring/delete', { slotId }),
  bookWeek: classId => post('/api/classes/book-week', { classId }),
  booking: id => api(`/api/classes/booking?id=${encodeURIComponent(id)}`),
  setTeacherReminder: minutes => put('/api/classes/teacher-reminder', { minutes }),
  icsUrl: bookingId => `/api/classes/ics?booking=${encodeURIComponent(bookingId)}`,
  pending: () => api('/api/classes/pending'),
  answer: (bookingId, attended, rating) => post('/api/classes/attendance', { bookingId, attended, rating }),
  logged: bookingId => post('/api/classes/logged', { bookingId }),
  rate: (bookingId, rating) => post('/api/classes/rating', { bookingId, rating }),
  takeAttendance: (sessionId, present, absent) => post('/api/admin/classes/sessions/attendance', { sessionId, present, absent }),
  stats: weeks => api(`/api/admin/classes/stats?weeks=${weeks}`),
  // staff
  types: () => api('/api/admin/classes/types'),
  saveType: body => post('/api/admin/classes/types/save', body),
  archiveType: id => post('/api/admin/classes/types/archive', { id }),
  saveSlot: body => post('/api/admin/classes/slots/save', body),
  deleteSlot: id => post('/api/admin/classes/slots/delete', { id }),
  overlapCheck: body => post('/api/admin/classes/overlap-check', body),
  calendar: (from, days) => api(`/api/admin/classes/calendar?from=${from}&days=${days}`),
  session: occ => api(`/api/admin/classes/session?${occQuery(occ)}`),
  adminBooking: id => api(`/api/admin/classes/booking?id=${encodeURIComponent(id)}`),
  closures: () => api('/api/admin/classes/closures'),
  closurePreview: (from, to) => api(`/api/admin/classes/closures/preview?from=${from}&to=${to}`),
  addClosure: body => post('/api/admin/classes/closures', body),
  deleteClosure: id => post('/api/admin/classes/closures/delete', { id }),
  member: userId => api(`/api/admin/classes/member?userId=${encodeURIComponent(userId)}`),
  cancelForMember: bookingId => post('/api/admin/classes/member/cancel', { bookingId }),
  resetPenalty: userId => post('/api/admin/classes/member/penalty-reset', { userId }),
  messageSession: (occ, text, waitlist) => post('/api/admin/classes/sessions/message', { sessionId: occ.sessionId, slotId: occ.slotId, date: occ.date, text, waitlist }),
  addToSession: (occ, userId) => post('/api/admin/classes/sessions/add', { sessionId: occ.sessionId, slotId: occ.slotId, date: occ.date, userId }),
  changeSession: body => post('/api/admin/classes/sessions/change', body),
  hideSession: sessionId => post('/api/admin/classes/sessions/hide', { sessionId }),
  // owner
  settings: () => api('/api/owner/classes/settings'),
  saveSettings: body => put('/api/owner/classes/settings', body),
}

// ---- tarjeta de Inicio ----

// Fecha y hora del gimnasio -> milisegundos (zona del gimnasio; sin zona, la del celular).
export function zonedToEpoch(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  if (!tz) return new Date(y, m - 1, d, hh, mm).getTime()
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess))
  const g = type => Number(parts.find(p => p.type === type).value)
  return guess - (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - guess)
}

// Inicio y fin de una fecha de clase en milisegundos.
export function occTimes(occ, tz) {
  const start = zonedToEpoch(occ.date, occ.start, tz)
  return { start, end: start + (occ.durationMin || 60) * 60000 }
}

const pad2 = n => String(n).padStart(2, '0')
// Cuánto falta: { mode, label }. mode: 'days' (24 h o más), 'hours' (menos de 24 h), 'minutes'
// (menos de 1 h, con segundos), 'live' (en curso) o 'over'.
export function countdown(startMs, endMs, nowMs) {
  const left = startMs - nowMs
  if (nowMs >= endMs) return { mode: 'over', label: '' }
  if (left <= 0) return { mode: 'live', label: 'En curso' }
  const s = Math.floor(left / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24)
  if (h >= 24) return { mode: 'days', label: d === 1 ? 'en 1 día' : `en ${d} días` }
  if (h >= 1) return { mode: 'hours', label: `${h} h ${pad2(m % 60)} min` }
  return { mode: 'minutes', label: `${pad2(m)}:${pad2(s % 60)}` }
}

// Lo que ve la tarjeta de Inicio: la próxima reserva activa que no terminó y las suspendidas que
// todavía no se avisaron (dismissed: claves ya cerradas).
export function homeClasses(occurrences, nowMs, tz, dismissed = []) {
  const mine = (occurrences || []).filter(o => o.myBooking)
  const upcoming = mine.filter(o => !o.cancelled && ['booked', 'waitlist'].includes(o.myBooking.status) && occTimes(o, tz).end > nowMs)
    .sort((a, b) => occTimes(a, tz).start - occTimes(b, tz).start)
  const suspended = mine.filter(o => o.cancelled && occTimes(o, tz).end > nowMs && !dismissed.includes(o.key))
  return { next: upcoming[0] || null, upcoming, suspended }
}

// ---- varios días de una clase ----

// Días de la clase para "Fija", de lunes a domingo: [{ id, weekday, start, recurring, label: 'Lun 19:00' }].
export function classSlotChips(slots, classId) {
  const mondayFirst = wd => (wd + 6) % 7
  return (slots || []).filter(s => s.classId === classId)
    .sort((a, b) => mondayFirst(a.weekday) - mondayFirst(b.weekday) || a.start.localeCompare(b.start))
    .map(s => ({ id: s.id, weekday: s.weekday, start: s.start, recurring: !!s.recurring, label: `${WEEKDAYS_SHORT[s.weekday]} ${s.start}` }))
}

// Fechas de la clase en los próximos 7 días que se pueden reservar y todavía no tiene.
export function weekBookable(occurrences, classId, today) {
  const end = addDays(today, 7)
  return (occurrences || []).filter(o => o.classId === classId && o.state === 'open' && !o.cancelled && !o.planFull && o.date < end
    && !(o.myBooking && ['booked', 'waitlist'].includes(o.myBooking.status)))
}

// Aviso después de "Anotarme a todas": [texto, ...valores] para t().
export function bookWeekText({ booked, waitlist }) {
  const n = k => k === 1 ? '1 fecha' : `${k} fechas`
  if (!booked && !waitlist) return ['Ya estabas en todas']
  if (!waitlist) return ['Te anotaste a {0}', n(booked)]
  if (!booked) return ['Quedaste en lista de espera en {0}', n(waitlist)]
  return ['Te anotaste a {0} y quedaste en espera en {1}', n(booked), n(waitlist)]
}

// Inicio de la profe: la próxima clase que da (sin terminar ni suspendida) y las otras que da ese
// mismo día (también las que ya terminaron, para tomar lista), por hora.
export function teacherHome(occurrences, nowMs, tz) {
  const mine = (occurrences || []).filter(o => o.teaching && !o.cancelled)
    .sort((a, b) => occTimes(a, tz).start - occTimes(b, tz).start)
  const next = mine.find(o => occTimes(o, tz).end > nowMs) || null
  const sameDay = next ? mine.filter(o => o.date === next.date && o.key !== next.key) : []
  return { next, sameDay, over: o => occTimes(o, tz).end <= nowMs }
}

// Lugares de una fecha para el socio: [texto, ...valores] para t().
export function spotsText({ booked, capacity }) {
  if (capacity == null) return ['Sin cupo']
  const left = capacity - booked
  if (left <= 0) return ['Lista de espera']
  return left === 1 ? ['Queda 1'] : ['Quedan {0}', left]
}

// Inicio sin reservas: las clases del primer día (desde hoy) que todavía tienen algo por delante:
// sin terminar, sin suspender y que no da la persona. -> { date, items } (items vacío: no hay).
export function homeStrip(occurrences, nowMs, tz) {
  const open = (occurrences || []).filter(o => !o.cancelled && !o.teaching && occTimes(o, tz).end > nowMs)
    .sort((a, b) => occTimes(a, tz).start - occTimes(b, tz).start)
  const date = open[0]?.date || null
  return { date, items: date ? open.filter(o => o.date === date) : [] }
}

// Cómo quedó presente en una clase (detalle del historial). staff: dicho desde la ficha.
export function attendanceSourceLabel(source, staff = false) {
  if (source === 'teacher') return 'La profe tomó lista'
  if (source === 'checkin') return staff ? 'Ingresó al gimnasio' : 'Ingresaste al gimnasio'
  if (source === 'member') return staff ? 'Dijo que fue' : 'Dijiste que fuiste'
  return null
}

// ---- compartir la lista ----

// "Ana Pérez" -> "Ana P." (cuida los datos al compartir en grupos con otros socios).
export function shortName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return words[0] || ''
  return `${words[0]} ${words.at(-1)[0].toUpperCase()}.`
}

// Texto de la lista de una fecha para compartir (WhatsApp, etc.). full: nombre completo. Con la
// lista tomada, cada anotado lleva ✓ (presente) o ✗ (ausente).
export function shareListText({ occ, booked = [], waitlist = [], full = false }) {
  const name = p => full ? p.name : shortName(p.name)
  const mark = p => p.status === 'attended' ? ' ✓' : p.status === 'absent' ? ' ✗' : ''
  const count = occ.capacity == null ? `${booked.length}` : `${booked.length}/${occ.capacity}`
  const lines = [[occ.name, `${shortDay(occ.date)}/${Number(occ.date.slice(5, 7))}`, occ.start, occ.room].filter(Boolean).join(' · ')]
  if (occ.teacherName) lines.push(`Profe: ${occ.teacherName}`)
  lines.push('', `Anotados (${count}):`)
  if (!booked.length) lines.push('Todavía no hay nadie anotado.')
  booked.forEach((p, i) => lines.push(`${i + 1}. ${name(p)}${mark(p)}`))
  if (waitlist.length) {
    lines.push('', 'En espera:')
    waitlist.forEach((p, i) => lines.push(`${i + 1}. ${name(p)}`))
  }
  return lines.join('\n')
}

// ---- cierres del gimnasio ----

const dm = date => `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`
// "Lun 12/10" o "2/1 al 15/1".
export const closureLabel = c => c.from === c.to ? `${shortDay(c.from)}/${Number(c.from.slice(5, 7))}` : `${dm(c.from)} al ${dm(c.to)}`
// El cierre que toca una fecha (o null).
export const closureOn = (closures, date) => (closures || []).find(c => c.from <= date && date <= c.to) || null

// ---- límite de clases por plan ----

// Inicio del período de una fecha: el lunes de su semana o el día 1 de su mes.
export const periodStart = (date, period) => period === 'month' ? date.slice(0, 8) + '01' : addDays(date, -((weekdayOf(date) + 6) % 7))
const usedIn = (planLimit, date) => planLimit.used?.[periodStart(date, planLimit.period)] ?? 0

// Marca planFull en las fechas sin reserva propia de un período ya completo.
export function markPlanFull(occurrences, planLimit) {
  if (!planLimit) return occurrences
  return (occurrences || []).map(o => {
    const mine = o.myBooking && ['booked', 'waitlist'].includes(o.myBooking.status)
    return !mine && !o.teaching && usedIn(planLimit, o.date) >= planLimit.limit ? { ...o, planFull: true } : o
  })
}

// La línea de Plan → Clases para el día elegido: [texto, ...valores] para t(), o null sin límite.
export function planLine(planLimit, date, today) {
  if (!planLimit) return null
  const { limit, period } = planLimit
  const left = Math.max(0, limit - usedIn(planLimit, date))
  const same = periodStart(date, period) === periodStart(today, period)
  const when = period === 'month' ? (same ? 'este mes' : 'ese mes') : (same ? 'esta semana' : 'esa semana')
  if (!left) return limit === 1 ? ['Ya usaste tu clase de {0}', when] : ['Ya usaste tus {0} clases de {1}', limit, when]
  return limit === 1 ? ['Te queda 1 clase {0}', when] : ['Te quedan {0} de {1} clases {2}', left, limit, when]
}

// El límite en palabras: "2 clases por semana".
export const planLimitLabel = ({ limit, period }) => `${limit === 1 ? '1 clase' : `${limit} clases`} por ${period === 'month' ? 'mes' : 'semana'}`
