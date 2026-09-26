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
const button = label => [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === label).at(-1)
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
    expect(create().disabled).toBe(true)   // falta aceptar el aviso
    await accept()
    expect(create().disabled).toBe(false)
    registerMock.mockResolvedValue({ id: 'u1', name: 'juan', admin: false, pending: false })
    await click(create())
    expect(registerMock).toHaveBeenCalledWith('juan', '', null, { profile: { fullName: 'Juan Pérez', dni: '40123456' }, privacyAccepted: true })
    expect(useStore.getState().user).toEqual({ id: 'u1', name: 'juan', admin: false })
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
    registerMock.mockResolvedValue({ id: 'u1', name: 'pepe', admin: false, pending: true })
    await click(button('Crear passkey'))
    expect(registerMock).toHaveBeenCalledWith('pepe', '', null, {})
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

  it('guardar pide los obligatorios y aceptar el aviso', async () => {
    await mount({ user: { id: 'u1', name: 'juan', admin: false }, ...prompt })
    expect(button('Guardar').disabled).toBe(true)
    await type(fieldInput('Nombre y apellido'), 'Juan Pérez')
    await type(fieldInput('DNI'), '40123456')
    expect(button('Guardar').disabled).toBe(true)
    await accept()
    await click(button('Guardar'))
    expect(apiMock).toHaveBeenCalledWith('/api/me/profile', { method: 'POST', body: JSON.stringify({ profile: { fullName: 'Juan Pérez', dni: '40123456' }, privacyAccepted: true }) })
    expect(text()).not.toContain('Completá tus datos')
  })
})
