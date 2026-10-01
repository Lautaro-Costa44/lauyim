// @vitest-environment happy-dom
// Registro con datos / aprobación del staff (spec 12.3 y 12.6), con la App real:
// sin aprobación el registro pide los campos del gym y aceptar el aviso; con aprobación, solo el
// usuario y la cuenta queda pendiente (pantalla con Reintentar); y el formulario de una sola vez.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
const registerMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock, webauthnOK: () => true, passkeyRegister: registerMock }))

const fail = (status, data) => Promise.reject(Object.assign(new Error(data.message || data.error), { status, data }))
const FIELDS = { full_name: { enabled: true, required: true }, dni: { enabled: true, required: true }, phone: { enabled: true, required: false }, email: { enabled: false, required: false } }
let me
apiMock.mockImplementation((url, opts = {}) => {
  if (url === '/api/me') return Promise.resolve(me)
  if (url === '/api/privacy') return Promise.resolve({ gymName: 'Gym', contact: '', fields: [], billingEnabled: false })
  if (url === '/api/data') return Promise.resolve({ state: null })
  return Promise.resolve({})
})

const { useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { default: App } = await import('../App.jsx')
const { setLang } = await import('../lib/i18n.js')
await import('./ProfileOnce.jsx')

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const flush = async () => { for (let i = 0; i < 8; i++) await tick() }
const text = () => document.body.textContent
// Las opciones del login son tarjetas: se buscan por su título.
const button = label => [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === label || b.querySelector('.login-option-t')?.textContent === label).at(-1)
const click = async el => { expect(el).toBeTruthy(); await act(async () => { el.click() }); await flush() }
const type = async (el, value) => {
  expect(el).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const fieldInput = label => [...document.querySelectorAll('.member-field')]
  .filter(f => f.querySelector('.member-field-l').textContent.replace(/ \*$/, '') === label).at(-1)?.querySelector('input')
const accept = async () => {
  const box = document.querySelector('.privacy-accept input')
  await act(async () => { box.click() })
  await flush()
}

let root, container
async function mount(state) {
  window.history.replaceState(null, '', '/#/home')
  useStore.setState({ boot: () => {}, ready: true, user: null, licenseExpired: false, membershipBlocked: false, accountPending: false, profilePrompt: null, ...state })
  useStore.getState().setGuest(false)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<App />) })
  await flush()
}
const config = registration => ({ config: { invite_only: false, allow_guest: false, registration } })

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockClear()
  registerMock.mockReset()
  me = { user: { id: 'u1', name: 'juan', admin: false }, pending: false, profilePrompt: null, billingEnabled: false, billing: null }
  useUI.setState({ sheets: [] })
  try { localStorage.clear() } catch { /* */ }
})
afterEach(async () => {
  if (!root) return
  await act(async () => { root.unmount() })
  container.remove()
  root = null
})

describe('registro sin aprobación', () => {
  it('pide los campos del gym y aceptar el aviso; manda el perfil', async () => {
    await mount(config({ approval: false, fields: FIELDS }))
    await click(button('Crear nuevo perfil'))
    expect(fieldInput('Nombre y apellido')).toBeTruthy()
    expect(fieldInput('DNI')).toBeTruthy()
    expect(fieldInput('Celular')).toBeTruthy()
    expect(fieldInput('Mail')).toBeUndefined()
    await type(document.querySelector('input[placeholder="Tu nombre"]'), 'juan')
    await type(fieldInput('Nombre y apellido'), 'Juan Pérez')
    await type(fieldInput('DNI'), '40.123.456')
    expect(fieldInput('DNI').value).toBe('40123456')
    const create = () => button('Crear passkey')
    expect(create().disabled).toBe(true)   // falta aceptar los términos y el aviso
    // Dos decisiones: los términos y el aviso (obligatorio) y los datos de salud (opcional).
    const checks = document.querySelectorAll('.privacy-accept')
    expect(checks).toHaveLength(2)
    expect(checks[0].textContent).toContain('términos y condiciones')
    expect(checks[1].textContent).toContain('datos de salud (peso, edad, género, lesiones y nutrición)')
    expect(checks[1].textContent).toContain('(opcional)')
    await accept()
    expect(create().disabled).toBe(false)   // la salud no hace falta
    registerMock.mockResolvedValue({ id: 'u1', name: 'juan', admin: false, pending: false })
    await click(create())
    expect(registerMock).toHaveBeenCalledWith('juan', '', null, { legalAccepted: true, healthConsent: false, profile: { fullName: 'Juan Pérez', dni: '40123456' }, privacyAccepted: true })
    expect(useStore.getState().healthConsent).toBe('declined')
    expect(useStore.getState().user).toEqual({ id: 'u1', name: 'juan', admin: false })
  })

  it('"Crear passkey" marca todos los campos con error (usuario incluido), foco en el primero, sin crear nada', async () => {
    await mount(config({ approval: false, fields: FIELDS }))
    await click(button('Crear nuevo perfil'))
    await type(fieldInput('DNI'), '123')
    await type(fieldInput('Celular'), '12')
    await accept()
    await click(button('Crear passkey'))
    expect(text()).toContain('El nombre de usuario es obligatorio')
    expect(text()).toContain('Nombre y apellido es obligatorio')
    expect(text()).toContain('El DNI debe tener entre 6 y 8 dígitos')
    expect(text()).toContain('El celular debe tener al menos 8 dígitos')
    const username = document.querySelector('input[placeholder="Tu nombre"]')
    expect(username.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(username)
    expect(registerMock).not.toHaveBeenCalled()
    await type(username, 'juan')
    await flush()
    expect(text()).not.toContain('El nombre de usuario es obligatorio')
    expect(text()).toContain('El DNI debe tener entre 6 y 8 dígitos')
  })

  it('los errores por campo del servidor (validation_error con fields) se marcan en cada campo', async () => {
    await mount(config({ approval: false, fields: FIELDS }))
    await click(button('Crear nuevo perfil'))
    await type(document.querySelector('input[placeholder="Tu nombre"]'), 'juan')
    await type(fieldInput('Nombre y apellido'), 'Juan Pérez')
    await type(fieldInput('DNI'), '40123456')
    await accept()
    registerMock.mockImplementation(() => fail(400, { error: 'validation_error', message: 'Celular inválido', field: 'phone', fields: { phone: 'Celular inválido', full_name: 'Nombre y apellido inválido' } }))
    await click(button('Crear passkey'))
    expect(fieldInput('Celular').getAttribute('aria-invalid')).toBe('true')
    expect(fieldInput('Nombre y apellido').getAttribute('aria-invalid')).toBe('true')
    expect(text()).toContain('Celular inválido')
    expect(document.activeElement).toBe(fieldInput('Nombre y apellido'))   // el primero en pantalla
  })

  it('DNI que ya existe: el mensaje de recepción, sin crear nada', async () => {
    await mount(config({ approval: false, fields: FIELDS }))
    await click(button('Crear nuevo perfil'))
    await type(document.querySelector('input[placeholder="Tu nombre"]'), 'juan')
    await type(fieldInput('Nombre y apellido'), 'Juan Pérez')
    await type(fieldInput('DNI'), '30111222')
    await accept()
    registerMock.mockImplementation(() => fail(409, { error: 'dni_exists', message: 'Ya hay un socio con este DNI. Pedí en recepción tu código de vinculación' }))
    await click(button('Crear passkey'))
    expect(text()).toContain('Ya hay un socio con este DNI. Pedí en recepción tu código de vinculación')
    expect(useStore.getState().user).toBeNull()
  })
})

describe('registro con aprobación', () => {
  it('solo el usuario; queda pendiente con Reintentar', async () => {
    await mount(config({ approval: true, fields: FIELDS }))
    await click(button('Crear nuevo perfil'))
    expect(fieldInput('DNI')).toBeUndefined()
    expect(text()).toContain('acercate a recepción para que habiliten tu cuenta')
    await type(document.querySelector('input[placeholder="Tu nombre"]'), 'pepe')
    // Con aprobación también se piden los términos; la salud, opcional, se da acá.
    expect(button('Crear passkey').disabled).toBe(true)
    await accept()
    await act(async () => { document.querySelectorAll('.privacy-accept input')[1].click() })
    registerMock.mockResolvedValue({ id: 'u1', name: 'pepe', admin: false, pending: true })
    await click(button('Crear passkey'))
    expect(registerMock).toHaveBeenCalledWith('pepe', '', null, { legalAccepted: true, healthConsent: true })
    expect(text()).toContain('Tu cuenta está pendiente, acercate a recepción')
    expect(localStorage.getItem('gym_account_pending')).toBe('1')
    // Reintentar: sigue pendiente.
    me = { ...me, pending: true }
    await click(button('Reintentar'))
    expect(useUI.getState().toastMsg).toBe('Tu cuenta sigue pendiente. Acercate a recepción para que la habiliten.')
    // Ya la habilitaron.
    me = { ...me, pending: false }
    await click(button('Reintentar'))
    expect(text()).not.toContain('Tu cuenta está pendiente')
    expect(localStorage.getItem('gym_account_pending')).toBeNull()
  })

  it('un 403 account_pending de la API también muestra la pantalla', async () => {
    await mount({ user: { id: 'u1', name: 'pepe', admin: false } })
    await act(async () => { window.dispatchEvent(new CustomEvent('gym:account_pending')) })
    await flush()
    expect(text()).toContain('Cuenta pendiente')
  })

  it('staff nunca queda pendiente', async () => {
    await mount({ user: { id: 'o', name: 'owner', admin: true }, accountPending: true })
    expect(text()).not.toContain('Tu cuenta está pendiente')
  })
})

describe('formulario de una sola vez', () => {
  const prompt = { profilePrompt: { fields: FIELDS } }
  it('"Ahora no" lo cierra y avisa al servidor', async () => {
    await mount({ user: { id: 'u1', name: 'juan', admin: false }, ...prompt })
    expect(text()).toContain('Completá tus datos')
    await click(button('Ahora no'))
    expect(apiMock).toHaveBeenCalledWith('/api/me/profile', { method: 'POST', body: JSON.stringify({ skip: true }) })
    expect(text()).not.toContain('Completá tus datos')
  })

  it('guardar pide aceptar el aviso y marca los datos con error en cada campo', async () => {
    await mount({ user: { id: 'u1', name: 'juan', admin: false }, ...prompt })
    expect(button('Guardar').disabled).toBe(true)          // sin aceptar el aviso
    await accept()
    await type(fieldInput('DNI'), '12')
    await click(button('Guardar'))
    expect(text()).toContain('Nombre y apellido es obligatorio')
    expect(text()).toContain('El DNI debe tener entre 6 y 8 dígitos')
    // (El foco en el primero lo prueba el registro; acá lo pisa un sheet que dejan los tests anteriores.)
    expect(fieldInput('Nombre y apellido').getAttribute('aria-invalid')).toBe('true')
    expect(apiMock).not.toHaveBeenCalledWith('/api/me/profile', expect.anything())
    await type(fieldInput('Nombre y apellido'), 'Juan Pérez')
    await type(fieldInput('DNI'), '40123456')
    await click(button('Guardar'))
    expect(apiMock).toHaveBeenCalledWith('/api/me/profile', { method: 'POST', body: JSON.stringify({ profile: { fullName: 'Juan Pérez', dni: '40123456' }, privacyAccepted: true, legalAccepted: true }) })
    await flush()
    expect(text()).not.toContain('Completá tus datos')
  })
})
