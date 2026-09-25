// @vitest-environment happy-dom
// Selectores como paso interno del sheet (usePickerStep) en Rutinas (día planeado de un preset)
// y en Nutrición del socio (franja de una comida y de una comida compuesta): elegir no apila
// otro sheet, el formulario no se desmonta y atrás cierra primero la lista.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
vi.mock('html5-qrcode/third_party/zxing-js.umd.js', () => ({ BrowserMultiFormatReader: class {} }))

const { default: Rutinas } = await import('./admin/Rutinas.jsx')
const { AdminContext } = await import('./admin/context.js')
const { FoodPicker, ComidaCompuestaBuilder } = await import('./Nutricion.jsx')
const { default: Modals } = await import('../components/Modals.jsx')
const { useUI } = await import('../store/useUI.js')
const { bindUI } = await import('../components/ui.jsx')
const { setLang } = await import('../lib/i18n.js')
bindUI(useUI)

const BANANA = { nombre: 'Banana', caloriasPor100g: 89, proteinaPor100g: 1.1, carbosPor100g: 23, grasasPor100g: 0.3 }

let container, root
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const flush = async (n = 5) => { for (let i = 0; i < n; i++) await tick() }
const sheets = () => useUI.getState().sheets
const topSheet = () => [...document.querySelectorAll('#modal-root .sheet')].at(-1)
const inSheet = (selector, label) => [...topSheet().querySelectorAll(selector)].find(el => el.textContent.trim().startsWith(label))
const click = async el => { expect(el).toBeTruthy(); await act(async () => { el.click() }); await flush(2) }
const back = async () => { await act(async () => { useUI.getState().getSheetOnBack(sheets().at(-1).id)() }); await flush(2) }
async function type(input, value) {
  expect(input).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function mount(children) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<>{children}<Modals /></>) })
  await flush(2)
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockReset()
  apiMock.mockImplementation(url => url.startsWith('/api/alimentos/buscar') ? Promise.resolve([BANANA]) : Promise.resolve({}))
  useUI.setState({ sheets: [] })
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
})

describe('Rutinas: día planeado del preset', () => {
  it('se elige como paso interno; atrás cierra la lista y después el sheet', async () => {
    await mount(<AdminContext.Provider value={{ presets: [], loadPresets: () => {} }}><Rutinas /></AdminContext.Provider>)
    await click([...container.querySelectorAll('button')].find(b => b.textContent.trim() === 'Nueva'))
    expect(sheets()).toHaveLength(1)
    await type(topSheet().querySelector('input'), 'Piernas')

    await click(inSheet('.lrow', 'Día planeado'))
    expect(sheets()).toHaveLength(1)
    expect(topSheet().querySelector('.picker-step h3').textContent).toBe('Día planeado para hacer esta rutina')
    await click(inSheet('.picker-step .lrow', 'Lunes'))
    expect(topSheet().querySelector('.picker-step')).toBeNull()
    expect(inSheet('.lrow', 'Día planeado').textContent).toContain('Lunes')
    expect(topSheet().querySelector('input').value).toBe('Piernas')         // no se desmontó

    await click(inSheet('.lrow', 'Día planeado'))
    await back()
    expect(topSheet().querySelector('.picker-step')).toBeNull()
    expect(sheets()).toHaveLength(1)
    await back()
    expect(sheets()).toHaveLength(0)
  })
})

describe('Nutrición: franja de una comida', () => {
  it('se elige como paso interno; atrás: lista → buscador → cierra', async () => {
    await mount(null)
    await act(async () => {
      useUI.getState().openSheet((close, { setOnBack }) => <FoodPicker franja="almuerzo" close={close} setOnBack={setOnBack} onSaved={() => {}} />)
    })
    await flush(2)
    await type(topSheet().querySelector('input'), 'ban')
    await act(async () => { await new Promise(r => setTimeout(r, 450)) })
    await flush(2)
    await click(inSheet('.lrow', 'Banana'))
    expect(inSheet('.lrow', 'Franja').textContent).toContain('Almuerzo')
    await click([...topSheet().querySelectorAll('.meal-quick button')].find(b => b.textContent === '2 porciones'))

    await click(inSheet('.lrow', 'Franja'))
    expect(sheets()).toHaveLength(1)
    expect(topSheet().querySelector('.picker-step h3').textContent).toBe('Elegir franja')
    await click(inSheet('.picker-step .lrow', 'Cena'))
    expect(topSheet().querySelector('.picker-step')).toBeNull()
    expect(inSheet('.lrow', 'Franja').textContent).toContain('Cena')
    expect(topSheet().querySelector('.nutri-live').textContent).toContain('200 g')   // lo cargado sigue

    await click(inSheet('.lrow', 'Franja'))
    await back()
    expect(topSheet().querySelector('.picker-step')).toBeNull()
    expect(inSheet('.lrow', 'Franja')).toBeTruthy()                               // sigue en la comida
    await back()
    expect(topSheet().textContent).toContain('Agregar comida')                   // volvió al buscador
    await back()
    expect(sheets()).toHaveLength(0)
  })
})

describe('Nutrición: franja de una comida compuesta', () => {
  it('se elige como paso interno; atrás cierra la lista y el constructor sigue abierto', async () => {
    await mount(null)
    await act(async () => {
      useUI.getState().openSheet(close => <ComidaCompuestaBuilder close={close} onSaved={() => {}} />, { locked: true, fullScreen: true })
    })
    await flush(2)
    await type(topSheet().querySelector('input[name="comida-compuesta-nombre"]') || topSheet().querySelector('input'), 'Desayuno power')

    await click(inSheet('.lrow', 'Franja'))
    expect(sheets()).toHaveLength(1)
    expect(topSheet().querySelector('.picker-step h3').textContent).toBe('Elegir franja')
    expect(topSheet().querySelector('.compound-builder-actions').hidden).toBe(true)
    await click(inSheet('.picker-step .lrow', 'Merienda'))
    expect(inSheet('.lrow', 'Franja').textContent).toContain('Merienda')
    expect(topSheet().querySelector('.compound-builder-actions').hidden).toBe(false)

    // Atrás del sistema con la lista abierta: se cierra la lista, no el constructor.
    await click(inSheet('.lrow', 'Franja'))
    const push = vi.spyOn(window.history, 'pushState')
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate', { state: { comidaCompuestaBuilder: true } })) })
    await flush(2)
    expect(topSheet().querySelector('.picker-step')).toBeNull()
    expect(sheets()).toHaveLength(1)
    expect(push.mock.calls.some(([state]) => state?.comidaCompuestaBuilder)).toBe(true)   // repone su entrada
    expect([...topSheet().querySelectorAll('input')].some(i => i.value === 'Desayuno power')).toBe(true)
    push.mockRestore()
  })
})
