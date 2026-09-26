// @vitest-environment happy-dom
// planIniciado: el cartel de bienvenida se va para siempre cuando el socio elige un programa,
// crea una rutina o lo descarta. Borrar todas las rutinas deja el estado vacío de Plan (con
// "Cargar un plan"), no el cartel. El flag baja del servidor en otro dispositivo y un true local
// no se pierde con un estado del servidor que todavía no lo tiene.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { default: Home } = await import('./Home.jsx')
const { default: Plan } = await import('./Plan.jsx')
const { useStore, DEF } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { bindUI } = await import('../components/ui.jsx')
const { setLang } = await import('../lib/i18n.js')
bindUI(useUI)

const PRESETS = {
  programs: [{ id: 'gfb', name: 'Full Body', position: 0, count: 1 }],
  presets: [{ id: 'f1', name: 'Full', emoji: 'barbell', group_name: 'Full Body', program_id: 'gfb', planned_day: 2, ex: [{ id: '0025', sets: 3, reps: 10 }] }],
}
let serverState = null
let container, root
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 10)) }) }
const welcome = () => container.querySelector('[data-tour="welcome"]')
const S = () => useStore.getState().S

async function render(view) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<MemoryRouter>{view}</MemoryRouter>) })
  await flush()
}
const unmount = async () => { await act(async () => { root.unmount() }); container.remove(); root = null }

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  serverState = null
  apiMock.mockReset()
  apiMock.mockImplementation((url, opts) => url === '/api/presets' ? Promise.resolve(PRESETS)
    : url === '/api/presets/apply' ? Promise.resolve({ presets: PRESETS.presets.filter(p => p.program_id === JSON.parse(opts.body).id), customExercises: [] })
    : url === '/api/data' ? Promise.resolve({ state: serverState }) : Promise.resolve({}))
  useUI.setState({ sheets: [] })
  useStore.setState({ user: null, config: { survey_enabled: true }, S: { ...JSON.parse(JSON.stringify(DEF)), onboardingCompletado: true } })
})
afterEach(async () => { if (root) await unmount() })

describe('planIniciado', () => {
  it('socio nuevo ve el cartel; elegir un programa lo prende y borrar todo después no lo trae', async () => {
    await render(<Home />)
    expect(welcome()).toBeTruthy()
    await act(async () => { container.querySelector('.program-choice').click() })
    await flush()
    expect(S().planIniciado).toBe(true)
    expect(welcome()).toBeNull()
    await act(async () => { useStore.getState().update(s => { s.routines = []; s.week = {} }) })
    await flush()
    expect(S().planIniciado).toBe(true)
    expect(welcome()).toBeNull()
    await unmount()
    // Plan: estado vacío normal, con acceso al selector
    await render(<Plan />)
    expect(container.textContent).toContain('Cargar un plan')
  })

  it('crear una rutina (por cualquier pantalla) lo prende', async () => {
    await act(async () => { useStore.getState().update(s => { s.routines.push({ id: 'r', name: 'Mía', emoji: 'dumbbell', ex: [] }) }) })
    expect(S().planIniciado).toBe(true)
  })

  it('descartar el cartel lo prende sin cargar nada', async () => {
    await render(<Home />)
    await act(async () => { container.querySelector('[aria-label="Cerrar bienvenida"]').click() })
    await flush()
    expect(S().planIniciado).toBe(true)
    expect(S().routines).toEqual([])
    expect(welcome()).toBeNull()
  })

  it('"Crear rutina manualmente" también lo prende', async () => {
    await render(<Home />)
    const link = [...container.querySelectorAll('button')].find(b => b.textContent === 'Crear rutina manualmente')
    await act(async () => { link.click() })
    expect(S().planIniciado).toBe(true)
  })

  it('cambiar de dispositivo: baja del servidor y el cartel no aparece', async () => {
    useStore.setState({ user: { id: 'm1', name: 'Socio' } })
    serverState = { ...JSON.parse(JSON.stringify(DEF)), onboardingCompletado: true, planIniciado: true, _ts: 5 }
    await act(async () => { await useStore.getState().pullState() })
    expect(S().planIniciado).toBe(true)
    await render(<Home />)
    expect(welcome()).toBeNull()
  })

  it('un true local no se pierde con un estado del servidor que todavía no lo tiene', async () => {
    useStore.setState({ user: { id: 'm1', name: 'Socio' }, S: { ...JSON.parse(JSON.stringify(DEF)), planIniciado: true, _ts: 1 } })
    serverState = { ...JSON.parse(JSON.stringify(DEF)), planIniciado: false, _ts: 5 }
    await act(async () => { await useStore.getState().pullState() })
    expect(S().planIniciado).toBe(true)
  })
})
