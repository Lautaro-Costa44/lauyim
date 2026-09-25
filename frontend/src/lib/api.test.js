// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { webauthnOK } from './api.js'

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
