// @vitest-environment happy-dom
// Clases para el socio: pestaña en Plan solo con clases, lista del día con el botón según el
// estado, anotarse, hoja de la clase, recordatorios y la tarjeta de Inicio.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { setLang } = await import('../lib/i18n.js')
const { default: Clases } = await import('./Clases.jsx')
const { default: HomeClassCard } = await import('../components/HomeClassCard.jsx')
const { classSheet, classRemindersSheet, calendarChoiceSheet } = await import('../components/ClassSheet.jsx')

const TODAY = '2026-10-05'
const occ = (extra = {}) => ({
  key: 's1:' + TODAY, classId: 'c1', slotId: 's1', sessionId: null, date: TODAY, start: '19:00', end: '19:45', movedFrom: null,
  teacherName: 'Caro', room: 'Sala 2', cancelled: false, name: 'Spinning', color: '#ff9f0a', icon: 'bike', description: 'Pedaleo',
  durationMin: 45, logMode: 'muscles', log: { muscles: ['quadriceps'], intensity: 'high' }, capacity: 12, booked: 3, waitlist: 0,
  state: 'open', recurring: false, myBooking: null, ...extra
})
let occurrences
const SLOTS = [{ id: 's3', classId: 'c1', weekday: 3, start: '08:00', recurring: true }, { id: 's1', classId: 'c1', weekday: 1, start: '19:00', recurring: false }]
const listBody = () => ({ enabled: true, today: TODAY, from: TODAY, days: 3, settings: { bookAheadDays: 3, cancelHours: 2 }, reminderDefaults: [60], slots: SLOTS, occurrences })

let container, root
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
const mount = async el => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<MemoryRouter>{el}</MemoryRouter>) })
  for (let i = 0; i < 4; i++) await tick()
}
const buttons = () => [...container.querySelectorAll('button')]
const button = label => buttons().find(b => b.textContent.trim() === label)
// Abre la última hoja en su propio contenedor.
async function openLastSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => { r.render(<MemoryRouter>{sheet.render(() => useUI.getState().closeSheet(sheet.id))}</MemoryRouter>) })
  return { host, unmount: () => act(async () => r.unmount()) }
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  occurrences = [occ(), occ({ key: 's2:' + TODAY, slotId: 's2', start: '08:00', end: '08:45', name: 'Funcional', booked: 12, capacity: 12 }), occ({ key: 's1:2026-10-06', date: '2026-10-06' })]
  apiMock.mockReset()
  apiMock.mockImplementation((url, opts) => {
    if (url === '/api/classes/book-week') return Promise.resolve({ booked: 2, waitlist: 1 })
    if (url.startsWith('/api/classes/book')) return Promise.resolve({ booking: { id: 'b1', status: 'booked', waitlistPos: null, reminders: [60] } })
    if (url.startsWith('/api/classes/reminders')) return Promise.resolve({ booking: { id: 'b1', status: 'booked', reminders: JSON.parse(opts.body).reminders } })
    if (url.startsWith('/api/classes')) return Promise.resolve(listBody())
    return Promise.resolve({})
  })
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ config: { classes_available: true } })
})
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove(); useStore.setState({ config: null }) })

describe('Plan → Clases', () => {
  it('lista del día: hora, profe, sala, cupo y el botón según el estado', async () => {
    await mount(<Clases />)
    const items = [...container.querySelectorAll('.class-item')]
    expect(items.map(i => i.querySelector('.tt').textContent)).toEqual(['Spinning', 'Funcional'])
    expect(items[0].querySelector('.ss').textContent).toBe('Caro · Sala 2 · 3/12')
    expect(items[0].querySelector('button').textContent).toBe('Anotarme')
    expect(items[1].querySelector('button').textContent).toBe('Lista de espera')
    expect(buttons().filter(b => b.getAttribute('role') === 'tab').map(b => b.textContent)).toEqual(['Hoy', 'Mañana', 'Mié 7'])
  })

  it('cambiar de día muestra las de ese día; sin clases, el aviso', async () => {
    await mount(<Clases />)
    await act(async () => { button('Mañana').click() })
    expect(container.querySelectorAll('.class-item')).toHaveLength(1)
    await act(async () => { button('Mié 7').click() })
    expect(container.textContent).toContain('No hay clases este día.')
  })

  it('anotarse llama a la API, avisa y recarga', async () => {
    await mount(<Clases />)
    await act(async () => { container.querySelector('.class-item button').click() })
    await tick()
    expect(apiMock).toHaveBeenCalledWith('/api/classes/book', { method: 'POST', body: JSON.stringify({ slotId: 's1', date: TODAY, sessionId: null }) })
    expect(useUI.getState().toastMsg).toBe('Te anotaste a Spinning')
    expect(apiMock.mock.calls.filter(([u]) => u === '/api/classes').length).toBe(2)
  })
})

describe('hoja de la clase y recordatorios', () => {
  it('anotado: cancelar, fija, recordatorios y calendario', async () => {
    occurrences[0] = occ({ myBooking: { id: 'b1', status: 'booked', waitlistPos: null, reminders: [60] } })
    classSheet(occurrences[0], { today: TODAY })
    const { host, unmount } = await openLastSheet()
    expect(host.textContent).toContain('Cancelar mi lugar')
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(host.textContent).toContain('Fija')
    expect(host.textContent).toContain('Recordatorios: 1 h')
    expect([...host.querySelectorAll('button')].some(b => b.textContent.trim() === 'Agregar a mi calendario')).toBe(true)
    expect(host.textContent).toContain('Intensidad: Alta')
    await unmount(); host.remove()
  })

  it('"Fija": un chip por día de la clase; tocarlo lo agrega o lo saca', async () => {
    classSheet(occ(), { today: TODAY })
    const { host, unmount } = await openLastSheet()
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    const chips = [...host.querySelectorAll('.class-fixed .chip')]
    expect(chips.map(c => [c.textContent, c.getAttribute('aria-pressed')])).toEqual([['Lun 19:00', 'false'], ['Mié 08:00', 'true']])
    await act(async () => { chips[0].click() })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(apiMock).toHaveBeenCalledWith('/api/classes/recurring', { method: 'POST', body: JSON.stringify({ slotId: 's1' }) })
    expect(useUI.getState().toastMsg).toBe('Te anotamos todos los lunes a las 19:00')
    await act(async () => { [...host.querySelectorAll('.class-fixed .chip')][1].click() })
    expect(apiMock).toHaveBeenCalledWith('/api/classes/recurring/delete', { method: 'POST', body: JSON.stringify({ slotId: 's3' }) })
    await unmount(); host.remove()
  })

  it('"Anotarme a todas esta semana": las fechas que faltan y un aviso con lo que pasó', async () => {
    classSheet(occ(), { today: TODAY })
    const { host, unmount } = await openLastSheet()
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(host.querySelector('.class-week .small').textContent).toBe('Hoy 19:00 · Hoy 08:00 · Mañana 19:00')
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Anotarme a todas esta semana').click() })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(apiMock).toHaveBeenCalledWith('/api/classes/book-week', { method: 'POST', body: JSON.stringify({ classId: 'c1' }) })
    expect(useUI.getState().toastMsg).toBe('Te anotaste a 2 fechas y quedaste en espera en 1 fecha')
    await unmount(); host.remove()
  })

  it('sin otras fechas esta semana, no ofrece anotarse a todas', async () => {
    occurrences = [occ()]
    classSheet(occ(), { today: TODAY })
    const { host, unmount } = await openLastSheet()
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(host.querySelector('.class-week')).toBeNull()
    await unmount(); host.remove()
  })

  it('agregar al calendario: Google Calendar con el evento y el .ics para abrir', async () => {
    calendarChoiceSheet(occ(), { id: 'b1' }, 'America/Argentina/Buenos_Aires')
    const { host, unmount } = await openLastSheet()
    const links = [...host.querySelectorAll('a')]
    expect(links.find(a => a.textContent === 'Google Calendar').getAttribute('href')).toContain('calendar.google.com/calendar/render?action=TEMPLATE&text=Spinning')
    const ics = links.find(a => a.getAttribute('href').startsWith('/api/classes/ics'))
    expect(ics.getAttribute('href')).toBe('/api/classes/ics?booking=b1')
    expect(ics.hasAttribute('download')).toBe(false)
    await unmount(); host.remove()
  })

  it('"Cambiar los de entrada en Ajustes" cierra todas las hojas', async () => {
    classSheet(occ(), { today: TODAY })
    classRemindersSheet({ id: 'b1', reminders: [60] })
    expect(useUI.getState().sheets).toHaveLength(2)
    const { host, unmount } = await openLastSheet()
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cambiar los de entrada en Ajustes').click() })
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(window.location.hash).toBe('#/settings')
    await unmount(); host.remove()
  })

  it('recordatorios: se eligen varios y se guardan en el acto', async () => {
    const saved = vi.fn()
    classRemindersSheet({ id: 'b1', reminders: [60] }, { onSaved: saved })
    const { host, unmount } = await openLastSheet()
    expect(host.textContent).toContain('Recordatorios para esta clase')
    const chip = label => [...host.querySelectorAll('.chip')].find(b => b.textContent === label)
    await act(async () => { chip('15 min antes').click() })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(apiMock).toHaveBeenCalledWith('/api/classes/reminders', { method: 'PUT', body: JSON.stringify({ bookingId: 'b1', reminders: [60, 15] }) })
    expect(saved).toHaveBeenCalledWith([60, 15])
    await act(async () => { chip('Sin recordatorio').click() })
    expect(apiMock).toHaveBeenLastCalledWith('/api/classes/reminders', { method: 'PUT', body: JSON.stringify({ bookingId: 'b1', reminders: [] }) })
    await unmount(); host.remove()
  })
})

describe('Inicio', () => {
  // Hora fija: 2026-10-05 12:00 en Buenos Aires (15:00 UTC); la clase de las 19:00 empieza en 7 h.
  const NOW = Date.parse('2026-10-05T15:00:00Z')
  const withTz = () => ({ ...listBody(), tz: 'America/Argentina/Buenos_Aires' })
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); vi.setSystemTime(NOW)
    try { localStorage.removeItem('lauyim_class_suspended_seen') } catch {}
    apiMock.mockImplementation(url => url.startsWith('/api/classes') ? Promise.resolve(withTz()) : Promise.resolve({}))
  })
  afterEach(() => { vi.useRealTimers() })

  it('sin reservas: las clases de hoy en fila; tocar una abre su hoja', async () => {
    occurrences = [occ(), occ({ key: 'g', slotId: 's3', name: 'GAP', start: '20:00', end: '21:00', booked: 12, capacity: 12 }),
      occ({ key: 'y', slotId: 's4', name: 'Yoga', start: '21:00', end: '22:00', capacity: null }), occ({ key: 's1:2026-10-06', date: '2026-10-06' })]
    await mount(<HomeClassCard />)
    expect(container.querySelector('.class-strip-head').textContent).toContain('Clases de hoy')
    const minis = [...container.querySelectorAll('.class-mini')]
    expect(minis.map(m => m.textContent)).toEqual(['19:00SpinningQuedan 9', '20:00GAPLista de espera', '21:00YogaSin cupo'])
    await act(async () => { minis[0].click() })
    const sheet = useUI.getState().sheets.at(-1)
    expect(sheet).toBeTruthy()
    expect(container.textContent).not.toContain('Anotate a una clase')
  })

  it('sin reservas y una sola clase: en renglón, con profe y sala', async () => {
    occurrences = [occ({ key: 's1:2026-10-06', date: '2026-10-06' })]
    await mount(<HomeClassCard />)
    expect(container.querySelector('.class-strip-head').textContent).toContain('Clases de mañana')
    expect(container.querySelector('.class-strip').classList.contains('solo')).toBe(true)
    expect(container.querySelector('.class-mini').textContent).toBe('19:00Spinningcon Caro · Sala 2Quedan 9')
  })

  it('sin reservas ni clases por delante: invita a anotarse', async () => {
    occurrences = []
    await mount(<HomeClassCard />)
    expect(container.textContent).toContain('Anotate a una clase')
  })

  it('ticket con día, número y hora; a menos de 24 h, la cuenta regresiva y el cupo', async () => {
    occurrences = [occ({ myBooking: { id: 'b1', status: 'booked', reminders: [60] }, booked: 9 })]
    await mount(<HomeClassCard />)
    const date = container.querySelector('.class-ticket-date').textContent
    expect(date).toBe('LUN519:00')
    expect(container.querySelector('.class-ticket-name').textContent).toBe('Spinning')
    expect(container.textContent).toContain('Anotado')
    expect(container.querySelector('.class-ticket-clock').textContent).toContain('7 h 00 min')
    expect(container.textContent).toContain('9/12 lugares ocupados')
    expect(container.querySelector('.class-ticket-bar span').style.width).toBe('75%')
  })

  it('con más de 24 h: "en N días" sin cuenta regresiva; cambio de horario a la vista', async () => {
    occurrences = [occ({ date: '2026-10-08', key: 'k', movedFrom: '18:00', myBooking: { id: 'b1', status: 'waitlist', waitlistPos: 2 } })]
    await mount(<HomeClassCard />)
    expect(container.querySelector('.class-ticket-count')).toBeNull()
    expect(container.textContent).toContain('en 3 días')
    expect(container.textContent).toContain('En espera (n.º 2)')
    expect(container.textContent).toContain('Cambió de horario (era 18:00)')
  })

  it('el reloj corre: en la última hora con segundos', async () => {
    occurrences = [occ({ start: '12:30', end: '13:15', myBooking: { id: 'b1', status: 'booked' } })]
    await mount(<HomeClassCard />)
    expect(container.querySelector('.class-ticket-clock').textContent).toContain('30:00')
    await act(async () => { vi.advanceTimersByTime(65000) })
    expect(container.querySelector('.class-ticket-clock').textContent).toContain('28:55')
  })

  it('suspendida: aviso que se cierra y no vuelve', async () => {
    occurrences = [occ({ key: 'sus', cancelled: true, myBooking: { id: 'b1', status: 'cancelled' } })]
    await mount(<HomeClassCard />)
    expect(container.querySelector('.class-suspended').textContent).toContain('Se suspendió Spinning')
    await act(async () => { container.querySelector('.class-suspended button').click() })
    expect(container.querySelector('.class-suspended')).toBeNull()
    expect(JSON.parse(localStorage.getItem('lauyim_class_suspended_seen'))).toEqual(['sus'])
  })

  it('"Mis clases" lista las próximas reservas y las suspendidas', async () => {
    occurrences = [
      occ({ myBooking: { id: 'b1', status: 'booked' } }),
      occ({ key: 'k2', date: '2026-10-06', name: 'GAP', myBooking: { id: 'b2', status: 'waitlist', waitlistPos: 1 } }),
      occ({ key: 'k3', date: '2026-10-07', name: 'Pilates', cancelled: true, myBooking: { id: 'b3', status: 'cancelled' } })
    ]
    await mount(<HomeClassCard />)
    await act(async () => { container.querySelector('.class-ticket-more').click() })
    const sheet = useUI.getState().sheets.at(-1)
    const host = document.createElement('div'); document.body.appendChild(host)
    const r = createRoot(host)
    await act(async () => { r.render(<MemoryRouter>{sheet.render(() => {})}</MemoryRouter>) })
    expect([...host.querySelectorAll('.my-class-row .tt')].map(e => e.textContent)).toEqual(['Spinning', 'GAP', 'Pilates'])
    expect(host.textContent).toContain('Suspendida')
    expect(host.textContent).toContain('Ver todas las clases')
    await act(async () => r.unmount()); host.remove()
  })

  it('no aparece sin clases en el gimnasio', async () => {
    useStore.setState({ config: { classes_available: false } })
    await mount(<HomeClassCard />)
    expect(container.textContent).toBe('')
    expect(apiMock).not.toHaveBeenCalled()
  })
})

describe('la profe', () => {
  const NOW = Date.parse('2026-10-05T15:00:00Z')   // 12:00 en Buenos Aires
  const teachOcc = extra => occ({ teaching: true, booked: 8, waitlist: 2, ...extra })
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); vi.setSystemTime(NOW)
    useStore.setState({ config: { classes_available: true }, user: { id: 'profe', permissions: ['members.view', 'classes.attendance'] } })
    apiMock.mockImplementation(url => {
      if (url === '/api/admin/classes/types') return Promise.resolve({ types: [], slots: [], teachers: [], canManage: false })
      if (url === '/api/admin/users') return Promise.resolve({ users: [{ id: 'ana', name: 'Ana' }] })
      if (url.startsWith('/api/admin/classes/session?')) return Promise.resolve({ occurrence: teachOcc({ sessionId: 'x1' }), canMessage: true, booked: [], waitlist: [] })
      if (url.startsWith('/api/classes')) return Promise.resolve({ ...listBody(), tz: 'America/Argentina/Buenos_Aires' })
      return Promise.resolve({})
    })
  })
  afterEach(() => { vi.useRealTimers(); useStore.setState({ user: null }) })

  it('Inicio: la próxima que da con cupo y la rueda, y las otras de ese día; sin botones de acción', async () => {
    occurrences = [teachOcc(), teachOcc({ key: 'f', name: 'Funcional', start: '08:00', end: '08:45', booked: 5, waitlist: 0 })]
    await mount(<HomeClassCard />)
    const ticket = container.querySelector('.class-ticket.teach')
    expect(ticket.textContent).toContain('Próxima clase que das')
    expect(ticket.querySelector('.class-ticket-name').textContent).toBe('Spinning')
    expect(ticket.textContent).toContain('8/12 anotados · 2 en espera')
    expect([...ticket.querySelectorAll('.class-teach-row .tt')].map(e => e.textContent)).toEqual(['Funcional'])
    expect(ticket.querySelector('.class-teach-row .ss').textContent).toBe('Terminó')
    expect([...ticket.querySelectorAll('.class-gear')].map(b => b.getAttribute('aria-label'))).toEqual(['Gestionar Spinning', 'Gestionar Funcional'])
    expect(container.textContent).not.toContain('Anotate a una clase')
  })

  it('tocar la clase abre su hoja de profe: cuántos hay, cuánto falta y la rueda', async () => {
    occurrences = [teachOcc()]
    await mount(<HomeClassCard />)
    await act(async () => { container.querySelector('.class-ticket.teach .class-ticket-main').click() })
    const { host, unmount } = await openLastSheet()
    expect(host.textContent).toContain('La das vos')
    expect([...host.querySelectorAll('.class-teach-stats b')].map(b => b.textContent)).toEqual(['8/12', '2', '7 h 00 min'])
    expect(host.textContent).not.toContain('Anotarme')
    expect(host.textContent).not.toContain('Fija')
    expect(host.querySelector('.class-gear')).toBeTruthy()
    // Quiénes vienen: los anotados de la fecha.
    expect(host.textContent).toContain('Nadie anotado todavía.')
    await unmount(); host.remove()
  })

  it('la rueda abre la gestión de la fecha (con los socios para anotar a mano)', async () => {
    occurrences = [teachOcc()]
    await mount(<HomeClassCard />)
    const before = useUI.getState().sheets.length
    await act(async () => { container.querySelector('.class-ticket.teach .class-gear').click() })
    // La hoja del panel se carga recién al tocar la rueda.
    for (let i = 0; i < 50 && useUI.getState().sheets.length === before; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(apiMock).toHaveBeenCalledWith('/api/admin/classes/types')
    expect(apiMock).toHaveBeenCalledWith('/api/admin/users')
    expect(useUI.getState().sheets.length).toBe(before + 1)
    const { host, unmount } = await openLastSheet()
    expect(host.textContent).toContain('Mandar un mensaje a los anotados')
    await unmount(); host.remove()
  })

  it('Plan → Clases: la que da muestra "La das vos" y la rueda en lugar de "Anotarme"', async () => {
    occurrences = [teachOcc(), occ({ key: 'o', slotId: 's2', name: 'Pilates', start: '20:00', end: '21:00' })]
    await mount(<Clases />)
    const items = [...container.querySelectorAll('.class-item')]
    expect(items[0].textContent).toContain('La das vos')
    expect(items[0].querySelector('.class-gear')).toBeTruthy()
    expect(items[0].textContent).not.toContain('Anotarme')
    expect(items[1].querySelector('button').textContent).toBe('Anotarme')
  })
})

