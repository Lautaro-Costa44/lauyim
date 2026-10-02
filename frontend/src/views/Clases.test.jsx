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
const { default: HomeClassCard, nextBooked } = await import('../components/HomeClassCard.jsx')
const { classSheet, classRemindersSheet } = await import('../components/ClassSheet.jsx')

const TODAY = '2026-10-05'
const occ = (extra = {}) => ({
  key: 's1:' + TODAY, classId: 'c1', slotId: 's1', sessionId: null, date: TODAY, start: '19:00', end: '19:45', movedFrom: null,
  teacherName: 'Caro', room: 'Sala 2', cancelled: false, name: 'Spinning', color: '#ff9f0a', icon: 'bike', description: 'Pedaleo',
  durationMin: 45, logMode: 'muscles', log: { muscles: ['quadriceps'], intensity: 'high' }, capacity: 12, booked: 3, waitlist: 0,
  state: 'open', recurring: false, myBooking: null, ...extra
})
let occurrences
const listBody = () => ({ enabled: true, today: TODAY, from: TODAY, days: 3, settings: { bookAheadDays: 3, cancelHours: 2 }, reminderDefaults: [60], occurrences })

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
  it('anotado: cancelar, todas las semanas, recordatorios y calendario', async () => {
    classSheet(occ({ myBooking: { id: 'b1', status: 'booked', waitlistPos: null, reminders: [60] } }), { today: TODAY })
    const { host, unmount } = await openLastSheet()
    expect(host.textContent).toContain('Cancelar mi lugar')
    expect(host.textContent).toContain('Todas las semanas')
    expect(host.textContent).toContain('Recordatorios: 1 h')
    expect(host.querySelector('a[download]').getAttribute('href')).toBe('/api/classes/ics?booking=b1')
    expect(host.textContent).toContain('Intensidad: Alta')
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
  it('sin reservas: "Ver clases"; con reserva: la próxima', async () => {
    await mount(<HomeClassCard />)
    expect(container.textContent).toContain('Ver clases')
    await act(async () => { root.unmount() }); container.remove()
    occurrences = [occ({ myBooking: { id: 'b1', status: 'booked', reminders: [60] } })]
    await mount(<HomeClassCard />)
    expect(container.textContent).toContain('Tu próxima clase')
    expect(container.textContent).toContain('Spinning · Hoy 19:00')
    expect(container.textContent).toContain('Anotado')
  })

  it('no aparece sin clases en el gimnasio', async () => {
    useStore.setState({ config: { classes_available: false } })
    await mount(<HomeClassCard />)
    expect(container.textContent).toBe('')
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('nextBooked ignora las empezadas, canceladas y la lista cancelada', () => {
    expect(nextBooked([occ({ state: 'started', myBooking: { status: 'booked' } }), occ({ myBooking: { status: 'cancelled' } }), occ({ key: 'x', myBooking: { status: 'waitlist' } })]).key).toBe('x')
  })
})
