// @vitest-environment happy-dom
// Ofrecer los avisos después del primer ingreso: el cartel de Inicio, la hoja al reservar y la
// línea del descanso. El permiso del sistema sale solo desde "Activar".
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const enablePush = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: vi.fn(async () => ({})) }))
vi.mock('../../lib/push.js', async importOriginal => ({ ...(await importOriginal()), enablePush }))

let permission = 'default'
let subscription = null
window.PushManager = class {}
globalThis.Notification = { get permission() { return permission }, requestPermission: vi.fn(async () => permission) }
Object.defineProperty(navigator, 'serviceWorker', {
  configurable: true,
  value: { getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription } }) },
})

const { useStore, DEF } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { setLang } = await import('../../lib/i18n.js')
const { default: NotifBanner } = await import('./NotifBanner.jsx')
const { maybeAskNotif } = await import('./NotifAskSheet.jsx')
const { default: RestTimer } = await import('../RestTimer.jsx')

const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
let root, container
async function mount(el) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(el) })
  await flush()
}
const text = () => container.textContent
const button = label => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
const click = async el => { expect(el).toBeTruthy(); await act(async () => { el.click() }); await flush() }
const asked = () => JSON.parse(localStorage.getItem('gym_notif_ask:u1') || 'null')

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  permission = 'default'
  subscription = null
  enablePush.mockClear()
  Notification.requestPermission.mockClear()
  useUI.setState({ sheets: [], timer: null, work: null })
  useStore.setState({
    user: { id: 'u1', name: 'Juan' }, billingEnabled: false, billing: null,
    config: { classes_available: true },
    S: { ...JSON.parse(JSON.stringify(DEF)), week: { 1: 'r1' } },
  })
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  root = null
})

describe('cartel de Inicio', () => {
  it('sin avisos: dice para qué sirven y "Activar" pide el permiso', async () => {
    await mount(<NotifBanner />)
    expect(text()).toContain('Activá los avisos')
    expect(text()).toContain('recordatorios de tus clases y cambios de horario y los días que tenés entrenamiento')
    expect(text()).not.toContain('cuota')
    await click(button('Activar'))
    expect(enablePush).toHaveBeenCalledTimes(1)
  })

  it('la ✕ lo oculta y pausa', async () => {
    await mount(<NotifBanner />)
    await click(button('Ocultar aviso'))
    expect(text()).toBe('')
    expect(asked().n).toBe(1)
  })

  it('no aparece con otro cartel, con un entreno en curso, activas ni bloqueadas', async () => {
    await mount(<NotifBanner busy />)
    expect(text()).toBe('')
    await act(async () => { root.unmount() }); container.remove()
    useStore.setState(s => ({ S: { ...s.S, active: { id: 'w' } } }))
    await mount(<NotifBanner />)
    expect(text()).toBe('')
    await act(async () => { root.unmount() }); container.remove()
    useStore.setState(s => ({ S: { ...s.S, active: null } }))
    permission = 'granted'; subscription = { endpoint: 'x' }
    await mount(<NotifBanner />)
    expect(text()).toBe('')
    await act(async () => { root.unmount() }); container.remove()
    permission = 'denied'; subscription = null
    await mount(<NotifBanner />)
    expect(text()).toBe('')
  })
})

describe('hoja al reservar', () => {
  it('lista de espera: la hoja de ese caso; cerrarla sin activar cuenta como "Ahora no"', async () => {
    await maybeAskNotif('waitlist')
    const sheets = useUI.getState().sheets
    expect(sheets).toHaveLength(1)
    await mount(sheets[0].render(() => {}))
    expect(text()).toContain('¿Te avisamos si se libera un lugar?')
    await act(async () => { root.unmount() }); root = null
    expect(asked().n).toBe(1)
    await maybeAskNotif('class')
    expect(useUI.getState().sheets).toHaveLength(1)   // en pausa: no se vuelve a abrir
  })

  it('"Activar avisos" pide el permiso y no pausa', async () => {
    await maybeAskNotif('class')
    const close = vi.fn()
    await mount(useUI.getState().sheets[0].render(close))
    expect(text()).toContain('¿Te avisamos antes de la clase?')
    await click(button('Activar avisos'))
    expect(enablePush).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalled()
    await act(async () => { root.unmount() }); root = null
    expect(asked()).toBe(null)
  })

  it('con los avisos activos o bloqueados no pregunta', async () => {
    permission = 'granted'; subscription = { endpoint: 'x' }
    await maybeAskNotif('class')
    permission = 'denied'; subscription = null
    await maybeAskNotif('waitlist')
    expect(useUI.getState().sheets).toHaveLength(0)
  })
})

describe('descanso', () => {
  it('empezar el descanso no pide el permiso; la línea lo ofrece y la ✕ la oculta', async () => {
    await mount(<RestTimer />)
    await act(async () => { useUI.getState().startRest(60) })
    await flush()
    expect(Notification.requestPermission).not.toHaveBeenCalled()
    expect(text()).toContain('Avisarme cuando termine el descanso')
    await click(button('Activar'))
    expect(enablePush).toHaveBeenCalledTimes(1)
    await click(button('Ocultar aviso'))
    expect(text()).not.toContain('Avisarme cuando termine el descanso')
    expect(asked().n).toBe(1)
    await act(async () => { useUI.getState().stopRest() })
  })
})
