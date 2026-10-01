// @vitest-environment happy-dom
// "Tengo un código del gym": el socio de una ficha crea su passkey con el código de recepción.
// App real sin sesión (Login), servidor mockeado y navigator.credentials falso.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => {
  const real = await importOriginal()
  // linkPasskey/linkOptions usan el api() interno del módulo: se reescriben sobre el mock.
  return {
    ...real, api: apiMock, webauthnOK: () => true,
    linkOptions: code => apiMock('/api/link/options', { method: 'POST', body: JSON.stringify({ code }) }),
    linkPasskey: async ({ cid }, { legalAccepted, healthConsent } = {}) => {
      await navigator.credentials.create({})
      return (await apiMock('/api/link/verify', { method: 'POST', body: JSON.stringify({ cid, legalAccepted, healthConsent }) })).user
    }
  }
})

const fail = (status, error) => Promise.reject(Object.assign(new Error(error), { status, data: { error } }))
const OPTIONS = { cid: 'c1', options: { challenge: 'AAAA', user: { id: 'AAAA' } }, name: 'jperez', fullName: 'Juan Pérez' }
let optionsReply, verifyReply
let pairingStart = () => Promise.resolve({ pairingId: 'p1', manualCode: 'ABCD-EFGH', expiresAt: Date.now() + 5 * 60000 })
let pairingPoll = () => Promise.resolve({ status: 'pending' })
apiMock.mockImplementation((url, opts = {}) => {
  if (url === '/api/link/options') return optionsReply()
  if (url === '/api/link/verify') return verifyReply()
  if (url === '/api/auth/device/start') return pairingStart()
  if (url.startsWith('/api/auth/device/poll')) return pairingPoll()
  if (url === '/api/me') return Promise.resolve({ user: { id: 'f', name: 'jperez', admin: false }, billingEnabled: true, billing: { hasPlan: false, status: 'sin_plan', blocked: false } })
  return Promise.resolve({})
})
const create = vi.fn()
Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create } })

const { useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { default: App } = await import('../App.jsx')
const { setLang } = await import('../lib/i18n.js')
const { formatLinkCodeInput, isCompleteLinkCode } = await import('../lib/link-code.js')

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const flush = async () => { for (let i = 0; i < 8; i++) await tick() }
const text = () => document.body.textContent
// Las opciones del login son tarjetas: se buscan por su título.
const button = label => [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === label || b.querySelector('.login-option-t')?.textContent === label).at(-1)
const click = async el => { expect(el).toBeTruthy(); await act(async () => { el.click() }); await flush() }
// El consentimiento (aviso + datos de salud) va antes de crear la passkey.
const acceptConsent = async () => { await act(async () => { document.querySelector('.privacy-accept input').click() }); await flush() }
const codeInput = () => document.querySelector('input[aria-label="Código del gym"]')

let root, container
async function mount(url = '/') {
  window.history.replaceState(null, '', url)
  useStore.setState({ boot: () => {}, ready: true, user: null, licenseExpired: false })
  useStore.getState().setGuest(false)
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
  create.mockReset()
  create.mockResolvedValue({})
  optionsReply = () => Promise.resolve(OPTIONS)
  verifyReply = () => Promise.resolve({ user: { id: 'f', name: 'jperez', admin: false } })
  useUI.setState({ sheets: [] })
})
afterEach(async () => {
  if (!root) return
  await act(async () => { root.unmount() })
  container.remove()
  root = null
})

describe('código del gym: formato', () => {

  it('offline without a session: says a connection is needed for the first sign-in, and hides it online', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    try {
      await mount()
      expect(text()).toContain('Necesitás conexión para el primer ingreso.')
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
      await act(async () => { window.dispatchEvent(new Event('online')) })
      await flush()
      expect(text()).not.toContain('Necesitás conexión para el primer ingreso.')
    } finally { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }) }
  })
  it('mayúsculas, guion automático y sin caracteres ambiguos', () => {
    expect(formatLinkCodeInput('abcd')).toBe('ABCD')
    expect(formatLinkCodeInput('abcde')).toBe('ABCD-E')
    expect(formatLinkCodeInput('ab-cd efgh')).toBe('ABCD-EFGH')
    expect(formatLinkCodeInput('A0B1CIDO')).toBe('ABCD')          // 0, 1, I y O no existen
    expect(formatLinkCodeInput('ABCDEFGHJK')).toBe('ABCD-EFGH')
    expect(isCompleteLinkCode('ABCD-EFGH')).toBe(true)
    expect(isCompleteLinkCode('ABCD-EFG')).toBe(false)
  })
})

describe('login con código del gym', () => {
  it('?link= abre el flujo con el código cargado y lo saca de la URL', async () => {
    await mount('/?link=abcd-efgh&qr=x#/')
    expect(codeInput().value).toBe('ABCD-EFGH')
    expect(window.location.search).toBe('?qr=x')
    expect(window.location.hash).toBe('#/')
  })

  it('el link del Login abre el flujo vacío', async () => {
    await mount('/')
    await click(button('Tengo un código del gym'))
    expect(codeInput().value).toBe('')
    expect(button('Continuar').disabled).toBe(true)
  })

  it('confirma a quién se vincula, crea la passkey y queda logueado', async () => {
    await mount('/?link=ABCDEFGH')
    await click(button('Continuar'))
    expect(JSON.parse(apiMock.mock.calls.find(([u]) => u === '/api/link/options')[1].body)).toEqual({ code: 'ABCD-EFGH' })
    expect(text()).toContain('Vas a crear tu acceso como Juan Pérez')
    expect(create).not.toHaveBeenCalled()
    expect(button('Confirmar').disabled).toBe(true)
    expect(document.querySelectorAll('.privacy-accept')[1].textContent).toContain('datos de salud')
    await acceptConsent()
    await act(async () => { document.querySelectorAll('.privacy-accept input')[1].click() })
    await click(button('Confirmar'))
    expect(create).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(apiMock.mock.calls.find(([u]) => u === '/api/link/verify')[1].body)
    expect([sent.legalAccepted, sent.healthConsent]).toEqual([true, true])
    expect(useStore.getState().healthConsent).toBe('granted')
    expect(useStore.getState().user.id).toBe('f')
    expect(apiMock.mock.calls.some(([u]) => u === '/api/me')).toBe(true)     // boot normal: cuota
  })

  it('cancelar la passkey vuelve a la confirmación sin error', async () => {
    create.mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }))
    await mount('/?link=ABCDEFGH')
    await click(button('Continuar'))
    await acceptConsent()
    await click(button('Confirmar'))
    expect(text()).toContain('Vas a crear tu acceso como Juan Pérez')
    expect(document.querySelector('.form-error')).toBeNull()
    expect(button('Confirmar').disabled).toBe(false)
    expect(useStore.getState().user).toBeNull()
  })

  it.each([
    ['link_invalid', () => fail(400, 'link_invalid'), 'El código no es válido o venció. Pedí uno nuevo en recepción.'],
    ['link_unavailable', () => fail(409, 'link_unavailable'), 'Este socio ya tiene acceso. Iniciá sesión.'],
    ['429', () => fail(429, 'too many requests'), 'Demasiados intentos, probá en unos minutos.'],
  ])('error %s al validar el código', async (_, reply, message) => {
    optionsReply = reply
    await mount('/?link=ABCDEFGH')
    await click(button('Continuar'))
    expect(document.querySelector('.form-error').textContent).toBe(message)
  })

  it('un error al verificar se muestra en la confirmación', async () => {
    verifyReply = () => fail(400, 'link_invalid')
    await mount('/?link=ABCDEFGH')
    await click(button('Continuar'))
    await acceptConsent()
    await click(button('Confirmar'))
    expect(document.querySelector('.form-error').textContent).toBe('El código no es válido o venció. Pedí uno nuevo en recepción.')
    expect(useStore.getState().user).toBeNull()
  })
})

describe('pantalla de login', () => {
  it('cuatro opciones como tarjetas, con su explicación; passkey destacada; aviso y privacidad al fondo', async () => {
    await mount()
    const cards = [...document.querySelectorAll('.login-option')]
    expect(cards.map(c => c.querySelector('.login-option-t').textContent)).toEqual(['Ingresar con passkey', 'Usar mi cuenta de otro dispositivo', 'Crear nuevo perfil', 'Tengo un código del gym'])
    expect(cards.every(c => c.tagName === 'BUTTON' && c.querySelector('.login-option-s').textContent)).toBe(true)
    expect(cards[0].classList.contains('primary')).toBe(true)
    const page = document.querySelector('.login-page')
    expect(page.lastElementChild.classList.contains('login-footer')).toBe(true)
    expect(page.querySelector('.login-footer').textContent).toContain('Aviso de privacidad')
    expect(text()).not.toContain('sincronizacion')
  })

  it('otro dispositivo: pasos para cualquier dispositivo, el código y la cuenta regresiva; vencido, se genera otro', async () => {
    await mount()
    await click(button('Usar mi cuenta de otro dispositivo'))
    const sheet = document.querySelector('#modal-root .pairing')
    expect(sheet.textContent).toContain('En el celular, la tablet o la computadora donde ya usás la app')
    expect([...sheet.querySelectorAll('.pairing-steps li')].map(li => li.textContent)).toEqual(['Abrí Ajustes.', 'Tocá "Vincular otro dispositivo".', 'Ingresá este código.'])
    expect(sheet.querySelector('.pairing-code-v').textContent).toBe('ABCD-EFGH')
    expect(sheet.textContent).toMatch(/vence en [45]:\d\d/)
    expect(sheet.textContent).not.toContain('celu ')
    // El servidor dice que venció: se ofrece generar otro.
    pairingPoll = () => Promise.reject(Object.assign(new Error('expired'), { status: 400, data: { status: 'expired', error: 'expired' } }))
    await act(async () => { await new Promise(r => setTimeout(r, 2100)) }); await flush()
    expect(document.querySelector('#modal-root .pairing').textContent).toContain('El código venció.')
    pairingStart = () => Promise.resolve({ pairingId: 'p2', manualCode: 'WXYZ-2345', expiresAt: Date.now() + 5 * 60000 })
    pairingPoll = () => Promise.resolve({ status: 'pending' })
    await click(button('Generar otro código'))
    expect(document.querySelector('#modal-root .pairing-code-v').textContent).toBe('WXYZ-2345')
  })
})

