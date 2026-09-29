// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, webauthnOK } from './api.js'

const originalPublicKeyCredential = window.PublicKeyCredential
const originalCredentials = navigator.credentials

function setCapability(target, property, value) {
  Object.defineProperty(target, property, { configurable: true, value })
}

afterEach(() => {
  setCapability(window, 'PublicKeyCredential', originalPublicKeyCredential)
  setCapability(navigator, 'credentials', originalCredentials)
})

describe('webauthnOK', () => {
  it('accepts WebAuthn when PublicKeyCredential is exposed', () => {
    setCapability(window, 'PublicKeyCredential', class PublicKeyCredential {})
    setCapability(navigator, 'credentials', {})
    expect(webauthnOK()).toBe(true)
  })

  it('does not reject WebAuthn when the generic credentials check is unavailable', () => {
    setCapability(window, 'PublicKeyCredential', class PublicKeyCredential {})
    setCapability(navigator, 'credentials', undefined)
    expect(webauthnOK()).toBe(true)
  })

  it('rejects browsers without the WebAuthn credential type', () => {
    setCapability(window, 'PublicKeyCredential', undefined)
    setCapability(navigator, 'credentials', {})
    expect(webauthnOK()).toBe(false)
  })
})

describe('linkPasskey', () => {
  it('crea la passkey con las opciones del código y se puede reintentar tras cancelar', async () => {
    const { linkPasskey } = await import('./api.js')
    const found = { cid: 'c1', options: { challenge: 'AAAA', user: { id: 'AAAA', name: 'x' }, excludeCredentials: [] } }
    const buf = () => new Uint8Array([1]).buffer
    const cred = { id: 'k', rawId: buf(), type: 'public-key', getClientExtensionResults: () => ({}), response: { clientDataJSON: buf(), attestationObject: buf(), getTransports: () => ['internal'] } }
    const create = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('cancel'), { name: 'NotAllowedError' }))
      .mockResolvedValueOnce(cred)
    setCapability(navigator, 'credentials', { create })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ user: { id: 'f', name: 'x' } }) })
    try {
      await expect(linkPasskey(found)).rejects.toMatchObject({ name: 'NotAllowedError' })
      expect(await linkPasskey(found)).toEqual({ id: 'f', name: 'x' })
      // Las opciones del servidor quedan intactas (base64url), así el reintento las vuelve a convertir.
      expect(found.options.challenge).toBe('AAAA')
      expect(create.mock.calls[1][0].publicKey.challenge).toBeInstanceOf(ArrayBuffer)
      const [url, opts] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/link/verify')
      expect(JSON.parse(opts.body)).toMatchObject({ cid: 'c1', credential: { id: 'k', response: { transports: ['internal'] } } })
    } finally { fetchMock.mockRestore() }
  })
})

describe('api: sin sesión', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })
  const listen = () => { const seen = []; const on = e => seen.push(e.detail); window.addEventListener('gym:unauthorized', on); return { seen, off: () => window.removeEventListener('gym:unauthorized', on) } }

  it('un 401 de cualquier pedido avisa (gym:unauthorized); /api/me no, lo maneja el store', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'No has iniciado sesión' }), { status: 401 }))
    const l = listen()
    await expect(api('/api/data')).rejects.toMatchObject({ status: 401 })
    await expect(api('/api/me')).rejects.toMatchObject({ status: 401 })
    l.off()
    expect(l.seen).toHaveLength(1)
  })

  it('un error de red no es "sin sesión"', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const l = listen()
    await expect(api('/api/data')).rejects.toMatchObject({ code: 'network_error' })
    l.off()
    expect(l.seen).toHaveLength(0)
  })
})

describe('api() without a response from the server', () => {
  it('turns fetch\'s "Failed to fetch" into a Spanish network_error with no status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const error = await api('/api/me').catch(e => e)
    vi.unstubAllGlobals()
    expect(error.code).toBe('network_error')
    expect(error.status).toBeUndefined()
    expect(error.message).toBe('Sin conexión. Revisá tu internet e intentá de nuevo.')
    expect(error.message).not.toMatch(/fetch/i)
  })

  it('a request the caller cancelled with its own signal is left as it was', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    const error = await api('/api/me', { signal: controller.signal }).catch(e => e)
    vi.unstubAllGlobals()
    expect(error.name).toBe('AbortError')
  })
})
