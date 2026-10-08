// @vitest-environment happy-dom
// Cargar series de un día marcado: acordeón en el celular, lista + detalle en PC, confirmaciones,
// teclado, y lo que se guarda.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const picks = vi.hoisted(() => ({ onPick: null }))
vi.mock('../../sheets.jsx', () => ({ exercisePicker: vi.fn(onPick => { picks.onPick = onPick; return { close: vi.fn() } }) }))

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { setLang } = await import('../../lib/i18n.js')
const { markedEditorSheet } = await import('./MarkedWorkoutEditor.jsx')

const ISO = '2026-10-01'
const push = { id: 'r1', name: 'Push A', emoji: 'chest', ex: [{ id: '0025', sets: 2, reps: 8, weight: 60 }, { id: '0024', sets: 1 }] }
const realMatchMedia = window.matchMedia
const setWide = v => { window.matchMedia = q => ({ matches: !!v && q.includes('min-width'), media: q, addEventListener() {}, removeEventListener() {} }) }
const wait = ms => act(async () => { await new Promise(r => setTimeout(r, ms)) })

let host, root
async function open(opts = {}) {
  markedEditorSheet({ iso: ISO, routine: push, ...opts })
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))) })
  await wait(10)
  return sheet
}
const btn = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const items = () => [...host.querySelectorAll('.mwe-item')]
const cells = (scope = host) => [...scope.querySelectorAll('input.mwe-cell')]
const typeIn = async (input, v) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const click = async el => act(async () => { el.click() })
const setS = patch => useStore.setState({ S: { ...useStore.getState().S, routines: [push], week: {}, dayPlan: {}, workouts: [], effort: 'none', ...patch } })

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  setWide(false)
  useUI.setState({ sheets: [], toastMsg: '' })
  setS()
  picks.onPick = null
})
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  host?.remove()
  window.matchMedia = realMatchMedia
})

describe('editor de series: celular', () => {
  it('se abre a pantalla completa con los ejercicios de la rutina, sin series', async () => {
    const sheet = await open()
    expect(sheet).toMatchObject({ kind: 'panel', fullScreen: true })
    expect(items()).toHaveLength(2)
    expect(items().map(i => i.querySelector('.mwe-sum').textContent)).toEqual(['Sin series', 'Sin series'])
    expect(host.querySelector('.mwe-table')).toBeNull()   // ninguno abierto
  })

  it('cargar kg y reps y guardar crea un marcado solo con lo cargado', async () => {
    await open()
    await click(items()[0].querySelector('.mwe-item-main'))
    const [w1, r1] = cells(items()[0])
    await typeIn(w1, '62,5'); await typeIn(r1, '8')
    expect(items()[0].querySelector('.mwe-sum').textContent).toContain('1 serie')
    await click(btn('Guardar entrenamiento'))
    const [w] = useStore.getState().S.workouts
    expect(w).toMatchObject({ d: ISO, routineId: 'r1', name: 'Push A', marked: true, vol: 500 })
    expect(w.entries).toEqual([{ id: '0025', target: { ...push.ex[0], id: '0025' }, sets: [{ done: true, w: 62.5, r: 8 }] }])
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('guardar sin cargar nada marca el día sin series', async () => {
    await open()
    await click(btn('Guardar entrenamiento'))
    const [w] = useStore.getState().S.workouts
    expect(w.entries).toEqual([])
    expect(w.muscleLoad.intensity).toBe('medium')
  })

  it('quitar pide confirmación en la fila; cancelar no cambia nada', async () => {
    await open()
    await click(items()[1].querySelector('[aria-label^="Quitar"]'))
    expect(host.querySelector('.mwe-confirm.danger').textContent).toContain('La rutina no cambia.')
    await click(btn('Cancelar'))
    expect(items()).toHaveLength(2)
    await click(items()[1].querySelector('[aria-label^="Quitar"]'))
    await click(btn('Quitar'))
    expect(items()).toHaveLength(1)
  })

  it('cambiar abre la biblioteca; al elegir, confirma en la fila y borra las series', async () => {
    await open()
    await click(items()[0].querySelector('.mwe-item-main'))
    const [w1, r1] = cells(items()[0])
    await typeIn(w1, '60'); await typeIn(r1, '8')
    await click(items()[0].querySelector('[aria-label^="Cambiar"]'))
    await wait(10)                                   // el import dinámico de la biblioteca
    await act(async () => { picks.onPick({ id: '0025' }) })
    expect(host.querySelector('.mwe-confirm')).toBeNull()   // el mismo ejercicio: nada
    await click(items()[0].querySelector('[aria-label^="Cambiar"]'))
    await wait(10)
    await act(async () => { picks.onPick({ id: '0024' }) })
    expect(host.querySelector('.mwe-confirm').textContent).toContain('La serie que cargaste se borra')
    await click(btn('Cambiar'))
    expect(items()[0].querySelector('.mwe-sum').textContent).toBe('Sin series')
    expect(items()).toHaveLength(2)
  })

  it('agregar ejercicio: biblioteca, va al final y queda abierto', async () => {
    await open()
    await click(btn('Agregar ejercicio'))
    await wait(10)
    await act(async () => { picks.onPick({ id: '0024' }) })
    await wait(10)
    expect(items()).toHaveLength(3)
    expect(items()[2].classList.contains('open')).toBe(true)
  })

  it('la columna de esfuerzo aparece solo con el ajuste', async () => {
    setS({ effort: 'rir' })
    await open()
    await click(items()[0].querySelector('.mwe-item-main'))
    expect([...host.querySelectorAll('.mwe-th')].map(h => h.textContent)).toEqual(['kg', 'reps', 'RIR'])
  })

  it('"Igual que la última vez" copia las series de la última vez', async () => {
    setS({ workouts: [{ id: 'p', d: '2026-09-20', start: Date.parse('2026-09-20T15:00:00Z'), end: Date.parse('2026-09-20T16:00:00Z'), name: 'Push A', entries: [{ id: '0025', sets: [{ done: true, w: 60, r: 8 }, { done: true, w: 60, r: 7 }] }] }] })
    await open()
    await click(items()[0].querySelector('.mwe-item-main'))
    expect(cells(items()[0])[0].placeholder).toBe('60')
    await click(btn('Igual que la última vez'))
    expect(cells(items()[0]).map(c => c.value)).toEqual(['60', '8', '60', '7'])
  })

  it('abrir un ejercicio lo sube arriba de todo (la tabla queda sobre el teclado)', async () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    await open()
    await click(items()[1].querySelector('.mwe-item-main'))
    await wait(50)
    expect(spy).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
  })

  it('Enter pasa a la celda siguiente; la última cierra el teclado', async () => {
    await open()
    await click(items()[0].querySelector('.mwe-item-main'))
    const cs = cells(items()[0])
    expect(cs.map(c => c.getAttribute('enterkeyhint'))).toEqual(['next', 'next', 'next', 'done'])
    await act(async () => { cs[0].focus() })
    await act(async () => { cs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(document.activeElement).toBe(cs[1])
  })

  it('mientras se escribe se oculta Guardar', async () => {
    await open()
    await click(items()[0].querySelector('.mwe-item-main'))
    await act(async () => { cells(items()[0])[0].dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
    expect(host.querySelector('.mwe-foot').classList.contains('hidden')).toBe(true)
    await act(async () => { cells(items()[0])[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(host.querySelector('.mwe-foot').classList.contains('hidden')).toBe(false)
  })

  it('editar un marcado conserva id, hora y nota, y saca la carga muscular', async () => {
    const start = Date.parse('2026-10-01T15:00:00Z')
    setS({ workouts: [{ id: 'm1', d: ISO, start, end: start, name: 'Push A', routineId: 'r1', marked: true, entries: [], vol: 0, note: 'pesado', muscleLoad: { muscles: ['chest'], intensity: 'medium' } }] })
    await open({ workout: useStore.getState().S.workouts[0] })
    await click(items()[0].querySelector('.mwe-item-main'))
    const [w1, r1] = cells(items()[0])
    await typeIn(w1, '60'); await typeIn(r1, '8')
    await click(btn('Guardar entrenamiento'))
    const ws = useStore.getState().S.workouts
    expect(ws).toHaveLength(1)
    expect(ws[0]).toMatchObject({ id: 'm1', start, end: start, note: 'pesado', marked: true })
    expect(ws[0].muscleLoad).toBeUndefined()
  })
})

describe('editor de series: PC', () => {
  it('panel centrado con lista + detalle; el primero elegido; quitar confirma en el detalle', async () => {
    setWide(true)
    const sheet = await open()
    expect(sheet.fullScreen).toBe(false)
    expect(host.querySelector('.mwe.wide')).toBeTruthy()
    expect(host.querySelector('.mwe-detail .mwe-table')).toBeTruthy()
    expect(items()[0].classList.contains('open')).toBe(true)
    expect(host.querySelector('.mwe-list [aria-label^="Quitar"]')).toBeNull()   // las acciones están en el detalle
    await click(host.querySelector('.mwe-detail').querySelector('[aria-label^="Quitar"]'))
    expect(host.querySelector('.mwe-detail .mwe-confirm.danger')).toBeTruthy()
    await click(items()[1].querySelector('.mwe-item-main'))
    expect(items()[1].classList.contains('open')).toBe(true)
    expect(host.querySelector('.mwe-foot').textContent).toContain('Cancelar')
  })
})
