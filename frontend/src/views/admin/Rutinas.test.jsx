// @vitest-environment happy-dom
// Rutinas del admin: programas como cards con sus días, buscador, panel lateral en escritorio,
// acciones que llaman al server, y "Asignar a socio" (GET + PUT de las rutinas del socio con
// el programa como grupo nuevo y su source).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

let desktop = false
window.matchMedia = query => ({ matches: query.includes('min-width: 1000px') ? desktop : false, media: query, addEventListener() {}, removeEventListener() {} })

const PRESETS = [
  { id: 'p1', name: 'Push Day', emoji: 'barbell', group_name: 'PPL', planned_day: 1, position: 0, program_id: 'gppl', ex: [{ id: '0025', sets: 4, reps: 8, weight: 0 }] },
  { id: 'p2', name: 'Leg Day', emoji: 'legs', group_name: 'PPL', planned_day: 5, position: 1, program_id: 'gppl', ex: [{ id: '0043', sets: 3, reps: 10, weight: 0 }] },
  { id: 't1', name: 'Torso', emoji: 'barbell', group_name: 'Torso / Pierna', planned_day: null, position: 0, program_id: 'gtp', ex: [] },
]
const PROGRAMS = [{ id: 'gppl', name: 'PPL', position: 0, count: 2 }, { id: 'gtp', name: 'Torso / Pierna', position: 1, count: 1 }]
let memberState
apiMock.mockImplementation((url, opts) => {
  if (url === '/api/admin/programs/usage') return Promise.resolve({ usage: { gppl: { users: 3, active: 2 } } })
  if (url === '/api/admin/users/ana/routines' && !opts) return Promise.resolve(memberState)
  return Promise.resolve({ ok: true, preset: { name: 'x' }, program: { name: 'x' } })
})

const { AdminContext } = await import('./context.js')
const { default: Rutinas } = await import('./Rutinas.jsx')
const { assignProgram } = await import('./rutinas/AssignSheet.jsx')
const { setLang } = await import('../../lib/i18n.js')

const loadPresets = vi.fn(() => Promise.resolve())
let root, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const ctx = { presets: PRESETS, programs: PROGRAMS, users: [], loadPresets }
  await act(async () => { root.render(<AdminContext.Provider value={ctx}><Rutinas /></AdminContext.Provider>) })
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}
const cards = () => [...container.querySelectorAll('.program-card')]
const dayNames = card => [...card.querySelectorAll('.preset-day-main .tt')].map(el => el.textContent)
const type = async (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  desktop = false
  apiMock.mockClear()
  loadPresets.mockClear()
})
afterEach(async () => {
  if (!root) return
  await act(async () => root.unmount())
  container.remove()
  root = null
})

describe('Rutinas', () => {
  it('one card per program with its days in order, weekly stats and usage', async () => {
    await mount()
    expect(cards().map(c => c.querySelector('.program-name').textContent)).toEqual(['PPL', 'Torso / Pierna'])
    expect(dayNames(cards()[0])).toEqual(['Push Day', 'Leg Day'])
    expect(cards()[0].textContent).toContain('2 días')
    expect(cards()[0].textContent).toContain('7 series/semana')
    expect(cards()[0].querySelector('.program-usage').textContent).toContain('3 socios')
    expect(cards()[1].querySelector('.program-usage').textContent).toContain('Ningún socio')
    expect(cards()[0].querySelector('.bodymap.mini')).toBeTruthy()
    expect(cards()[0].querySelector('.preset-day-badge.planned').textContent).toBe('Lu')
  })

  it('search finds days by exercise name; the chips narrow to one program', async () => {
    await mount()
    await type(container.querySelector('input[aria-label="Buscar programa, día o ejercicio"]'), 'squat')
    expect(cards()).toHaveLength(1)
    expect(dayNames(cards()[0])).toEqual(['Leg Day'])
    await type(container.querySelector('input[aria-label="Buscar programa, día o ejercicio"]'), '')
    const chip = [...container.querySelectorAll('.preset-filter .chip')].find(b => b.textContent === 'Torso / Pierna')
    await act(async () => chip.click())
    expect(cards().map(c => c.querySelector('.program-name').textContent)).toEqual(['Torso / Pierna'])
  })

  it('desktop: a day opens in the side panel, marked in its card', async () => {
    desktop = true
    await mount()
    expect(container.querySelector('.preset-panel')).toBeNull()
    await act(async () => container.querySelector('.preset-day-main').click())
    const panel = container.querySelector('.preset-panel')
    expect(panel.textContent).toContain('Editar día')
    expect(panel.querySelector('input').value).toBe('Push Day')
    expect(container.querySelector('.admin-presets.editing')).toBeTruthy()
    expect(container.querySelector('.preset-day.on .tt').textContent).toBe('Push Day')
  })

  it('duplicate day and duplicate program call the server and reload', async () => {
    await mount()
    await act(async () => container.querySelector('[aria-label="Duplicar Leg Day"]').click())
    expect(apiMock).toHaveBeenCalledWith('/api/admin/presets/duplicate', { method: 'POST', body: JSON.stringify({ id: 'p2' }) })
    await act(async () => container.querySelector('[aria-label="Duplicar PPL"]').click())
    expect(apiMock).toHaveBeenCalledWith('/api/admin/programs/duplicate', { method: 'POST', body: JSON.stringify({ id: 'gppl' }) })
    expect(loadPresets).toHaveBeenCalledTimes(2)
  })

  it('reordering with the keyboard sends every day of the program in the new order', async () => {
    await mount()
    const handle = cards()[0].querySelectorAll('.drag-handle')[1]
    await act(async () => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })) })
    expect(apiMock).toHaveBeenCalledWith('/api/admin/presets/reorder', { method: 'POST', body: JSON.stringify({ programId: 'gppl', ids: ['p2', 'p1'] }) })
    expect(dayNames(cards()[0])).toEqual(['Leg Day', 'Push Day'])
  })
})

describe('assignProgram', () => {
  it('adds the program as a new group with its source and PUTs the whole routine state', async () => {
    memberState = { routines: [{ id: 'r1', name: 'Mine', ex: [] }], week: { 2: 'r1' }, dayPlan: {}, routineGroups: [{ id: 'g1', name: 'Mi Plan', routines: [{ id: 'r1', name: 'Mine', ex: [] }], week: { 2: 'r1' } }], activeGroupId: 'g1' }
    const result = await assignProgram('ana', PROGRAMS[0], PRESETS.slice(0, 2), { activate: false })
    expect(result.ok).toBe(true)
    const [url, opts] = apiMock.mock.calls.find(([, o]) => o?.method === 'PUT')
    expect(url).toBe('/api/admin/users/ana/routines')
    const body = JSON.parse(opts.body)
    expect(body.routineGroups.map(g => g.name)).toEqual(['Mi Plan', 'PPL'])
    expect(body.routineGroups[1].source).toMatchObject({ kind: 'preset', programId: 'gppl' })
    expect(body.routineGroups[1].routines.map(r => r.name)).toEqual(['Push Day', 'Leg Day'])
    expect(body.activeGroupId).toBe('g1')
    expect(body.routines.map(r => r.id)).toEqual(['r1'])
  })

  it('does not write when the member already has a group with that name', async () => {
    memberState = { routines: [], week: {}, dayPlan: {}, routineGroups: [{ id: 'g1', name: 'ppl', routines: [], week: {} }], activeGroupId: 'g1' }
    const result = await assignProgram('ana', PROGRAMS[0], PRESETS.slice(0, 2))
    expect(result).toMatchObject({ ok: false, error: 'exists' })
    expect(apiMock.mock.calls.some(([, o]) => o?.method === 'PUT')).toBe(false)
  })
})
