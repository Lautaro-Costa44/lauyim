// @vitest-environment happy-dom
// Días cerrados del gimnasio en Inicio (tira, línea de la semana, fila de hoy) y en el calendario
// (día rayado, semana congelada con candado). Sin módulo de clases: los cierres vienen de useClosures.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
vi.mock('../lib/onboarding.js', () => ({ startTourA: () => {} }))

const { useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { useClosures } = await import('../store/useClosures.js')
const { setLang } = await import('../lib/i18n.js')
const { default: Home } = await import('./Home.jsx')
const { calendarSheet } = await import('../sheets.jsx')

const TODAY = '2026-10-05'   // lunes
const piernas = { id: 'r1', name: 'Piernas', emoji: 'legs', ex: [{ id: 'leg-1', sets: 4 }] }

let container, root
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
const mount = async el => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<MemoryRouter>{el}</MemoryRouter>) })
  for (let i = 0; i < 3; i++) await tick()
}
async function openLastSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => { r.render(<MemoryRouter>{sheet.render(() => useUI.getState().closeSheet(sheet.id))}</MemoryRouter>) })
  await tick()
  return { host, unmount: async () => { await act(async () => r.unmount()); host.remove() } }
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 5, 12, 0))
  apiMock.mockReset()
  apiMock.mockImplementation(() => Promise.resolve({}))
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ config: { classes_available: false }, user: { id: 'socio' }, healthConsent: 'declined' })
  // Plan de 2 días: lunes y miércoles.
  useStore.setState({ S: { ...useStore.getState().S, routines: [piernas], week: { 1: 'r1', 3: 'r1' }, dayPlan: {}, workouts: [], onboardingCompletado: true, planIniciado: true } })
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove(); root = null
  vi.useRealTimers()
  useClosures.setState({ today: null, closures: [] })
  useStore.setState({ config: null })
})

describe('Inicio con días cerrados', () => {
  it('el día cerrado de la tira no tiene punto de planificado y lleva candado', async () => {
    useClosures.setState({ today: TODAY, closures: [{ id: 'k', from: TODAY, to: TODAY, reason: 'Feriado' }] })
    await mount(<Home />)
    const mon = container.querySelectorAll('.week .wday')[0]
    expect(mon.classList.contains('closed')).toBe(true)
    expect(mon.querySelector('.dot.plan')).toBe(null)
    expect(mon.querySelector('.lock-mini')).not.toBe(null)
    expect(mon.getAttribute('aria-label')).toContain('cerrado')
    expect(container.querySelector('.today-closed').textContent).toBe('Hoy el gimnasio está cerrado')
  })

  it('la línea de la semana explica el objetivo reducido', async () => {
    useClosures.setState({ today: TODAY, closures: [{ id: 'k', from: TODAY, to: TODAY, reason: 'Feriado' }] })
    await mount(<Home />)
    const line = container.querySelector('.week-closed').textContent
    expect(line).toContain('Lun 5/10 cerrado · Feriado.')
    expect(line).toContain('Esta semana tu objetivo es 1.')
  })

  it('semana congelada: la línea dice que la racha queda en pausa', async () => {
    useClosures.setState({ today: TODAY, closures: [{ id: 'k', from: TODAY, to: '2026-10-09', reason: 'Vacaciones' }] })
    await mount(<Home />)
    expect(container.querySelector('.week-closed').textContent).toContain('tu racha queda en pausa')
    expect(container.querySelector('.week-progress').textContent).toContain('Semana en pausa')
  })

  it('sin cierres, nada de esto', async () => {
    await mount(<Home />)
    expect(container.querySelector('.week-closed')).toBe(null)
    expect(container.querySelector('.wday.closed')).toBe(null)
  })

  it('calendario: día cerrado rayado y semana congelada con candado', async () => {
    useClosures.setState({ today: TODAY, closures: [{ id: 'k', from: TODAY, to: '2026-10-09', reason: 'Vacaciones' }] })
    calendarSheet(TODAY)
    const { host, unmount } = await openLastSheet()
    const closed = host.querySelectorAll('.cal-d.closed')
    expect(closed.length).toBe(5)
    expect(closed[0].querySelector('i').className).toBe('')
    expect(host.querySelector('.cal-wk.frozen')).not.toBe(null)
    expect(host.querySelector('.cal-legend-closed')).not.toBe(null)
    await unmount()
  })
})
