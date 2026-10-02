import { describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
vi.mock('./api.js', () => ({ api: apiMock }))

const { REMINDER_OPTIONS, reminderLabel, buttonState, capacityText, timeRange, dayChips, conflictMessages, intensityLabel, googleCalendarUrl, classesApi, zonedToEpoch, countdown, homeClasses, classSlotChips, weekBookable, bookWeekText, teacherHome, spotsText, homeStrip, shortName, shareListText, periodStart, markPlanFull, planLine, planLimitLabel, liveClasses } = await import('./classes.js')

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

describe('Inicio de la profe', () => {
  const TZ = 'America/Argentina/Buenos_Aires'
  const o = (key, date, start, extra) => ({ key, date, start, durationMin: 60, teaching: true, cancelled: false, ...extra })
  const occs = [
    o('late', '2026-10-05', '19:30'), o('early', '2026-10-05', '08:00'), o('tom', '2026-10-06', '10:00'),
    o('sus', '2026-10-05', '12:00', { cancelled: true }), o('other', '2026-10-05', '18:00', { teaching: false })
  ]
  it('la próxima que da y las otras de ese día, también las que terminaron', () => {
    const r = teacherHome(occs, Date.parse('2026-10-05T15:00:00Z'), TZ)   // 12:00 en Buenos Aires
    expect([r.next.key, r.sameDay.map(x => x.key)]).toEqual(['late', ['early']])
    expect(r.over(r.sameDay[0])).toBe(true)
  })
  it('terminadas las de hoy, la de mañana; sin clases que da, nada', () => {
    expect(teacherHome(occs, Date.parse('2026-10-06T00:00:00Z'), TZ).next.key).toBe('tom')
    expect(teacherHome(occs.map(x => ({ ...x, teaching: false })), Date.parse('2026-10-05T15:00:00Z'), TZ)).toMatchObject({ next: null, sameDay: [] })
  })
})

describe('sin cupo y fila de Inicio', () => {
  it('sin cupo: el número solo y nunca lista de espera', () => {
    expect(capacityText(30, null)).toBe('30')
    expect(buttonState({ state: 'open', booked: 300, capacity: null, myBooking: null }).key).toBe('book')
  })

  it('lugares para el socio', () => {
    expect(spotsText({ booked: 3, capacity: null })).toEqual(['Sin cupo'])
    expect(spotsText({ booked: 8, capacity: 12 })).toEqual(['Quedan {0}', 4])
    expect(spotsText({ booked: 11, capacity: 12 })).toEqual(['Queda 1'])
    expect(spotsText({ booked: 12, capacity: 12 })).toEqual(['Lista de espera'])
  })

  it('fila de Inicio: el primer día con clases por delante, sin las terminadas, suspendidas ni las que da', () => {
    const TZ = 'America/Argentina/Buenos_Aires'
    const o = (key, date, start, extra) => ({ key, date, start, durationMin: 60, cancelled: false, ...extra })
    const occs = [o('pm', '2026-10-05', '19:00'), o('am', '2026-10-05', '08:00'), o('sus', '2026-10-05', '20:00', { cancelled: true }),
      o('mine', '2026-10-05', '18:00', { teaching: true }), o('tom', '2026-10-06', '09:00')]
    expect(homeStrip(occs, Date.parse('2026-10-05T15:00:00Z'), TZ)).toMatchObject({ date: '2026-10-05', items: [{ key: 'pm' }] })
    expect(homeStrip(occs, Date.parse('2026-10-06T01:00:00Z'), TZ)).toMatchObject({ date: '2026-10-06', items: [{ key: 'tom' }] })
    expect(homeStrip([], Date.now(), TZ)).toEqual({ date: null, items: [] })
  })
})

describe('compartir la lista', () => {
  const occ = { name: 'Spinning', date: '2026-10-05', start: '19:00', room: 'Sala 2', teacherName: 'Caro', capacity: 12 }
  const booked = [{ name: 'Ana Pérez', status: 'booked' }, { name: 'Beto Ruiz Díaz', status: 'booked' }, { name: 'Lu', status: 'booked' }]
  it('nombre e inicial', () => {
    expect([shortName('Ana Pérez'), shortName('beto ruiz díaz'), shortName('Lu'), shortName('  ')]).toEqual(['Ana P.', 'beto D.', 'Lu', ''])
  })
  it('el texto: encabezado, anotados con cupo y en espera; nombre completo si se elige', () => {
    expect(shareListText({ occ, booked, waitlist: [{ name: 'Cami López' }] })).toBe(
      'Spinning · Lun 5/10 · 19:00 · Sala 2\nProfe: Caro\n\nAnotados (3/12):\n1. Ana P.\n2. Beto D.\n3. Lu\n\nEn espera:\n1. Cami L.')
    expect(shareListText({ occ, booked, full: true })).toContain('2. Beto Ruiz Díaz')
  })
  it('sin cupo, sin anotados y con la lista tomada', () => {
    expect(shareListText({ occ: { ...occ, capacity: null, room: '', teacherName: '' }, booked: [] })).toBe('Spinning · Lun 5/10 · 19:00\n\nAnotados (0):\nTodavía no hay nadie anotado.')
    expect(shareListText({ occ, booked: [{ name: 'Ana Pérez', status: 'attended' }, { name: 'Beto Ruiz', status: 'absent' }] })).toContain('1. Ana P. ✓\n2. Beto R. ✗')
  })
})

describe('límite de clases por plan', () => {
  const planLimit = { limit: 2, period: 'week', used: { '2026-10-05': 2, '2026-10-12': 1 } }
  it('inicio del período: lunes de la semana o día 1 del mes', () => {
    expect([periodStart('2026-10-11', 'week'), periodStart('2026-10-05', 'week'), periodStart('2026-10-31', 'month')]).toEqual(['2026-10-05', '2026-10-05', '2026-10-01'])
  })
  it('marca las fechas sin reserva propia de las semanas completas; el botón queda apagado', () => {
    const occs = [
      { key: 'a', date: '2026-10-07', myBooking: null }, { key: 'b', date: '2026-10-07', myBooking: { status: 'booked' } },
      { key: 'c', date: '2026-10-13', myBooking: null }, { key: 'd', date: '2026-10-08', myBooking: null, teaching: true }
    ]
    expect(markPlanFull(occs, planLimit).filter(o => o.planFull).map(o => o.key)).toEqual(['a'])
    expect(markPlanFull(occs, null)).toBe(occs)
    expect(buttonState({ state: 'open', booked: 1, capacity: 10, myBooking: null, planFull: true })).toMatchObject({ key: 'plan', label: 'Límite del plan', disabled: true })
    expect(weekBookable([{ key: 'x', classId: 'c1', date: '2026-10-07', state: 'open', planFull: true }], 'c1', '2026-10-05')).toEqual([])
  })
  it('la línea: cuántas quedan, esta o esa semana, y el mes', () => {
    expect(planLine(planLimit, '2026-10-13', '2026-10-06')).toEqual(['Te quedan {0} de {1} clases {2}', 1, 2, 'esa semana'])
    expect(planLine(planLimit, '2026-10-07', '2026-10-06')).toEqual(['Ya usaste tus {0} clases de {1}', 2, 'esta semana'])
    expect(planLine({ limit: 1, period: 'month', used: {} }, '2026-10-20', '2026-10-06')).toEqual(['Te queda 1 clase {0}', 'este mes'])
    expect(planLine(null, '2026-10-07', '2026-10-06')).toBeNull()
    expect(planLimitLabel({ limit: 8, period: 'month' })).toBe('8 clases por mes')
  })
})

describe('clases en curso', () => {
  it('las reservadas o presentes que empezaron y no terminaron', () => {
    const TZ = 'America/Argentina/Buenos_Aires'
    const o = (key, start, extra) => ({ key, date: '2026-10-05', start, durationMin: 60, cancelled: false, myBooking: { status: 'booked' }, ...extra })
    const occs = [o('now', '11:30'), o('later', '13:00'), o('done', '10:00'), o('mine', '11:45', { myBooking: { status: 'attended' } }), o('other', '11:40', { myBooking: null }), o('sus', '11:50', { cancelled: true })]
    expect(liveClasses(occs, Date.parse('2026-10-05T15:00:00Z'), TZ).map(x => x.key)).toEqual(['now', 'mine'])   // 12:00 en Buenos Aires
  })
})
