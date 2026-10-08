// @vitest-environment happy-dom
// La hoja del día: qué ofrece según la fecha, que nunca borra un entreno, y cómo se llega a ella.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
vi.mock('../../lib/onboarding.js', () => ({ startTourA: () => {} }))

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { setLang } = await import('../../lib/i18n.js')
const { dayOverrideSheet, calendarSheet, workoutDetailSheet, WorkoutRow } = await import('../../sheets.jsx')

const TODAY = '2026-10-05'   // lunes
const PAST = '2026-09-28'    // lunes anterior: tocaba Piernas
const FUTURE = '2026-10-12'  // lunes que viene
const piernas = { id: 'r1', name: 'Piernas', emoji: 'legs', ex: [{ id: '0024', sets: 3 }] }
const live = (id, d) => ({ id, d, start: Date.parse(d + 'T15:00:00Z'), end: Date.parse(d + 'T16:00:00Z'), name: 'Piernas', routineId: 'r1', vol: 1200, entries: [{ id: '0024', sets: [{ done: true, w: 100, r: 5 }] }] })

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
async function openLastSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => { r.render(<MemoryRouter>{sheet.render(() => useUI.getState().closeSheet(sheet.id))}</MemoryRouter>) })
  for (let i = 0; i < 4; i++) await tick()
  return { host, unmount: async () => { await act(async () => r.unmount()); host.remove() } }
}
const btn = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const item = (host, text) => [...host.querySelectorAll('.item')].find(i => i.textContent.includes(text))
const setS = patch => useStore.setState({ S: { ...useStore.getState().S, routines: [piernas], week: { 1: 'r1' }, dayPlan: {}, workouts: [], effort: 'none', onboardingCompletado: true, planIniciado: true, ...patch } })

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 5, 12, 0))
  apiMock.mockReset()
  apiMock.mockImplementation(() => Promise.resolve({}))
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ config: { classes_available: false }, user: { id: 'socio' }, healthConsent: 'declined' })
  setS()
})
afterEach(() => { vi.useRealTimers(); useStore.setState({ config: null }) })

describe('hoja del día: planificar', () => {
  it('hoy: elegir otra rutina o descanso solo cambia el plan, no borra el entreno', async () => {
    setS({ workouts: [live('t1', TODAY)] })
    dayOverrideSheet(TODAY)
    const { host, unmount } = await openLastSheet()
    await act(async () => { item(host, 'Descansar / saltar este día').click() })
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['t1'])
    await unmount()
  })
})

describe('hoja del día: registrar', () => {
  it('pasado con un entreno: lo muestra y no ofrece nada que lo borre ni planificar', async () => {
    setS({ workouts: [live('t1', PAST)] })
    dayOverrideSheet(PAST)
    const { host, unmount } = await openLastSheet()
    expect(host.querySelector('.day-workouts').textContent).toContain('Piernas')
    expect(host.querySelector('.day-plan')).toBeNull()
    expect(item(host, 'Descansar / saltar este día')).toBeUndefined()
    expect(btn(host, 'Agregar otro entrenamiento')).toBeTruthy()
    expect(btn(host, 'Entrené')).toBeUndefined()
    await act(async () => { btn(host, 'Agregar otro entrenamiento').click() })
    expect(btn(host, 'Entrené')).toBeTruthy()
    expect(btn(host, 'No entrené')).toBeUndefined()   // ese día ya entrenó: es cancelar, no "no entrené"
    await act(async () => { btn(host, 'Cancelar').click() })
    expect(useUI.getState().sheets).toHaveLength(1)   // la hoja sigue abierta
    expect(btn(host, 'Agregar otro entrenamiento')).toBeTruthy()
    await unmount()
  })

  it('pasado sin nada: "Entrené" con la rutina planificada elegida; marcar agrega un marcado sin series', async () => {
    dayOverrideSheet(PAST)
    const { host, unmount } = await openLastSheet()
    expect(host.querySelector('.day-tocaba').textContent).toBe('Tocaba: Piernas')
    await act(async () => { btn(host, 'Entrené').click() })
    expect(btn(host, 'Piernas').getAttribute('aria-pressed')).toBe('true')
    await act(async () => { btn(host, 'Marcar como entrenado').click() })
    const [w] = useStore.getState().S.workouts
    expect(w).toMatchObject({ d: PAST, routineId: 'r1', name: 'Piernas', marked: true, entries: [], vol: 0 })
    expect(w.end).toBe(w.start)
    expect(useStore.getState().S.dayPlan[PAST]).toBeUndefined()   // el workout es lo que vale
    await unmount()
  })

  it('un día que no tenía rutina: no hay nada elegido y no se puede marcar hasta elegir', async () => {
    const sunday = '2026-09-27'
    dayOverrideSheet(sunday)
    const { host, unmount } = await openLastSheet()
    expect(host.querySelector('.day-tocaba').textContent).toBe('Tocaba: descanso')
    await act(async () => { btn(host, 'Entrené').click() })
    expect(host.querySelectorAll('.chip[aria-pressed="true"]')).toHaveLength(0)
    expect(btn(host, 'Marcar como entrenado').disabled).toBe(true)
    await act(async () => { btn(host, 'Otra cosa').click() })
    await act(async () => { btn(host, 'Marcar como entrenado').click() })
    expect(useStore.getState().S.workouts[0].routineId).toBeNull()
    await unmount()
  })

  it('"No entrené" cierra sin escribir nada', async () => {
    dayOverrideSheet(PAST)
    const { host, unmount } = await openLastSheet()
    await act(async () => { btn(host, 'No entrené').click() })
    expect(useStore.getState().S.workouts).toEqual([])
    expect(useUI.getState().sheets).toHaveLength(0)
    await unmount()
  })

  it('"Cargar series" abre el editor con la rutina elegida', async () => {
    dayOverrideSheet(PAST)
    const { host, unmount } = await openLastSheet()
    await act(async () => { btn(host, 'Entrené').click() })
    await act(async () => { btn(host, 'Cargar series (opcional)').click() })
    const sheets = useUI.getState().sheets
    expect(sheets).toHaveLength(1)
    expect(sheets[0].kind).toBe('panel')
    await unmount()
  })

  it('un marcado del día ofrece cargar series', async () => {
    setS({ workouts: [{ id: 'm1', d: PAST, start: Date.parse(PAST + 'T15:00:00Z'), end: Date.parse(PAST + 'T15:00:00Z'), name: 'Piernas', routineId: 'r1', marked: true, entries: [], vol: 0 }] })
    dayOverrideSheet(PAST)
    const { host, unmount } = await openLastSheet()
    expect(host.querySelector('.day-workouts').textContent).toContain('Marcado')
    expect(host.querySelector('.day-workouts').textContent).toContain('Sin series · cuenta para tu racha')
    expect(btn(host, 'Cargar series')).toBeTruthy()
    await unmount()
  })

  it('futuro: solo planificar, sin marcar', async () => {
    dayOverrideSheet(FUTURE)
    const { host, unmount } = await openLastSheet()
    expect(btn(host, 'Entrené')).toBeUndefined()
    expect(host.querySelector('.day-tocaba')).toBeNull()
    expect(host.querySelector('.day-plan')).toBeTruthy()
    expect(item(host, 'Marcar como realizado en esta fecha')).toBeUndefined()
    await unmount()
  })

  it('hoy: registrar y planificar', async () => {
    dayOverrideSheet(TODAY)
    const { host, unmount } = await openLastSheet()
    expect(btn(host, 'Entrené')).toBeTruthy()
    expect(host.querySelector('.day-plan')).toBeTruthy()
    await unmount()
  })
})

describe('el marcado en el calendario, el historial y el detalle', () => {
  const marked = { id: 'm1', d: PAST, start: Date.parse(PAST + 'T15:00:00Z'), end: Date.parse(PAST + 'T15:00:00Z'), name: 'Piernas', routineId: 'r1', marked: true, entries: [], vol: 0 }

  it('el calendario abre siempre la hoja del día, aunque el día tenga un entreno', async () => {
    setS({ workouts: [live('t1', PAST)] })
    calendarSheet(PAST)
    const cal = await openLastSheet()
    const day = [...cal.host.querySelectorAll('.cal-d')].find(b => b.querySelector('span')?.textContent === '28')
    await act(async () => { day.click() })
    await cal.unmount()
    const sheet = await openLastSheet()
    expect(sheet.host.querySelector('.day-sheet')).toBeTruthy()
    await sheet.unmount()
  })

  it('el historial etiqueta el marcado', async () => {
    setS({ workouts: [marked] })
    const host = document.createElement('div'); document.body.appendChild(host)
    const r = createRoot(host)
    await act(async () => { r.render(<WorkoutRow w={marked} onClick={() => {}} />) })
    expect(host.querySelector('.tt').textContent).toContain('Marcado')
    expect(host.querySelector('.ss').textContent).toContain('Sin series')
    expect(host.querySelector('.ss').textContent).not.toContain('0 series')
    await act(async () => r.unmount()); host.remove()
  })

  it('el detalle de un marcado sin series ofrece cargarlas y no "Repetir"', async () => {
    setS({ workouts: [marked] })
    workoutDetailSheet(marked)
    const { host, unmount } = await openLastSheet()
    expect(btn(host, 'Cargar series')).toBeTruthy()
    expect(btn(host, 'Repetir este entreno')).toBeUndefined()
    await act(async () => { btn(host, 'Cargar series').click() })
    expect(useUI.getState().sheets.at(-1).kind).toBe('panel')
    await unmount()
  })
})
