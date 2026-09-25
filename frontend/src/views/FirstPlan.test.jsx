// @vitest-environment happy-dom
// Primer ingreso: el cartel de bienvenida de Home ofrece los programas del gym (con días,
// músculos principales y duración estimada) además de la encuesta y armar la rutina a mano; sin
// programas queda como antes. "Cargar un plan" en Plan abre el mismo selector; sin programas
// carga el plan incluido.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { default: Home } = await import('./Home.jsx')
const { default: Plan } = await import('./Plan.jsx')
const { default: Modals } = await import('../components/Modals.jsx')
const { useStore, DEF } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { bindUI } = await import('../components/ui.jsx')
const { setLang } = await import('../lib/i18n.js')
bindUI(useUI)

const PRESETS = {
  programs: [{ id: 'gppl', name: 'Push Pull Legs', position: 0, count: 2 }, { id: 'gfb', name: 'Full Body', position: 1, count: 1 }],
  presets: [
    { id: 'p1', name: 'Push', emoji: 'barbell', group_name: 'Push Pull Legs', program_id: 'gppl', planned_day: 1, ex: [{ id: '0025', sets: 4, reps: 8 }] },
    { id: 'p2', name: 'Legs', emoji: 'legs', group_name: 'Push Pull Legs', program_id: 'gppl', planned_day: 3, ex: [{ id: '0043', sets: 4, reps: 8 }, { id: 'cx-prensa', sets: 3, reps: 12 }] },
    { id: 'f1', name: 'Full', emoji: 'barbell', group_name: 'Full Body', program_id: 'gfb', planned_day: 2, ex: [{ id: '0025', sets: 3, reps: 10 }] },
  ],
  customExercises: [{ id: 'cx-prensa', n: 'Prensa del gym', bp: 'upper legs', tg: 'quads', mg: 'quads', sm: ['glutes'], custom: true }],
}
let presetsAnswer
const MEMBER = { id: 'm1', name: 'Socio', admin: false }
let container, root
const text = () => container.textContent
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 10)) }) }
const clickText = async (selector, label) => {
  const el = [...document.querySelectorAll(selector)].find(b => b.textContent.includes(label))
  expect(el, label).toBeTruthy()
  await act(async () => { el.click() })
  await flush()
}

async function render(view, state = {}, user = null) {
  useStore.setState({ user, config: { survey_enabled: true }, S: { ...JSON.parse(JSON.stringify(DEF)), onboardingCompletado: true, ...state } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<MemoryRouter>{view}<Modals /></MemoryRouter>) })
  await flush()
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  presetsAnswer = PRESETS
  apiMock.mockReset()
  apiMock.mockImplementation(url => url === '/api/presets' ? Promise.resolve(presetsAnswer) : Promise.resolve({}))
  useUI.setState({ sheets: [] })
})
afterEach(async () => { await act(async () => { root.unmount() }); container.remove() })

describe('primer ingreso', () => {
  it('el cartel muestra los programas con días, duración y músculos, y conserva encuesta y manual', async () => {
    await render(<Home />)
    const cards = [...container.querySelectorAll('.program-choice')]
    expect(cards.map(c => c.querySelector('.tt').textContent)).toEqual(['Push Pull Legs', 'Full Body'])
    expect(cards[0].textContent).toContain('2 días')
    expect(cards[0].textContent).toMatch(/≈ \d+ min por día/)
    expect(cards[0].querySelectorAll('.mchip').length).toBeGreaterThan(0)
    expect(text()).toContain('Recomendarme una rutina')
    expect(text()).toContain('Crear rutina manualmente')
  })

  it('elegir un programa lo carga como plan: rutinas, semana, grupo con su origen y los ejercicios del gym', async () => {
    await render(<Home />)
    await clickText('.program-choice', 'Push Pull Legs')
    const S = useStore.getState().S
    expect(S.routines.map(r => r.name)).toEqual(['Push', 'Legs'])
    expect(Object.keys(S.week).sort()).toEqual(['1', '3'])
    expect(S.routineGroups).toHaveLength(1)
    expect(S.routineGroups[0]).toMatchObject({ name: 'Push Pull Legs', source: { kind: 'preset', programId: 'gppl' } })
    expect(S.customEx.map(e => e.id)).toEqual(['cx-prensa'])
    expect(S.estadoInicial).toBe('plan_predeterminado')
    expect(container.querySelector('[data-tour="welcome"]')).toBeNull()
  })

  it('sin programas en el gym: el cartel de siempre (encuesta y manual), sin selector', async () => {
    presetsAnswer = { presets: [], groups: [], programs: [] }
    await render(<Home />)
    expect(container.querySelector('[data-tour="welcome"]')).toBeTruthy()
    expect(container.querySelector('.program-choice')).toBeNull()
    expect(text()).toContain('Recomendarme una rutina')
  })
})

describe('Plan · Cargar un plan', () => {
  it('abre el mismo selector; elegir carga el programa y cierra', async () => {
    await render(<Plan />, {}, MEMBER)
    await clickText('button', 'Cargar un plan')
    expect(useUI.getState().sheets).toHaveLength(1)
    await clickText('#modal-root .program-choice', 'Full Body')
    expect(useStore.getState().S.routines.map(r => r.name)).toEqual(['Full'])
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('sin programas carga el plan incluido, como antes', async () => {
    presetsAnswer = { presets: [], groups: [], programs: [] }
    await render(<Plan />, {}, MEMBER)
    await clickText('button', 'Cargar un plan')
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useStore.getState().S.routines.map(r => r.name)).toEqual(['Push Day', 'Pull Day', 'Leg Day'])
  })
})
