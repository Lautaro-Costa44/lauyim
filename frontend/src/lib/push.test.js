// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => vi.fn(async url => (url === '/api/push/public-key' ? { key: 'AAAA' } : {})))
vi.mock('./api.js', () => ({ api }))
const { enablePush, syncPush, PUSH_CHANGED } = await import('./push.js')

let permission, sub, reg
const fakeSub = () => ({ endpoint: 'https://push.example/x', toJSON: () => ({ endpoint: 'https://push.example/x' }), unsubscribe: vi.fn() })

beforeEach(() => {
  localStorage.clear()
  api.mockClear()
  permission = 'granted'
  sub = null
  reg = { pushManager: { getSubscription: vi.fn(async () => sub), subscribe: vi.fn(async () => (sub = fakeSub())) } }
  window.PushManager = function PushManager() {}
  globalThis.Notification = { get permission() { return permission }, requestPermission: vi.fn(async () => permission) }
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => reg, ready: Promise.resolve(reg) } })
})

const posts = () => api.mock.calls.filter(([url]) => url === '/api/push/subscribe').length

describe('syncPush', () => {
  it('con permiso y sin suscripción: se suscribe sola y avisa el cambio', async () => {
    const seen = vi.fn()
    window.addEventListener(PUSH_CHANGED, seen)
    await syncPush('u', { today: '2026-10-09' })
    expect(reg.pushManager.subscribe).toHaveBeenCalledTimes(1)
    expect(posts()).toBe(1)
    expect(seen).toHaveBeenCalledTimes(1)
    window.removeEventListener(PUSH_CHANGED, seen)
  })

  it('con suscripción: la reenvía una vez por día', async () => {
    sub = fakeSub()
    await syncPush('u', { today: '2026-10-09' })
    await syncPush('u', { today: '2026-10-09' })
    expect(posts()).toBe(1)
    await syncPush('u', { today: '2026-10-10' })
    expect(posts()).toBe(2)
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('nunca pide el permiso: sin decidir o bloqueado no hace nada', async () => {
    for (permission of ['default', 'denied']) await syncPush('u', { today: '2026-10-09' })
    expect(Notification.requestPermission).not.toHaveBeenCalled()
    expect(api).not.toHaveBeenCalled()
  })

  it('sin service worker (dev) o sin conexión, no lanza', async () => {
    reg = undefined
    await expect(syncPush('u')).resolves.toBeUndefined()
    reg = { pushManager: { getSubscription: async () => null, subscribe: async () => { throw new Error('offline') } } }
    await expect(syncPush('u')).resolves.toBeUndefined()
  })

  it('sin cuenta, nada', async () => {
    await syncPush(null)
    expect(api).not.toHaveBeenCalled()
  })
})

describe('enablePush', () => {
  it('bloqueado: frase en español y marca denied', async () => {
    permission = 'denied'
    await expect(enablePush()).rejects.toMatchObject({ message: 'Bloqueaste los avisos en este navegador.', denied: true })
  })

  it('concedido: se suscribe', async () => {
    await enablePush()
    expect(reg.pushManager.subscribe).toHaveBeenCalledTimes(1)
    expect(posts()).toBe(1)
  })
})
