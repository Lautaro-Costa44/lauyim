// @vitest-environment happy-dom
// Configuración de cuotas: la sección "Bloqueo automático" (interruptor, tolerancia y el texto
// que explica qué le pasa al socio) y que el guardado mande auto_block.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { SettingsSheet } = await import('./SettingsSheet.jsx')
const { useUI } = await import('../../../store/useUI.js')
const { bindUI } = await import('../../../components/ui.jsx')
const { setLang } = await import('../../../lib/i18n.js')
bindUI(useUI)

const SETTINGS = { due_soon_days: 5, push_days_before: 3, grace_days: 5, trial_days: 1, payment_methods: ['efectivo'], gym_tz: 'America/Argentina/Buenos_Aires', auto_block: true }
let saved, container, root
const text = () => container.textContent
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const flush = async () => { for (let i = 0; i < 6; i++) await tick() }
const autoSwitch = () => container.querySelector('[role="switch"][aria-label="Bloquear automáticamente cuentas con cuota vencida"]')
const click = async el => { expect(el).toBeTruthy(); await act(async () => { el.click() }); await flush() }

async function mount(settings) {
  apiMock.mockImplementation((url, opts = {}) => {
    if (url === '/api/admin/billing/settings' && opts.method === 'PUT') { saved = JSON.parse(opts.body); return Promise.resolve({ settings: { ...settings, ...saved } }) }
    if (url === '/api/admin/billing/settings') return Promise.resolve({ settings })
    return Promise.reject(new Error('no mockeado ' + url))
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<SettingsSheet close={() => {}} />) })
  await flush()
}

beforeEach(async () => { await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true; saved = null; apiMock.mockReset() })
afterEach(async () => { await act(async () => { root.unmount() }); container.remove() })

describe('Bloqueo automático', () => {
  it('encendido: explica qué provoca, muestra la tolerancia y guarda auto_block: true', async () => {
    await mount(SETTINGS)
    expect(text()).toContain('Bloqueo automático')
    expect(autoSwitch().getAttribute('aria-checked')).toBe('true')
    expect(text()).toContain('no puede usar la app hasta que se le registre el próximo pago')
    expect(text()).toContain('vuelve a entrar solo')
    expect(text()).toContain('Días de tolerancia')
    await click([...container.querySelectorAll('button')].find(b => b.textContent === 'Guardar'))
    expect(saved).toMatchObject({ auto_block: true, grace_days: 5 })
  })

  it('apagarlo: oculta la tolerancia, cambia la explicación y guarda auto_block: false', async () => {
    await mount(SETTINGS)
    await click(autoSwitch())
    expect(autoSwitch().getAttribute('aria-checked')).toBe('false')
    expect(text()).not.toContain('Días de tolerancia')
    expect(text()).toContain('sigue usando la app con normalidad')
    await click([...container.querySelectorAll('button')].find(b => b.textContent === 'Guardar'))
    expect(saved.auto_block).toBe(false)
  })

  it('un servidor sin auto_block (instancia existente) cuenta como encendido', async () => {
    const { auto_block, ...old } = SETTINGS
    await mount(old)
    expect(autoSwitch().getAttribute('aria-checked')).toBe('true')
  })
})
