// @vitest-environment happy-dom
// Pantalla de Ingreso Físico con la App real: solo el token del dispositivo, sin sesión.
// Numpad (táctil y teclado), una coincidencia, varias, ninguna, demasiadas, sin conexión,
// módulo apagado, resultado con estado de cuota y la salida con passkey de admin.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
const assertionMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock, passkeyAssertion: assertionMock, webauthnOK: () => true }))
vi.mock('../lib/onboarding.js', () => ({ startTourA: vi.fn(), esperarElemento: vi.fn() }))

const fail = (status, data) => Promise.reject(Object.assign(new Error(data?.error || 'x'), { status, data }))
const network = () => Promise.reject(Object.assign(new Error('Sin conexión'), { code: 'network_error' }))
let routes
apiMock.mockImplementation((url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {}
  if (routes[url]) return routes[url](body, opts)
  if (url === '/api/config') return Promise.resolve({})
  return fail(401, { error: 'No has iniciado sesión' })
})

const { useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { default: App } = await import('../App.jsx')
const { setLang } = await import('../lib/i18n.js')
const { RESULT_MS } = await import('./IngresoFisico.jsx')

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const flush = async () => { for (let i = 0; i < 8; i++) await tick() }
const text = () => document.body.textContent
const buttons = () => [...document.querySelectorAll('button')]
const key = label => buttons().find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
const click = async el => { expect(el).toBeTruthy(); await act(async () => { el.click() }); await flush() }
const typeDni = async dni => { for (const d of dni) await click(key(d)) }
const keyboard = async k => { await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })) }); await flush() }
const TOKEN_KEY = 'lauyim_checkin_token'

let root, container
async function mount({ token = 'tok-123', user = null } = {}) {
  window.history.replaceState(null, '', '/#/ingreso-fisico')
  token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY)
  useStore.setState({ boot: () => {}, ready: true, user, licenseExpired: false, accountEnded: null, membershipBlocked: false, accountPending: false })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<App />) })
  await flush()
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  apiMock.mockClear(); assertionMock.mockReset()
  useUI.setState({ sheets: [] })
  routes = {
    '/api/checkin/info': () => Promise.resolve({ name: 'Tablet', mode: 'full', digits: 4 }),
    '/api/checkin/lookup': ({ dni }) => Promise.resolve(dni === '30111222'
      ? { status: 'found', candidates: [{ ticket: 't-juan', name: 'Juan P.' }] }
      : { status: 'not_found', candidates: [] }),
    '/api/checkin/confirm': ({ ticket }) => Promise.resolve({ t_juan: { status: 'registered', name: 'Juan', billing: { status: 'por_vencer', days: 3 } } }[ticket.replace('-', '_')] || { status: 'registered', name: 'X' }),
  }
})
afterEach(async () => {
  vi.useRealTimers()
  if (!root) return
  await act(async () => { root.unmount() })
  container.remove()
  root = null
})

const headers = url => apiMock.mock.calls.filter(([u]) => u === url).map(([, o]) => o?.headers || {})

describe('Ingreso Físico: pantalla', () => {
  it('sin token: dice que el dispositivo no está activado, sin pedir nada al servidor', async () => {
    await mount({ token: null })
    expect(text()).toContain('Este dispositivo no está activado para Ingreso Físico')
    expect(apiMock.mock.calls.some(([u]) => u.startsWith('/api/checkin/'))).toBe(false)
  })

  it('sin sesión y sin TabBar; los pedidos van solo con el token del dispositivo', async () => {
    await mount()
    expect(text()).toContain('Ingresá tu DNI')
    expect(document.querySelector('#tabbar')).toBeNull()
    expect(text()).not.toContain('kiosco')
    expect(headers('/api/checkin/info')[0]).toMatchObject({ 'X-Checkin-Token': 'tok-123' })
  })

  it('DNI completo con el numpad: saludo, estado con días y vuelve solo al numpad', async () => {
    await mount()
    await typeDni('30111222')
    expect(document.querySelector('.checkin-display').textContent).toBe('30111222')
    await click(key('Confirmar'))
    expect(text()).toContain('¡Hola, Juan!')
    expect(text()).toContain('Tu ingreso quedó registrado.')
    expect(text()).toContain('Por vencer')
    expect(text()).toContain('Tu cuota vence en 3 días.')
    await act(async () => { await new Promise(r => setTimeout(r, RESULT_MS + 100)) })
    await flush()
    expect(text()).toContain('Ingresá tu DNI')
    expect(document.querySelector('.checkin-display').textContent).toBe('—')
  }, 15000)

  it('teclado físico: dígitos, Backspace y Enter; tocar el resultado vuelve al numpad', async () => {
    await mount()
    for (const d of '301112229') await keyboard(d)
    expect(document.querySelector('.checkin-display').textContent).toBe('30111222')   // tope de 8
    await keyboard('Backspace')
    await keyboard('2')
    await keyboard('Enter')
    expect(text()).toContain('¡Hola, Juan!')
    await click(document.querySelector('.checkin-result'))
    expect(text()).toContain('Ingresá tu DNI')
  })

  it('notebook: con el resultado en pantalla, un dígito ya es el primero del próximo DNI', async () => {
    await mount()
    for (const d of '30111222') await keyboard(d)
    await keyboard('Enter')
    expect(text()).toContain('¡Hola, Juan!')
    await keyboard('4')
    expect(text()).toContain('Ingresá tu DNI')
    expect(document.querySelector('.checkin-display').textContent).toBe('4')
    for (const d of '0111333') await keyboard(d)
    expect(document.querySelector('.checkin-display').textContent).toBe('40111333')
  })

  it('el numpad no tiene campos de texto: la tablet no abre su teclado', async () => {
    await mount()
    expect(document.querySelector('.checkin input, .checkin textarea, .checkin [contenteditable]')).toBeNull()
  })

  it('no encontrado, DNI corto y sin conexión: mensajes claros, sin registrar', async () => {
    await mount()
    await typeDni('123')
    await click(key('Confirmar'))
    expect(text()).toContain('Ingresá tu DNI completo.')
    expect(apiMock.mock.calls.some(([u]) => u === '/api/checkin/lookup')).toBe(false)
    await typeDni('45678')
    await click(key('Confirmar'))
    expect(text()).toContain('No encontramos ese DNI, consultá en recepción.')
    routes['/api/checkin/lookup'] = network
    await typeDni('30111222')
    await click(key('Confirmar'))
    expect(text()).toContain('Sin conexión, consultá en recepción.')
    expect(apiMock.mock.calls.some(([u]) => u === '/api/checkin/confirm')).toBe(false)
  }, 15000)

  it('últimos dígitos: varias coincidencias → lista con nombre e inicial; más de 5 → pide más', async () => {
    routes['/api/checkin/info'] = () => Promise.resolve({ name: 'Tablet', mode: 'last', digits: 4 })
    routes['/api/checkin/lookup'] = ({ dni }) => Promise.resolve(dni === '5555' ? { status: 'too_many', candidates: [] }
      : { status: 'found', candidates: [{ ticket: 't-a', name: 'Carla U.' }, { ticket: 't-b', name: 'Carlos D.' }] })
    routes['/api/checkin/confirm'] = ({ ticket }) => Promise.resolve({ status: ticket === 't-b' ? 'already' : 'registered', name: 'Carlos' })
    await mount()
    expect(text()).toContain('Ingresá los últimos 4 dígitos de tu DNI')
    await typeDni('5555')
    await click(key('Confirmar'))
    expect(text()).toContain('Hay varios socios con esos números. Ingresá más dígitos.')
    expect(document.querySelector('.checkin-display').textContent).toBe('5555')   // conserva lo tipeado
    await click(key('Borrar')); await click(key('Borrar')); await click(key('Borrar')); await click(key('Borrar'))
    await typeDni('4444')
    await click(key('Confirmar'))
    expect(text()).toContain('¿Quién sos?')
    expect(text()).toContain('Carla U.')
    expect(text()).not.toMatch(/\d{5,}/)
    await click(buttons().find(b => b.textContent.includes('Carlos D.')))
    expect(text()).toContain('¡Hola, Carlos!')
    expect(text()).toContain('Ya registraste tu ingreso hoy.')
  }, 15000)

  it('vencido o bloqueado: estado y "Pasá por recepción"', async () => {
    routes['/api/checkin/confirm'] = () => Promise.resolve({ status: 'registered', name: 'Vera', billing: { status: 'vencido', days: -2 } })
    await mount()
    await typeDni('30111222')
    await click(key('Confirmar'))
    expect(text()).toContain('Vencido')
    expect(text()).toContain('Tu cuota venció hace 2 días.')
    expect(text()).toContain('Pasá por recepción.')
  })

  it('módulo apagado o dispositivo revocado: borra el token y muestra que no está activado', async () => {
    await mount()
    routes['/api/checkin/lookup'] = () => fail(403, { error: 'feature_disabled' })
    await typeDni('30111222')
    await click(key('Confirmar'))
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(text()).toContain('Este dispositivo no está activado para Ingreso Físico')
  })

  it('salida: passkey de socio → aviso y sigue; passkey de admin → borra el token y va al login', async () => {
    routes['/api/checkin/exit/options'] = () => Promise.resolve({ cid: 'c1', options: { challenge: 'x' } })
    routes['/api/checkin/exit/verify'] = () => fail(403, { error: 'forbidden' })
    assertionMock.mockResolvedValue({ id: 'cred' })
    await mount()
    await click(key('Salir de Ingreso Físico'))
    expect(text()).toContain('Para volver a usar este dispositivo, un admin tiene que activarlo de nuevo.')
    await click(buttons().find(b => b.textContent === 'Salir con passkey'))
    await flush()
    expect(text()).toContain('Esa passkey no es de un admin.')
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-123')
    routes['/api/checkin/exit/verify'] = () => Promise.resolve({ ok: true })
    await click(key('Salir de Ingreso Físico'))
    await click(buttons().find(b => b.textContent === 'Salir con passkey'))
    await flush()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(text()).toContain('Ingresar con passkey')
  })

  it('con token y sin sesión, cualquier ruta lleva a la pantalla de Ingreso Físico', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-123')
    window.history.replaceState(null, '', '/#/home')
    useStore.setState({ boot: () => {}, ready: true, user: null, licenseExpired: false, accountEnded: null })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<App />) })
    await flush()
    expect(window.location.hash).toBe('#/ingreso-fisico')
    expect(text()).toContain('Ingresá tu DNI')
  })
})
