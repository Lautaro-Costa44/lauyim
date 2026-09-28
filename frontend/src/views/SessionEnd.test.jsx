// @vitest-environment happy-dom
// Fin de sesión forzado, con la App real. Cuenta dada de baja (desactivada / rechazada /
// eliminada): se borra el dispositivo (localStorage, IndexedDB, caches del SW que no son el app
// shell, suscripción push) y se muestra el motivo. Sesión vencida: al login conservando la cola
// offline. Sin red: nada cambia. Chequeo al volver a primer plano y cada 5 min solo si está visible.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock, webauthnOK: () => true }))
vi.mock('../lib/onboarding.js', () => ({ startTourA: vi.fn(), esperarElemento: vi.fn() }))

// IndexedDB (la cola offline cae a localStorage: open falla), Cache API y push del navegador.
const deleteDatabase = vi.fn(() => { const req = {}; setTimeout(() => req.onsuccess?.()); return req })
window.indexedDB = { deleteDatabase, open: () => { const req = {}; setTimeout(() => req.onerror?.()); return req } }
const cacheDelete = vi.fn(async () => true)
window.caches = { keys: async () => ['opengym-release-abc', 'api-cache'], delete: cacheDelete }
const unsubscribe = vi.fn(async () => true)
Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
  getRegistration: async () => ({ pushManager: { getSubscription: async () => ({ endpoint: 'https://fcm.googleapis.com/x', unsubscribe }) } })
} })
let visibility = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })

let meReply
const fail = (status, data) => Promise.reject(Object.assign(new Error(data?.error || 'x'), { status, data }))
apiMock.mockImplementation(url => {
  if (url === '/api/me') return meReply()
  return Promise.resolve({})
})

const { useStore, DEF } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { default: App } = await import('../App.jsx')
const { setLang } = await import('../lib/i18n.js')
await import('./Home.jsx')

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const flush = async () => { for (let i = 0; i < 10; i++) await tick() }
const text = () => document.body.textContent
const meCalls = () => apiMock.mock.calls.filter(([u]) => u === '/api/me').length
const QUEUE_KEY = 'gym_sync_queue_v1'

let root, container
async function mount() {
  window.history.replaceState(null, '', '/#/home')
  const user = { id: 'u1', name: 'juan', admin: false }
  localStorage.setItem('gym_user', JSON.stringify(user))
  localStorage.setItem(QUEUE_KEY, JSON.stringify([{ id: 'op1', userId: 'u1', createdAt: 1 }]))
  localStorage.setItem('gym_theme_pref', 'dark')
  sessionStorage.setItem('algo', '1')
  useStore.setState({
    boot: () => {}, ready: true, licenseExpired: false, membershipBlocked: false, accountPending: false, accountEnded: null,
    user, healthConsent: 'granted', S: { ...JSON.parse(JSON.stringify(DEF)), onboardingCompletado: true, workouts: [{ id: 'w', d: '2026-09-01' }] }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<App />) })
  await flush()
}
const unauthorized = async () => { await act(async () => { window.dispatchEvent(new CustomEvent('gym:unauthorized')) }); await flush() }

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockClear(); deleteDatabase.mockClear(); cacheDelete.mockClear(); unsubscribe.mockClear()
  localStorage.clear(); sessionStorage.clear()
  visibility = 'visible'
  meReply = () => Promise.resolve({ user: { id: 'u1', name: 'juan' } })
  useUI.setState({ sheets: [] })
})
afterEach(async () => {
  vi.useRealTimers()
  if (!root) return
  await act(async () => { root.unmount() })
  container.remove()
  root = null
})

describe('cuenta dada de baja', () => {
  it.each([
    ['account_disabled', 'Tu cuenta fue desactivada'],
    ['account_rejected', 'Tu cuenta no fue habilitada'],
    ['account_deleted', 'Tu cuenta fue eliminada'],
  ])('%s: borra el dispositivo y muestra el motivo', async (reason, title) => {
    await mount()
    meReply = () => fail(401, { error: 'No has iniciado sesión', reason })
    await unauthorized()                                   // cualquier 401 de un pedido cualquiera
    expect(text()).toContain(title)
    expect(text()).toContain('Los datos de la app se borraron de este dispositivo.')
    expect(localStorage.getItem('gym_user')).toBeNull()
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull()
    expect(localStorage.getItem('gym_theme_pref')).toBeNull()
    expect(sessionStorage.getItem('algo')).toBeNull()
    expect(deleteDatabase).toHaveBeenCalledWith('lauyim-sync-v1')
    expect(cacheDelete.mock.calls.map(([k]) => k)).toEqual(['api-cache'])   // el app shell queda
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    const st = useStore.getState()
    expect([st.user, st.S.workouts.length]).toEqual([null, 0])
    expect(document.querySelector('#tabbar')).toBeNull()
    await act(async () => { document.querySelector('.account-ended button').click() }); await flush()
    expect(text()).toContain('Ingresar con passkey')
  })
})

describe('sesión vencida', () => {
  it('conserva la cola offline y los datos: va al login sin borrar nada', async () => {
    await mount()
    meReply = () => fail(401, { error: 'No has iniciado sesión', reason: 'session_expired' })
    await unauthorized()
    expect(text()).toContain('Ingresar con passkey')
    expect(text()).not.toContain('Tu cuenta fue')
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY))).toEqual([{ id: 'op1', userId: 'u1', createdAt: 1 }])
    expect(useStore.getState().S.workouts.length).toBe(1)
    expect(deleteDatabase).not.toHaveBeenCalled()
    expect(unsubscribe).not.toHaveBeenCalled()
  })

  it('un 401 sin motivo (servidor viejo) cuenta como sesión vencida', async () => {
    await mount()
    meReply = () => fail(401, { error: 'No has iniciado sesión' })
    await unauthorized()
    expect(localStorage.getItem(QUEUE_KEY)).not.toBeNull()
    expect(deleteDatabase).not.toHaveBeenCalled()
  })
})

describe('sin red', () => {
  it('un error de red nunca cuenta como "sin sesión"', async () => {
    await mount()
    meReply = () => Promise.reject(new TypeError('Failed to fetch'))   // sin status
    await unauthorized()
    await act(async () => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')) }); await flush()
    expect(useStore.getState().user?.id).toBe('u1')
    expect(localStorage.getItem(QUEUE_KEY)).not.toBeNull()
    expect(text()).not.toContain('Ingresar con passkey')
  })
})

describe('chequeo periódico', () => {
  it('al volver a primer plano y cada 5 min solo con la app visible', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await mount()
    const base = meCalls()
    await act(async () => { vi.advanceTimersByTime(5 * 60 * 1000) }); await flush()
    expect(meCalls()).toBe(base + 1)
    // En segundo plano: el intervalo se pausa.
    await act(async () => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { vi.advanceTimersByTime(15 * 60 * 1000) }); await flush()
    expect(meCalls()).toBe(base + 1)
    // Vuelve: chequea en el acto y retoma el intervalo.
    await act(async () => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')) }); await flush()
    expect(meCalls()).toBe(base + 2)
    await act(async () => { vi.advanceTimersByTime(5 * 60 * 1000) }); await flush()
    expect(meCalls()).toBe(base + 3)
  })
})

describe('cerrar sesión', () => {
  it('desvincula la suscripción push del dispositivo (servidor y navegador)', async () => {
    await mount()
    await act(async () => { await useStore.getState().signOut() }); await flush()
    const logout = apiMock.mock.calls.find(([u]) => u === '/api/logout')
    expect(JSON.parse(logout[1].body)).toEqual({ endpoint: 'https://fcm.googleapis.com/x' })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
