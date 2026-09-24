// @vitest-environment happy-dom
// Una comida cargada mientras la cuota está bloqueada no se pierde: se encola igual que sin
// conexión y sale cuando se renueva. Recorre FoodPicker → Manual → Guardar como el socio.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
vi.mock('html5-qrcode/third_party/zxing-js.umd.js', () => ({ BrowserMultiFormatReader: class {} }))

const { FoodPicker } = await import('./Nutricion.jsx')
const { useStore } = await import('../store/useStore.js')
const { takeSyncBatch, shouldQueueOffline } = await import('../lib/sync-queue.js')
const { bindUI } = await import('../components/ui.jsx')
const { useUI } = await import('../store/useUI.js')
const { setLang } = await import('../lib/i18n.js')
bindUI(useUI)

const MEMBER = { id: 'm1', name: 'Socio', admin: false }
let container, root
const all = selector => [...container.querySelectorAll(selector)]
const byText = (selector, label) => all(selector).find(el => el.textContent.trim() === label) || all(selector).find(el => el.textContent.includes(label))
const click = async el => { expect(el).toBeTruthy(); await act(async () => { el.click() }); await act(async () => {}) }
async function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  apiMock.mockReset()
  useStore.setState({ user: MEMBER })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => { root.unmount() }); container.remove() })

describe('nutrición con la cuota bloqueada', () => {
  it('shouldQueueOffline: sin respuesta o bloqueo por cuota se encola; otro error del servidor no', () => {
    expect(shouldQueueOffline(new Error('offline'))).toBe(true)
    expect(shouldQueueOffline({ status: 403, data: { error: 'membership_blocked' } })).toBe(true)
    expect(shouldQueueOffline({ status: 400, data: { error: 'bad' } })).toBe(false)
    expect(shouldQueueOffline({ status: 403, data: { error: 'license_expired' } })).toBe(false)
  })

  it('encola la comida en vez de descartarla', async () => {
    apiMock.mockImplementation((url, opts) => {
      if (url === '/api/comidas' && opts?.method === 'POST') return Promise.reject(Object.assign(new Error('membership_blocked'), { status: 403, data: { error: 'membership_blocked' } }))
      return Promise.resolve({ resultados: [] })
    })
    const onSaved = vi.fn(), close = vi.fn()
    await act(async () => { root.render(<FoodPicker franja="almuerzo" close={close} onSaved={onSaved} />) })

    await click(byText('.seg button', 'Manual'))
    await type(byText('label', 'Nombre').querySelector('input'), 'Tostadas')
    for (const [label, value] of [['Gramos', '80'], ['Calorías / 100 g', '400'], ['Proteínas / 100 g', '10'], ['Carbohidratos / 100 g', '70'], ['Grasas / 100 g', '5']]) {
      await type(byText('label', label).querySelector('input'), value)
    }
    await click(byText('button', 'Guardar comida'))

    const queued = await takeSyncBatch(MEMBER.id)
    expect(queued).toHaveLength(1)
    expect(queued[0].changes[0].request).toMatchObject({ kind: 'meal-create', payload: { nombre_alimento: 'Tostadas', franja: 'almuerzo' } })
    expect(onSaved).toHaveBeenCalled()
  })
})
