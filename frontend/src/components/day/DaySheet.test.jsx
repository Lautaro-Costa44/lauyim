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
const { dayOverrideSheet } = await import('../../sheets.jsx')

const TODAY = '2026-10-05'   // lunes
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
