// @vitest-environment happy-dom
// Las clases en la semana de Inicio, en "Hoy" (con la rutina, sin reemplazarla, y el aviso de
// músculos), en la racha, en la hoja del día (que no las borra al elegir otra cosa) y en el
// calendario.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
vi.mock('../lib/onboarding.js', () => ({ startTourA: () => {} }))

const { useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { setLang } = await import('../lib/i18n.js')
const { default: Home } = await import('./Home.jsx')
const { dayOverrideSheet, calendarSheet } = await import('../sheets.jsx')
const { myClassesList } = await import('../components/useMyClasses.js')
const { classesByDate, classOverlap } = await import('../lib/classes.js')

const TODAY = '2026-10-05'   // lunes
const piernas = { id: 'r1', name: 'Piernas', emoji: 'legs', ex: [{ id: 'leg-1', sets: 4, muscleWeights: { quadriceps: 1, gluteal: 0.6 } }] }
const occ = extra => ({ key: 's1:' + TODAY, classId: 'c1', slotId: 's1', sessionId: 'x1', date: TODAY, start: '19:00', end: '19:45', durationMin: 45, name: 'Spinning', color: '#ff9f0a',
  cancelled: false, state: 'open', capacity: 12, booked: 3, waitlist: 0, log: { muscles: ['quadriceps', 'calves'], intensity: 'high' }, myBooking: { id: 'b1', status: 'booked' }, ...extra })
const classWorkout = (id, d, extra) => ({ id, d, start: Date.parse(d + 'T22:00:00Z'), end: Date.parse(d + 'T22:45:00Z'), name: 'Spinning', kind: 'class', classBookingId: 'bx-' + id, teacher: 'Caro', entries: [], muscleLoad: { muscles: ['quadriceps'], intensity: 'high' }, ...extra })
let occurrences

let container, root
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
const mount = async el => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<MemoryRouter>{el}</MemoryRouter>) })
  for (let i = 0; i < 4; i++) await tick()
}
async function openLastSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => { r.render(<MemoryRouter>{sheet.render(() => useUI.getState().closeSheet(sheet.id))}</MemoryRouter>) })
  for (let i = 0; i < 4; i++) await tick()
  return { host, unmount: async () => { await act(async () => r.unmount()); host.remove() } }
}
const setS = patch => useStore.setState({ S: { ...useStore.getState().S, routines: [piernas], week: { 1: 'r1' }, dayPlan: {}, workouts: [], onboardingCompletado: true, planIniciado: true, ...patch } })

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 5, 12, 0))
  occurrences = [occ()]
  apiMock.mockReset()
  apiMock.mockImplementation(url => url.startsWith('/api/classes') ? Promise.resolve({ enabled: true, today: TODAY, tz: null, settings: { cancelHours: 2 }, occurrences }) : Promise.resolve({}))
  await myClassesList({ force: true })
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ config: { classes_available: true }, user: { id: 'socio' }, healthConsent: 'declined' })
  setS()
})
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove(); vi.useRealTimers(); useStore.setState({ config: null }) })

describe('clases en las vistas', () => {
  it('helpers: clases por fecha (reservadas y hechas, sin duplicar) y músculos compartidos', () => {
    const byDate = classesByDate([occ(), occ({ key: 'k2', date: '2026-10-07', myBooking: { id: 'b2', status: 'waitlist' } }), occ({ key: 'k3', myBooking: null })],
      [classWorkout('w1', '2026-10-03'), classWorkout('w2', TODAY, { classBookingId: 'b1' })])
    expect(Object.keys(byDate).sort()).toEqual(['2026-10-03', '2026-10-05', '2026-10-07'])
    expect(byDate[TODAY].map(c => [c.name, c.done, c.color])).toEqual([['Spinning', true, '#ff9f0a']])   // la reserva b1 ya está hecha
    expect(byDate['2026-10-07'][0].waitlist).toBe(true)
    expect(classOverlap(['quadriceps', 'calves'], { quadriceps: 4, gluteal: 2.4, abs: 0.5 })).toEqual(['quadriceps'])
    expect(classOverlap(['biceps'], { quadriceps: 4 })).toEqual([])
  })

  it('Hoy: la rutina sigue pendiente con la clase debajo y el aviso de músculos; punto de clase en la semana', async () => {
    await mount(<Home />)
    const row = container.querySelector('.today-row')
    expect(row.querySelector('.ttl').textContent).toBe('Piernas')
    expect(row.querySelector('.today-classes').textContent).toBe('También hoy: Spinning 19:00')
    expect(row.querySelector('.today-overlap').textContent).toBe('Spinning también trabaja cuádriceps.')
    const monday = container.querySelectorAll('.wday')[0]
    expect(monday.querySelector('.wic.cls').style.color).toBeTruthy()
    expect(monday.querySelector('.wic.plan')).toBeTruthy()   // la rutina planeada, tenue
  })

  it('una clase hecha no da por hecha la rutina; la racha cuenta la clase', async () => {
    setS({ workouts: [classWorkout('w1', TODAY, { classBookingId: 'b1' })] })
    await mount(<Home />)
    const row = container.querySelector('.today-row')
    expect(row.querySelector('.ttl').textContent).toBe('Piernas')
    expect(row.querySelector('.today-classes').textContent).toBe('También hoy: Spinning 19:00 ✓')
    expect(container.querySelector('.week-progress').textContent).toBe('Semana cumplida ✓ · 1 clase')
    expect(container.querySelector('.streak-chip').textContent).toBe('1')
    expect(container.querySelectorAll('.wday')[0].classList.contains('trained')).toBe(true)
  })

  it('sin rutina hoy, la clase hecha es lo de hoy', async () => {
    setS({ week: {}, workouts: [classWorkout('w1', TODAY, { classBookingId: 'b1' })] })
    await mount(<Home />)
    expect(container.querySelector('.today-row .ttl').textContent).toContain('Spinning')
    expect(container.querySelector('.today-classes')).toBeNull()
  })

  it('hoja del día: muestra las clases y elegir descanso no las borra', async () => {
    setS({ workouts: [classWorkout('w1', TODAY, { classBookingId: 'b1' }), { id: 't1', d: TODAY, start: 1, end: 2, name: 'Piernas', routineId: 'r1', entries: [] }] })
    dayOverrideSheet(TODAY)
    const { host, unmount } = await openLastSheet()
    expect(host.querySelector('.day-classes').textContent).toContain('Spinning')
    await act(async () => { [...host.querySelectorAll('.item')].find(i => i.textContent.includes('Descansar / saltar este día')).click() })
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['w1'])
    await unmount()
  })

  it('solo una clase hecha: un único ícono (el de la clase), sin el de rutina', async () => {
    setS({ week: {}, workouts: [classWorkout('w1', TODAY, { classBookingId: 'b1' })] })
    await mount(<Home />)
    const icons = container.querySelectorAll('.wday')[0].querySelectorAll('.wday-ic > *')
    expect([...icons].map(d => d.className)).toEqual(['wic cls'])
  })

  it('la llama abre la hoja de la racha, con lo que falta esta semana', async () => {
    setS({ week: { 1: 'r1', 3: 'r1' }, workouts: [{ id: 'p1', d: TODAY, start: 1, end: 2, name: 'Piernas', routineId: 'r1', entries: [] }] })
    await mount(<Home />)
    await act(async () => { container.querySelector('.streak-chip').click() })
    const { host, unmount } = await openLastSheet()
    expect(host.querySelector('.streak-num').textContent).toBe('Empezá tu racha')
    expect(host.querySelector('.streak-now-head').textContent).toBe('Esta semana · 1 de 2')
    expect(host.querySelector('.streak-left').textContent).toBe('Falta 1: el miércoles')
    expect([...host.querySelectorAll('.streak-day')].map(d => d.className.replace('streak-day', '').trim())).toEqual(['done today', '', 'plan', '', '', '', ''])
    expect(container.querySelector('.streak-chip').classList.contains('lv0')).toBe(true)
    await unmount()
  })

  it('la semana muestra las clases guardadas en el dispositivo sin esperar la red', async () => {
    localStorage.setItem('lauyim_my_classes', JSON.stringify({ userId: 'socio', data: { today: TODAY, occurrences: [occ()] } }))
    apiMock.mockImplementation(() => new Promise(() => {}))   // la red no contesta
    myClassesList({ force: true })   // queda pendiente: lo que se ve es lo guardado
    await mount(<Home />)
    expect(container.querySelector('.today-classes').textContent).toContain('Spinning 19:00')
    localStorage.removeItem('lauyim_my_classes')
  })

  it('calendario: llama al final de la semana cumplida; tocarla abre la racha', async () => {
    setS({ workouts: [{ id: 'p1', d: TODAY, start: 1, end: 2, name: 'Piernas', routineId: 'r1', entries: [] }] })
    calendarSheet(TODAY)
    const { host, unmount } = await openLastSheet()
    const flames = host.querySelectorAll('.cal-wk.on')
    expect(flames).toHaveLength(1)
    await act(async () => { flames[0].click() })
    await unmount()
    const streak = await openLastSheet()
    expect(streak.host.querySelector('.streak-num').textContent).toBe('1 semana seguida')
    await streak.unmount()
  })

  it('calendario: punto de clase en el día', async () => {
    calendarSheet(TODAY)
    const { host, unmount } = await openLastSheet()
    const day5 = [...host.querySelectorAll('.cal-d')].find(b => b.querySelector('span')?.textContent === '5')
    expect(day5.classList.contains('cls')).toBe(true)
    await unmount()
  })
})
