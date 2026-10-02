import { describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
vi.mock('./api.js', () => ({ api: apiMock }))

const { REMINDER_OPTIONS, reminderLabel, buttonState, capacityText, timeRange, dayChips, conflictMessages, intensityLabel, googleCalendarUrl, classesApi, zonedToEpoch, countdown, homeClasses, classSlotChips, weekBookable, bookWeekText } = await import('./classes.js')

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
    // La profe no se anota a la clase que da.
    expect(buttonState({ ...occ, teaching: true })).toMatchObject({ key: 'teaching', label: 'La das vos', disabled: true })
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

describe('tarjeta de Inicio', () => {
  const TZ = 'America/Argentina/Buenos_Aires'
  it('hora del gimnasio en milisegundos', () => {
    expect(new Date(zonedToEpoch('2026-10-05', '10:00', TZ)).toISOString()).toBe('2026-10-05T13:00:00.000Z')
  })

  it('cuenta regresiva: días, horas, minutos con segundos, en curso y terminada', () => {
    const start = Date.parse('2026-10-05T13:00:00Z'), end = start + 3600000
    const at = iso => countdown(start, end, Date.parse(iso))
    expect(at('2026-10-02T12:00:00Z')).toEqual({ mode: 'days', label: 'en 3 días' })
    expect(at('2026-10-04T12:00:00Z')).toEqual({ mode: 'days', label: 'en 1 día' })
    expect(at('2026-10-04T13:00:01Z')).toEqual({ mode: 'hours', label: '23 h 59 min' })
    expect(at('2026-10-05T11:46:00Z')).toEqual({ mode: 'hours', label: '1 h 14 min' })
    expect(at('2026-10-05T12:45:55Z')).toEqual({ mode: 'minutes', label: '14:05' })
    expect(at('2026-10-05T13:10:00Z')).toEqual({ mode: 'live', label: 'En curso' })
    expect(at('2026-10-05T14:00:00Z').mode).toBe('over')
  })

  it('próxima reserva, la lista y las suspendidas sin avisar', () => {
    const base = { durationMin: 60, cancelled: false }
    const occs = [
      { ...base, key: 'a', date: '2026-10-07', start: '19:00', myBooking: { status: 'waitlist' } },
      { ...base, key: 'b', date: '2026-10-05', start: '10:00', myBooking: { status: 'booked' } },
      { ...base, key: 'c', date: '2026-10-06', start: '10:00', myBooking: { status: 'cancelled' } },
      { ...base, key: 'd', date: '2026-10-06', start: '08:00', cancelled: true, myBooking: { status: 'cancelled' } },
      { ...base, key: 'e', date: '2026-10-06', start: '09:00', myBooking: null }
    ]
    const now = Date.parse('2026-10-05T12:00:00Z')
    const r = homeClasses(occs, now, TZ)
    expect([r.next.key, r.upcoming.map(o => o.key), r.suspended.map(o => o.key)]).toEqual(['b', ['b', 'a'], ['d']])
    expect(homeClasses(occs, now, TZ, ['d']).suspended).toEqual([])
    // En curso sigue siendo la próxima hasta que termina.
    expect(homeClasses(occs, Date.parse('2026-10-05T13:30:00Z'), TZ).next.key).toBe('b')
  })
})

describe('varios días de una clase', () => {
  it('chips de "Fija": solo esa clase, de lunes a domingo', () => {
    const slots = [
      { id: 'd', classId: 'c1', weekday: 0, start: '10:00', recurring: false },
      { id: 'v', classId: 'c1', weekday: 5, start: '19:30', recurring: true },
      { id: 'x', classId: 'c2', weekday: 1, start: '08:00' },
      { id: 'l', classId: 'c1', weekday: 1, start: '19:00' }
    ]
    expect(classSlotChips(slots, 'c1').map(s => [s.id, s.label, s.recurring])).toEqual([['l', 'Lun 19:00', false], ['v', 'Vie 19:30', true], ['d', 'Dom 10:00', false]])
    expect(classSlotChips(undefined, 'c1')).toEqual([])
  })

  it('fechas para "Anotarme a todas": abiertas, de esa clase, sin reserva y en los próximos 7 días', () => {
    const o = (key, extra) => ({ key, classId: 'c1', date: '2026-10-06', state: 'open', cancelled: false, myBooking: null, ...extra })
    const occs = [
      o('ok'), o('full'), o('other', { classId: 'c2' }), o('late', { date: '2026-10-12' }), o('far', { date: '2026-10-13' }),
      o('mine', { myBooking: { status: 'booked' } }), o('wait', { myBooking: { status: 'waitlist' } }), o('again', { myBooking: { status: 'cancelled' } }),
      o('started', { state: 'started' }), o('sus', { cancelled: true, state: 'cancelled' })
    ]
    expect(weekBookable(occs, 'c1', '2026-10-06').map(x => x.key)).toEqual(['ok', 'full', 'late', 'again'])
  })

  it('aviso después de anotarse a todas', () => {
    expect(bookWeekText({ booked: 3, waitlist: 0 })).toEqual(['Te anotaste a {0}', '3 fechas'])
    expect(bookWeekText({ booked: 0, waitlist: 1 })).toEqual(['Quedaste en lista de espera en {0}', '1 fecha'])
    expect(bookWeekText({ booked: 2, waitlist: 1 })).toEqual(['Te anotaste a {0} y quedaste en espera en {1}', '2 fechas', '1 fecha'])
    expect(bookWeekText({ booked: 0, waitlist: 0 })).toEqual(['Ya estabas en todas'])
  })
})
