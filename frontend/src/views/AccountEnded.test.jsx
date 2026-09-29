// @vitest-environment happy-dom
// Pantalla de cuenta dada de baja: persiste en el dispositivo (un arranque sin conexión la muestra
// ANTES del login), "Verificar de nuevo" según lo que diga el servidor, y el ingreso rechazado por
// baja (passkey, código del gym, pareo) que llega como el evento gym:account_ended.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// El flag ya está en el dispositivo cuando el store nace (la app se abrió con la cuenta dada de baja).
localStorage.setItem('gym_account_ended', 'account_disabled')

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock, webauthnOK: () => true }))
vi.mock('../lib/onboarding.js', () => ({ startTourA: vi.fn(), esperarElemento: vi.fn() }))
window.indexedDB = { deleteDatabase: () => { const req = {}; setTimeout(() => req.onsuccess?.()); return req }, open: () => { const req = {}; setTimeout(() => req.onerror?.()); return req } }

const network = () => Promise.reject(Object.assign(new Error('Sin conexión'), { code: 'network_error' }))
const fail = (status, data) => Promise.reject(Object.assign(new Error(data?.error || 'x'), { status, data }))
let meReply
apiMock.mockImplementation(url => {
  if (url === '/api/me') return meReply()
  if (url === '/api/config') return Promise.resolve({})
  if (url === '/api/data') return Promise.resolve({ state: null })
  if (url === '/api/nutrition/goals') return Promise.resolve({ goals: null })
  return Promise.resolve({})
})

const { useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { default: App } = await import('../App.jsx')
const { setLang } = await import('../lib/i18n.js')
await import('./Home.jsx')

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const flush = async () => { for (let i = 0; i < 10; i++) await tick() }
const text = () => document.body.textContent
const button = label => [...document.querySelectorAll('button')].find(b => b.textContent === label)
const click = async label => { expect(button(label), label).toBeTruthy(); await act(async () => { button(label).click() }); await flush() }

let root, container
async function mount({ ended = 'account_disabled', user = null } = {}) {
  window.history.replaceState(null, '', '/#/home')
  ended ? localStorage.setItem('gym_account_ended', ended) : localStorage.removeItem('gym_account_ended')
  useStore.setState({ user, accountEnded: ended, loginNotice: null, ready: true, licenseExpired: false, membershipBlocked: false, accountPending: false })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<App />) })
  await flush()
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockClear()
  meReply = network
  useUI.setState({ sheets: [] })
})
afterEach(async () => {
  if (!root) return
  await act(async () => { root.unmount() })
  container.remove()
  root = null
})

describe('el flag de baja persiste en el dispositivo', () => {
  it('arranque sin conexión: la pantalla va antes que el login y el boot no la borra', async () => {
    const { useStore: store } = await import('../store/useStore.js')
    window.history.replaceState(null, '', '/#/home')
    useStore.setState({ user: null, accountEnded: 'account_disabled', loginNotice: null, ready: false, licenseExpired: false })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<App />) })
    await act(async () => { await store.getState().boot() })   // el arranque real, con todos los pedidos fallando por red
    await flush()
    expect(text()).toContain('Tu cuenta fue desactivada')
    expect(text()).not.toContain('Ingresar con passkey')
    expect(document.querySelector('#tabbar')).toBeNull()
    expect(localStorage.getItem('gym_account_ended')).toBe('account_disabled')
  })
})

describe('"Verificar de nuevo"', () => {
  it('la cuenta sigue desactivada: lo dice y la pantalla queda', async () => {
    await mount()
    meReply = () => fail(401, { error: 'No has iniciado sesión', reason: 'account_disabled' })
    await click('Verificar de nuevo')
    expect(text()).toContain('Tu cuenta sigue desactivada. Consultá en recepción.')
    expect(text()).toContain('Tu cuenta fue desactivada')
    expect(localStorage.getItem('gym_account_ended')).toBe('account_disabled')
  })

  it('sin conexión: lo dice y la pantalla queda', async () => {
    await mount()
    await click('Verificar de nuevo')
    expect(text()).toContain('Sin conexión. Conectate a internet para verificar tu cuenta.')
    expect(localStorage.getItem('gym_account_ended')).toBe('account_disabled')
  })

  it('el servidor confirma la cuenta activa: se restaura la sesión y se borra el flag', async () => {
    await mount()
    meReply = () => Promise.resolve({ user: { id: 'u1', name: 'juan', admin: false }, billingEnabled: false, healthConsent: 'granted' })
    await click('Verificar de nuevo')
    expect(useStore.getState().user?.id).toBe('u1')
    expect(useStore.getState().accountEnded).toBeNull()
    expect(localStorage.getItem('gym_account_ended')).toBeNull()
    expect(text()).not.toContain('Tu cuenta fue desactivada')
  })

  it('sesión vencida: al login, sin parecer un error, y se borra el flag', async () => {
    await mount()
    meReply = () => fail(401, { error: 'No has iniciado sesión', reason: 'session_expired' })
    await click('Verificar de nuevo')
    expect(text()).toContain('Ingresar con passkey')
    expect(text()).toContain('No pudimos verificar tu cuenta con esta sesión. Iniciá sesión de nuevo.')
    expect(localStorage.getItem('gym_account_ended')).toBeNull()
  })

  it('volver a primer plano en la pantalla vuelve a preguntar solo', async () => {
    await mount()
    meReply = () => Promise.resolve({ user: { id: 'u1', name: 'juan', admin: false }, billingEnabled: false, healthConsent: 'granted' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }); await flush()
    expect(useStore.getState().user?.id).toBe('u1')
    expect(localStorage.getItem('gym_account_ended')).toBeNull()
  })

  it('"Ingresar con otra cuenta" sale de la pantalla y borra el flag sin preguntar al servidor', async () => {
    await mount()
    const before = apiMock.mock.calls.filter(([u]) => u === '/api/me').length   // el boot del arranque
    await click('Ingresar con otra cuenta')
    expect(text()).toContain('Ingresar con passkey')
    expect(localStorage.getItem('gym_account_ended')).toBeNull()
    expect(apiMock.mock.calls.filter(([u]) => u === '/api/me')).toHaveLength(before)
  })
})

describe('ingreso rechazado por baja (passkey, código del gym, pareo)', () => {
  const ended = detail => act(async () => { window.dispatchEvent(new CustomEvent('gym:account_ended', { detail })) })

  it.each([['account_disabled', 'Tu cuenta fue desactivada'], ['account_rejected', 'Tu cuenta no fue habilitada']])('%s: muestra la pantalla en lugar del login', async (reason, title) => {
    await mount({ ended: null })
    expect(text()).toContain('Ingresar con passkey')
    await ended({ error: reason }); await flush()
    expect(text()).toContain(title)
    expect(text()).not.toContain('Ingresar con passkey')
    expect(localStorage.getItem('gym_account_ended')).toBe(reason)
  })

  it('con una sesión abierta no hace nada (ahí manda verifySession)', async () => {
    await mount({ ended: null, user: { id: 'u1', name: 'juan', admin: false } })
    await ended({ error: 'account_disabled' }); await flush()
    expect(useStore.getState().accountEnded).toBeNull()
  })

  it('cierra los sheets del login que estuvieran abiertos', async () => {
    await mount({ ended: null })
    await act(async () => { useUI.getState().openSheet(() => <div>sheet del login</div>) }); await flush()
    expect(text()).toContain('sheet del login')
    await ended({ error: 'account_disabled' }); await flush()
    expect(useUI.getState().sheets).toEqual([])
    expect(text()).not.toContain('sheet del login')
  })
})

// Al final: resetModules deja al store con módulos nuevos para los imports dinámicos que siguen.
describe('lectura del flag', () => {
  it('el store lo lee al arrancar', async () => {
    localStorage.setItem('gym_account_ended', 'account_disabled')
    vi.resetModules()
    const fresh = (await import('../store/useStore.js')).useStore
    expect(fresh.getState().accountEnded).toBe('account_disabled')
    localStorage.setItem('gym_account_ended', 'cualquier_cosa')
    vi.resetModules()
    expect((await import('../store/useStore.js')).useStore.getState().accountEnded).toBeNull()
  })
})
