import { describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
vi.mock('./api.js', () => ({ api: apiMock }))

const { REMINDER_OPTIONS, reminderLabel, buttonState, capacityText, timeRange, dayChips, conflictMessages, intensityLabel, googleCalendarUrl, classesApi } = await import('./classes.js')

describe('etiquetas', () => {
  it('recordatorios, cupo, horario e intensidad', () => {
    expect(REMINDER_OPTIONS).toEqual([300, 120, 60, 30, 15])
    expect(REMINDER_OPTIONS.map(reminderLabel)).toEqual(['5 h', '2 h', '1 h', '30 min', '15 min'])
    expect(capacityText(8, 12)).toBe('8/12')
    expect(timeRange({ start: '19:00', end: '19:45' })).toBe('19:00–19:45')
    expect(['low', 'medium', 'high'].map(intensityLabel)).toEqual(['Baja', 'Media', 'Alta'])
  })

  it('días: hoy, mañana y después día de la semana corto con número', () => {
    // 2026-10-05 es lunes.
    expect(dayChips('2026-10-05', 4)).toEqual([
      { date: '2026-10-05', label: 'Hoy' }, { date: '2026-10-06', label: 'Mañana' },
      { date: '2026-10-07', label: 'Mié 7' }, { date: '2026-10-08', label: 'Jue 8' }
    ])
  })

  it('Google Calendar: evento con hora local del gym, sala y profe; cruza la medianoche', () => {
    const url = new URL(googleCalendarUrl({ name: 'Spinning', date: '2026-10-05', start: '19:00', end: '19:45', room: 'Sala 2', teacherName: 'Caro' }, 'America/Argentina/Buenos_Aires'))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(Object.fromEntries(url.searchParams)).toEqual({ action: 'TEMPLATE', text: 'Spinning', dates: '20261005T190000/20261005T194500', ctz: 'America/Argentina/Buenos_Aires', location: 'Sala 2', details: 'Con Caro' })
    expect(new URL(googleCalendarUrl({ name: 'Yoga', date: '2026-10-05', start: '23:30', end: '00:15' })).searchParams.get('dates')).toBe('20261005T233000/20261006T001500')
  })

  it('avisos de superposición: primero los que bloquean', () => {
    expect(conflictMessages({ blocking: [{ text: 'A' }], warnings: [{ text: 'B' }] })).toEqual(['A', 'B'])
    expect(conflictMessages(null)).toEqual([])
  })
})

describe('botón de una clase', () => {
  const occ = { state: 'open', booked: 3, capacity: 12, myBooking: null }
  it('según mi reserva y el estado de la fecha', () => {
    expect(buttonState(occ)).toMatchObject({ key: 'book', label: 'Anotarme', disabled: false })
    expect(buttonState({ ...occ, booked: 12 })).toMatchObject({ key: 'waitlist', label: 'Lista de espera', disabled: false })
    expect(buttonState({ ...occ, myBooking: { status: 'booked' } })).toMatchObject({ key: 'booked', label: 'Anotado' })
    expect(buttonState({ ...occ, myBooking: { status: 'waitlist', waitlistPos: 2 } })).toMatchObject({ key: 'waiting', label: 'En espera (n.º 2)' })
    // Una reserva cancelada no cuenta: se puede volver a anotar.
    expect(buttonState({ ...occ, myBooking: { status: 'cancelled' } }).key).toBe('book')
    expect(buttonState({ ...occ, state: 'cancelled' })).toMatchObject({ key: 'cancelled', label: 'Suspendida', disabled: true })
    expect(buttonState({ ...occ, state: 'started' })).toMatchObject({ key: 'started', disabled: true })
    expect(buttonState({ ...occ, state: 'not_yet' })).toMatchObject({ key: 'not_yet', label: 'Todavía no abre', disabled: true })
    // Ya empezó pero estoy anotado: se ve "Anotado".
    expect(buttonState({ ...occ, state: 'started', myBooking: { status: 'booked' } }).key).toBe('booked')
  })
})

describe('classesApi', () => {
  it('llama a las rutas con el cuerpo justo', async () => {
    await classesApi.list('2026-10-05', 7)
    expect(apiMock).toHaveBeenLastCalledWith('/api/classes?from=2026-10-05&days=7')
    await classesApi.book({ slotId: 's1', date: '2026-10-05', sessionId: null })
    expect(apiMock).toHaveBeenLastCalledWith('/api/classes/book', { method: 'POST', body: JSON.stringify({ slotId: 's1', date: '2026-10-05', sessionId: null }) })
    await classesApi.setReminders('b1', [60, 15])
    expect(apiMock).toHaveBeenLastCalledWith('/api/classes/reminders', { method: 'PUT', body: JSON.stringify({ bookingId: 'b1', reminders: [60, 15] }) })
    await classesApi.recurring('s1', false)
    expect(apiMock).toHaveBeenLastCalledWith('/api/classes/recurring/delete', { method: 'POST', body: JSON.stringify({ slotId: 's1' }) })
    expect(classesApi.icsUrl('b 1')).toBe('/api/classes/ics?booking=b%201')
    await classesApi.session({ sessionId: 'x1' })
    expect(apiMock).toHaveBeenLastCalledWith('/api/admin/classes/session?sessionId=x1')
    await classesApi.session({ sessionId: null, slotId: 's1', date: '2026-10-05' })
    expect(apiMock).toHaveBeenLastCalledWith('/api/admin/classes/session?slotId=s1&date=2026-10-05')
  })
})
