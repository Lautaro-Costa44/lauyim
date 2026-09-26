// @vitest-environment happy-dom
// Paso de notificaciones del primer ingreso (spec 12.6), con la App real: se ofrece antes del
// tour, "Activar" pide el permiso desde el toque, "Ahora no" sigue, y no vuelve a aparecer.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
const enablePush = vi.hoisted(() => vi.fn())
const kind = vi.hoisted(() => ({ value: 'enable' }))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
vi.mock('../lib/push.js', async importOriginal => ({ ...(await importOriginal()), enablePush }))
vi.mock('../lib/notif-step.js', async importOriginal => ({ ...(await importOriginal()), notifStepKind: () => kind.value }))
vi.mock('../lib/onboarding.js', () => ({ startTourA: vi.fn(), esperarElemento: vi.fn() }))

const { useStore, DEF } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { default: App } = await import('../App.jsx')
const { setLang } = await import('../lib/i18n.js')
await import('./NotificationsStep.jsx')
// Inicio (lazy) cargado de antemano: si no, el primer test espera la transformación de Vite.
await import('./Home.jsx')

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const flush = async () => { for (let i = 0; i < 10; i++) await tick() }
const text = () => document.body.textContent
const button = label => [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === label).at(-1)
const click = async el => { expect(el).toBeTruthy(); await act(async () => { el.click() }); await flush() }

let root, container
async function mount(state = {}) {
  window.history.replaceState(null, '', '/#/home')
  useStore.setState({
    boot: () => {}, ready: true, licenseExpired: false, membershipBlocked: false,
    user: { id: 'u1', name: 'juan', admin: false },
    S: { ...JSON.parse(JSON.stringify(DEF)), onboardingCompletado: false, ...state }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<App />) })
  await flush()
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  enablePush.mockReset()
  kind.value = 'enable'
  localStorage.clear()
  useUI.setState({ sheets: [] })
})
afterEach(async () => {
  if (!root) return
  await act(async () => { root.unmount() })
  container.remove()
  root = null
})

describe('paso de notificaciones', () => {
  it('primer ingreso: explicación, sin TabBar; "Activar" pide el permiso y sigue', async () => {
    await mount()
    expect(text()).toContain('¿Activamos las notificaciones?')
    expect(document.querySelector('#tabbar')).toBeNull()
    enablePush.mockResolvedValue()
    await click(button('Activar'))
    expect(enablePush).toHaveBeenCalledTimes(1)
    expect(text()).not.toContain('¿Activamos las notificaciones?')
    expect(localStorage.getItem('gym_notif_step:u1')).toBe('1')
  })

  it('permiso negado: no traba, sigue igual con un aviso', async () => {
    await mount()
    enablePush.mockRejectedValue(new Error('denied'))
    await click(button('Activar'))
    expect(text()).not.toContain('¿Activamos las notificaciones?')
    expect(useUI.getState().toastMsg).toBe('No se activaron. Podés hacerlo cuando quieras desde Ajustes.')
  })

  it('"Ahora no" sigue y no vuelve a aparecer', async () => {
    await mount()
    await click(button('Ahora no'))
    expect(enablePush).not.toHaveBeenCalled()
    await act(async () => { root.unmount() }); container.remove()
    await mount()
    expect(text()).not.toContain('¿Activamos las notificaciones?')
  })

  it('iOS sin instalar: instrucciones para agregarla a inicio', async () => {
    kind.value = 'ios-install'
    await mount()
    expect(text()).toContain('Instalá la app para recibir avisos')
    expect(text()).toContain('Agregar a inicio')
    await click(button('Entendido'))
    expect(text()).not.toContain('Instalá la app')
  })

  it('no aparece si ya terminó el onboarding, sin nada que ofrecer, ni sin sesión', async () => {
    await mount({ onboardingCompletado: true })
    expect(text()).not.toContain('¿Activamos las notificaciones?')
    await act(async () => { root.unmount() }); container.remove()
    kind.value = null
    await mount()
    expect(text()).not.toContain('¿Activamos las notificaciones?')
  })
})
