// @vitest-environment happy-dom
// Historial agrupado por mes con filtros, y el detalle del entreno (fichas, tabla de series,
// comparación con la vez anterior y evolución al tocar el ejercicio).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })
const { default: WorkoutHistoryList, PAGE } = await import('./WorkoutHistoryList.jsx')
const { default: WorkoutDetailView } = await import('./WorkoutDetailView.jsx')
const { setLang } = await import('../../lib/i18n.js')

const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const wk = (id, d, entries, extra = {}) => ({ id, d, start: Date.parse(d + 'T18:00:00Z'), end: Date.parse(d + 'T19:05:00Z'), name: 'Push', routineId: 'r1', vol: 1000, entries, ...extra })
const W = [
  wk('a', '2026-08-30', [{ id: 'x-bench', n: 'Press Banca', sets: [set(55, 8)] }]),
  wk('b', '2026-09-05', [{ id: 'x-bench', n: 'Press Banca', sets: [set(60, 8)] }, { id: 'x-squat', n: 'Sentádilla', sets: [set(100, 5)] }], { routineId: 'r2', name: 'Piernas' }),
  wk('c', '2026-09-12', [{ id: 'x-bench', n: 'Press Banca', sets: [set(20, 10, { phase: 'warmup' }), set(62.5, 6, { rir: 1 }), set(50, 8, { type: 'dropset', drops: [{ w: 40, r: 6 }] })] }], { prs: ['x-bench'], bw: 80 }),
]
const DATA = { workouts: W, routines: [{ id: 'r1', name: 'Push', emoji: 'dumbbell' }, { id: 'r2', name: 'Piernas', emoji: 'legs' }], unit: 'kg' }

let root, container
const render = async el => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(el) })
}
const text = () => container.textContent
const type = async (input, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
beforeEach(async () => { await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true })
afterEach(async () => { await act(async () => { root.unmount() }); container.remove() })

describe('WorkoutHistoryList', () => {
  it('agrupa por mes con totales en la unidad del socio; filtra por rutina y por ejercicio sin tildes', async () => {
    const onOpen = vi.fn()
    await render(<WorkoutHistoryList data={{ ...DATA, unit: 'lb' }} onOpen={onOpen} />)
    const months = [...container.querySelectorAll('.wh-month-h')].map(h => h.textContent)
    expect(months[0]).toContain('September 2026'.replace('September', 'Septiembre'))
    expect(months[0]).toContain('2 entrenos')
    expect(months[0]).toContain('2000 lb')
    expect(months[1]).toContain('1 entreno')
    await act(async () => { [...container.querySelectorAll('.chip')].find(c => c.textContent === 'Piernas').click() })
    expect([...container.querySelectorAll('.wh-row .tt')].map(e => e.textContent)).toEqual(['Piernas'])
    await act(async () => { [...container.querySelectorAll('.chip')].find(c => c.textContent === 'Todas').click() })
    await type(container.querySelector('input'), 'SENTADILLA')
    expect([...container.querySelectorAll('.wh-row')].length).toBe(1)
    await type(container.querySelector('input'), 'nada que ver')
    expect(text()).toContain('Ningún entreno coincide con el filtro.')
    await type(container.querySelector('input'), '')
    await act(async () => { container.querySelector('.wh-row').click() })
    expect(onOpen).toHaveBeenCalledWith(W[2])
  })

  it('"Ver más" de a PAGE', async () => {
    const many = Array.from({ length: PAGE + 5 }, (_, i) => wk('w' + i, `2026-0${1 + (i % 9)}-1${i % 10}`, []))
    await render(<WorkoutHistoryList data={{ ...DATA, workouts: many }} onOpen={() => {}} />)
    expect(container.querySelectorAll('.wh-row').length).toBe(PAGE)
    await act(async () => { container.querySelector('.wh-more').click() })
    expect(container.querySelectorAll('.wh-row').length).toBe(PAGE + 5)
  })
})

describe('WorkoutDetailView', () => {
  it('fichas, tabla con calentamiento, esfuerzo y drop set, y la comparación legible sin color', async () => {
    await render(<WorkoutDetailView w={W[2]} data={DATA} />)
    const tiles = [...container.querySelectorAll('.wd-tile')].map(t => t.textContent)
    expect(tiles).toEqual(['Duración1h 5m', 'Series3', 'Volumen1000 kg', 'Récords1', 'Peso corporal80 kg'])
    const rows = [...container.querySelectorAll('.wd-row:not(.wd-head)')]
    expect(rows.map(r => r.querySelector('.wd-n').textContent)).toEqual(['C', '1', '2'])
    expect(rows[0].classList.contains('warm')).toBe(true)
    expect([...container.querySelectorAll('.wd-head span')].map(s => s.textContent)).toEqual(['#', 'kg', 'reps', 'RIR'])
    expect(rows[2].textContent).toContain('→ 40×6')
    expect(rows[2].textContent).toContain('Drop set')
    // vs. el entreno anterior a esta fecha (05/09: 60×8), no el último de todos.
    const cmp = container.querySelector('.wd-cmp')
    expect(cmp.textContent).toMatch(/\+2\.5 kg · −2 reps vs\. /)
    expect(cmp.classList.contains('up')).toBe(true)
    expect(text()).toContain('Volumen 775 kg')                   // 62.5×6 + 50×8 + 40×6, sin el calentamiento
  })

  it('sin consentimiento de salud no muestra el peso corporal; el primer registro dice que no hay anterior', async () => {
    await render(<WorkoutDetailView w={W[0]} data={DATA} showBw={false} />)
    expect(text()).not.toContain('Peso corporal')
    expect(text()).toContain('Primera vez que lo hacés en el historial')
  })

  it('la evolución se dibuja solo al desplegarla; con menos de 2 puntos, un aviso', async () => {
    await render(<WorkoutDetailView w={W[1]} data={DATA} />)
    expect(container.querySelector('.wd-trend')).toBeNull()
    const [bench, squat] = container.querySelectorAll('.wd-ex-h')
    await act(async () => { squat.click() })
    expect(container.querySelector('.wd-trend').textContent).toContain('Todavía no hay suficientes datos')
    await act(async () => { squat.click(); bench.click() })
    expect(container.querySelector('.wd-trend svg')).toBeTruthy()
    expect(container.querySelector('.wd-trend').textContent).toContain('1RM estimado')
  })

  it('modo lectura: nota como texto y sin acciones', async () => {
    await render(<WorkoutDetailView w={{ ...W[2], note: 'Buen día' }} data={DATA} note="Buen día" />)
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector('.wd-note').textContent).toContain('Buen día')
    expect([...container.querySelectorAll('button')].every(b => b.classList.contains('wd-ex-h'))).toBe(true)
  })
})
