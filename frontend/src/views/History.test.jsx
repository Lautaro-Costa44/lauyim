// @vitest-environment happy-dom
// Historial del socio: lista agrupada, detalle al lado en escritorio y "Repetir este entreno".
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/nav.js', () => ({ nav: navMock, setNav: () => {} }))
let desktop = false
window.matchMedia = q => ({ matches: q.includes('min-width: 1000px') ? desktop : false, media: q, addEventListener() {}, removeEventListener() {} })

const { useStore, DEF } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { repeatWorkout } = await import('../sheets.jsx')
const { default: History } = await import('./History.jsx')
const { HashRouter } = await import('react-router-dom')
const { setLang } = await import('../lib/i18n.js')

// Ejercicios de la biblioteca de verdad (ids del dataset), para que EXIDX los conozca.
const BENCH = '0025', SQUAT = '0043'
const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const PAST = {
  id: 'w1', d: '2026-09-10', start: Date.parse('2026-09-10T18:00:00Z'), end: Date.parse('2026-09-10T19:00:00Z'), name: 'Push', routineId: 'r1', vol: 1200,
  entries: [
    { id: BENCH, target: { id: BENCH, sets: 3, reps: 8 }, sets: [set(20, 10, { phase: 'warmup' }), set(60, 8), set(55, 8, { type: 'dropset', drops: [{ w: 45, r: 6, done: true }] }), { w: 99, r: 1, done: false }] },
    { id: 'ya-no-existe', n: 'Máquina vieja', sets: [set(30, 12)] },
  ]
}
const state = over => ({ ...JSON.parse(JSON.stringify(DEF)), routines: [{ id: 'r1', name: 'Push', emoji: 'dumbbell', ex: [] }], workouts: [PAST], ...over })
const toasts = () => useUI.getState().toastMsg || ''

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  navMock.mockClear()
  useUI.setState({ sheets: [], toastMsg: '' })
})

describe('Repetir este entreno', () => {
  it('mismos ejercicios con los pesos y reps de esa vez, sin marcar; calentamiento y drop set igual; omite lo que ya no existe', () => {
    useStore.setState({ S: state(), user: null })
    expect(repeatWorkout(PAST)).toBe(true)
    const A = useStore.getState().S.active
    expect(A.routineId).toBe('r1')
    expect(A.entries.map(e => e.id)).toEqual([BENCH])
    const sets = A.entries[0].sets
    expect(sets.map(s => [s.w, s.r, s.done])).toEqual([[20, 10, false], [60, 8, false], [55, 8, false]])   // solo las que se hicieron
    expect(sets[0].phase).toBe('warmup')
    expect(sets[2]).toMatchObject({ type: 'dropset', drops: [{ w: 45, r: 6, done: false }] })
    expect(toasts()).toContain('Máquina vieja')
    expect(navMock).toHaveBeenCalledWith('/workout')
  })

  it('rutina borrada: arranca como entreno libre, con aviso', () => {
    useStore.setState({ S: state({ routines: [] }), user: null })
    repeatWorkout(PAST)
    expect(useStore.getState().S.active.routineId).toBeNull()
    expect(toasts()).toContain('arranca como entreno libre')
  })

  it('con un entreno en curso avisa y no pisa nada', () => {
    const active = { id: 'act', entries: [], name: 'En curso' }
    useStore.setState({ S: state({ active }), user: null })
    expect(repeatWorkout(PAST)).toBe(false)
    expect(useStore.getState().S.active).toEqual(active)
    expect(toasts()).toContain('Ya tenés un entreno en curso')
    expect(navMock).not.toHaveBeenCalled()
  })
})

describe('Historial', () => {
  let root, container
  const mount = async () => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<HashRouter><History /></HashRouter>) })
  }
  afterEach(async () => { await act(async () => { root.unmount() }); container.remove(); desktop = false })

  it('escritorio: tocar un entreno lo muestra al lado, con la nota editable y las acciones del socio', async () => {
    desktop = true
    useStore.setState({ S: state(), user: null, healthConsent: 'granted' })
    await mount()
    expect(container.textContent).toContain('Elegí un entreno para ver el detalle')
    await act(async () => { container.querySelector('.wh-row').click() })
    const detail = container.querySelector('.wh-split-detail')
    expect(detail.querySelector('.wd')).toBeTruthy()
    expect(detail.querySelector('textarea')).toBeTruthy()
    expect(detail.textContent).toContain('Repetir este entreno')
    expect(container.querySelector('.wh-row.on')).toBeTruthy()
  })

  it('celular: tocar un entreno lo abre como panel', async () => {
    useStore.setState({ S: state(), user: null })
    await mount()
    await act(async () => { container.querySelector('.wh-row').click() })
    expect(useUI.getState().sheets.at(-1).kind).toBe('panel')
  })
})
