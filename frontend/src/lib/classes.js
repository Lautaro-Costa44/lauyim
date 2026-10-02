// Clases grupales en el cliente (docs/superpowers/specs/2026-10-01-clases-design.md): etiquetas,
// estado del botón de cada fecha y las llamadas a la API. Las reglas (ventana, cupo, lista de
// espera) las decide el servidor; acá solo se muestran.
import { api } from './api.js'

export const REMINDER_OPTIONS = [300, 120, 60, 30, 15]
export const reminderLabel = m => m >= 60 ? `${m / 60} h` : `${m} min`
export const capacityText = (booked, capacity) => `${booked}/${capacity}`
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

export const conflictMessages = result => result ? [...(result.blocking || []), ...(result.warnings || [])].map(c => c.text) : []

// Botón de una fecha para el socio: { key, label, disabled }. Una reserva cancelada no cuenta.
export function buttonState({ state, booked, capacity, myBooking }) {
  const mine = myBooking && ['booked', 'waitlist'].includes(myBooking.status) ? myBooking : null
  if (mine?.status === 'booked') return { key: 'booked', label: 'Anotado', disabled: false }
  if (mine?.status === 'waitlist') return { key: 'waiting', label: `En espera (n.º ${mine.waitlistPos})`, disabled: false }
  if (state === 'cancelled') return { key: 'cancelled', label: 'Suspendida', disabled: true }
  if (state === 'started') return { key: 'started', label: 'Empezó', disabled: true }
  if (state === 'not_yet') return { key: 'not_yet', label: 'Todavía no abre', disabled: true }
  if (booked >= capacity) return { key: 'waitlist', label: 'Lista de espera', disabled: false }
  return { key: 'book', label: 'Anotarme', disabled: false }
}

const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) })
const put = (url, body) => api(url, { method: 'PUT', body: JSON.stringify(body) })
// Una fecha: por su fecha guardada, o por bloque y fecha.
const occQuery = occ => occ.sessionId ? `sessionId=${encodeURIComponent(occ.sessionId)}` : `slotId=${encodeURIComponent(occ.slotId)}&date=${occ.date}`

export const classesApi = {
  // socio
  // Sin rango: desde hoy, los días de la ventana de reserva.
  list: (from, days) => api(from ? `/api/classes?from=${from}&days=${days}` : '/api/classes'),
  book: ({ slotId, date, sessionId }) => post('/api/classes/book', { slotId, date, sessionId }),
  cancel: bookingId => post('/api/classes/cancel', { bookingId }),
  setReminders: (bookingId, reminders) => put('/api/classes/reminders', { bookingId, reminders }),
  setReminderDefaults: reminders => put('/api/classes/reminder-defaults', { reminders }),
  recurring: (slotId, on) => post(on ? '/api/classes/recurring' : '/api/classes/recurring/delete', { slotId }),
  icsUrl: bookingId => `/api/classes/ics?booking=${encodeURIComponent(bookingId)}`,
  // staff
  types: () => api('/api/admin/classes/types'),
  saveType: body => post('/api/admin/classes/types/save', body),
  archiveType: id => post('/api/admin/classes/types/archive', { id }),
  saveSlot: body => post('/api/admin/classes/slots/save', body),
  deleteSlot: id => post('/api/admin/classes/slots/delete', { id }),
  overlapCheck: body => post('/api/admin/classes/overlap-check', body),
  calendar: (from, days) => api(`/api/admin/classes/calendar?from=${from}&days=${days}`),
  session: occ => api(`/api/admin/classes/session?${occQuery(occ)}`),
  addToSession: (occ, userId) => post('/api/admin/classes/sessions/add', { sessionId: occ.sessionId, slotId: occ.slotId, date: occ.date, userId }),
  changeSession: body => post('/api/admin/classes/sessions/change', body),
  // owner
  settings: () => api('/api/owner/classes/settings'),
  saveSettings: body => put('/api/owner/classes/settings', body),
}
