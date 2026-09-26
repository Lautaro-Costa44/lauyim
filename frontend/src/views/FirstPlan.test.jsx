// @vitest-environment happy-dom
// Primer ingreso: el cartel de bienvenida de Home ofrece los programas del gym visibles para
// socios (con días y músculos principales) además de la encuesta y armar la rutina a mano; sin
// programas (o ninguno visible) queda como antes. "Cargar un plan" en Plan abre el mismo
// selector; sin programas el botón no aparece (la app no trae un plan propio). "Cargar planes pre-creados" en Configuración
// solo aparece si hay programas. Cargar un programa pasa por POST /api/presets/apply, que
// rechaza (403) uno que el admin ocultó después de abierta la lista.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { default: Home } = await import('./Home.jsx')
const { default: Plan } = await import('./Plan.jsx')
const { default: Settings } = await import('./Settings.jsx')
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
// Programas que el admin ocultó después de que el socio abrió la lista.
let hiddenNow
// Lo que responde el servidor: /api/presets (ya filtrado) y /api/presets/apply por programa.
const serverAnswer = (url, opts) => {
  if (url === '/api/presets') return Promise.resolve(presetsAnswer)
  if (url === '/api/presets/apply') {
    const { id } = JSON.parse(opts.body)
    if (hiddenNow.has(id)) return Promise.reject(Object.assign(new Error('program_hidden'), { status: 403, data: { error: 'program_hidden' } }))
    const presets = PRESETS.presets.filter(p => p.program_id === id)
    return Promise.resolve({ program: PRESETS.programs.find(p => p.id === id), presets, customExercises: PRESETS.customExercises })
  }
  return Promise.resolve({})
}
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
  hiddenNow = new Set()
  apiMock.mockReset()
  apiMock.mockImplementation(serverAnswer)
  useUI.setState({ sheets: [] })
})
afterEach(async () => { await act(async () => { root.unmount() }); container.remove() })

describe('primer ingreso', () => {
  it('el cartel muestra los programas con días y músculos, sin duración estimada, y conserva encuesta y manual', async () => {
    await render(<Home />)
    const cards = [...container.querySelectorAll('.program-choice')]
    expect(cards.map(c => c.querySelector('.tt').textContent)).toEqual(['Push Pull Legs', 'Full Body'])
    expect(cards[0].textContent).toContain('2 días')
    expect(cards[0].textContent).not.toMatch(/min/)
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
    expect(apiMock).toHaveBeenCalledWith('/api/presets/apply', { method: 'POST', body: JSON.stringify({ id: 'gppl' }) })
  })

  it('un programa que el admin ocultó con la lista abierta no se carga (403): aviso y nada cambia', async () => {
    await render(<Home />)
    hiddenNow.add('gppl')
    await clickText('.program-choice', 'Push Pull Legs')
    expect(useStore.getState().S.routines).toEqual([])
    expect(useStore.getState().S.routineGroups).toEqual([])
    expect(useUI.getState().toastMsg).toBe('Este programa ya no está disponible.')
    expect(container.querySelector('[data-tour="welcome"]')).toBeTruthy()
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

  it('sin programas visibles el botón no aparece y no se carga ningún plan', async () => {
    presetsAnswer = { presets: [], groups: [], programs: [] }
    await render(<Plan />, {}, MEMBER)
    expect(text()).toContain('Aún no hay rutinas.')
    expect([...container.querySelectorAll('button')].some(b => b.textContent.includes('Cargar un plan'))).toBe(false)
    expect(useStore.getState().S.routines).toEqual([])
  })
})

// Lo que manda el servidor cuando el admin dejó visible solo Full Body.
const onlyFullBody = () => ({
  programs: PRESETS.programs.filter(p => p.id === 'gfb'),
  groups: [{ id: 'gfb', name: 'Full Body', count: 1 }],
  presets: PRESETS.presets.filter(p => p.program_id === 'gfb'),
  customExercises: [],
})

describe('programas ocultos para socios', () => {
  it('el primer ingreso y "Cargar un plan" muestran solo los visibles', async () => {
    presetsAnswer = onlyFullBody()
    await render(<Home />)
    expect([...container.querySelectorAll('.program-choice .tt')].map(el => el.textContent)).toEqual(['Full Body'])
    await act(async () => { root.unmount() }); container.remove()
    await render(<Plan />, {}, MEMBER)
    await clickText('button', 'Cargar un plan')
    expect([...document.querySelectorAll('#modal-root .program-choice .tt')].map(el => el.textContent)).toEqual(['Full Body'])
  })

  it('Configuración: "Cargar planes pre-creados" aparece con programas visibles y carga por /api/presets/apply', async () => {
    presetsAnswer = { ...PRESETS, groups: [{ id: 'gppl', name: 'Push Pull Legs', count: 2 }, { id: 'gfb', name: 'Full Body', count: 1 }] }
    await render(<Settings />, {}, MEMBER)
    await clickText('.lrow, button, [role="button"]', 'Cargar planes pre-creados')
    const load = [...document.querySelectorAll('#modal-root .item')].find(el => el.textContent.includes('Full Body')).querySelector('button')
    await act(async () => { load.click() })
    await flush()
    expect(apiMock).toHaveBeenCalledWith('/api/presets/apply', { method: 'POST', body: JSON.stringify({ id: 'gfb' }) })
    expect(useStore.getState().S.routineGroups.map(g => [g.name, g.source?.programId])).toContainEqual(['Full Body', 'gfb'])
  })

  it('Configuración: uno ocultado con la lista abierta no se carga', async () => {
    presetsAnswer = { ...PRESETS, groups: [{ id: 'gfb', name: 'Full Body', count: 1 }] }
    await render(<Settings />, {}, MEMBER)
    await clickText('.lrow, button, [role="button"]', 'Cargar planes pre-creados')
    hiddenNow.add('gfb')
    const load = [...document.querySelectorAll('#modal-root .item')].find(el => el.textContent.includes('Full Body')).querySelector('button')
    await act(async () => { load.click() })
    await flush()
    expect(useStore.getState().S.routineGroups.some(g => g.name === 'Full Body')).toBe(false)
    expect(useUI.getState().toastMsg).toBe('Este programa ya no está disponible.')
  })

  it('sin ningún programa visible: ni selector en el primer ingreso ni "Cargar planes pre-creados"', async () => {
    presetsAnswer = { presets: [], groups: [], programs: [], customExercises: [] }
    await render(<Home />)
    expect(container.querySelector('.program-choice')).toBeNull()
    expect(text()).toContain('Recomendarme una rutina')
    expect(text()).toContain('Crear rutina manualmente')
    await act(async () => { root.unmount() }); container.remove()
    await render(<Settings />, {}, MEMBER)
    expect(text()).not.toContain('Cargar planes pre-creados')
  })
})
