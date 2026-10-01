// @vitest-environment happy-dom
// Admin → Personalización: borrador, color con "solo el del gym", vista previa y guardado; y en
// Ajustes, la paleta se oculta con el color bloqueado.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { setLang } = await import('../../lib/i18n.js')
const { default: Personalizacion } = await import('./Personalizacion.jsx')

const FACTORY = { appName: 'lauyim', shortName: '', tagline: '', color: null, lockColor: false, logo: null }
let root, container
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
const mount = async el => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(el) })
  for (let i = 0; i < 5; i++) await tick()
}
const button = label => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockReset()
  apiMock.mockImplementation((url, opts) => {
    if (url === '/api/owner/branding' && !opts) return Promise.resolve({ branding: FACTORY })
    if (url === '/api/owner/branding') return Promise.resolve({ branding: { ...JSON.parse(opts.body), logo: null } })
    return Promise.resolve({})
  })
})
afterEach(async () => { await act(async () => { root.unmount() }); container.remove(); useStore.setState({ config: null }) })

describe('Personalización', () => {
  it('nombre, color y "solo el del gym"; guarda y la app cambia en el acto', async () => {
    await mount(<Personalizacion />)
    expect(button('Guardar').disabled).toBe(true)
    await type(container.querySelector('input[name="app-brand-name"]'), 'Gym Centro')
    expect(container.textContent).toContain('con lauyim')
    const lock = () => container.querySelector('[role="switch"]')
    expect(lock().disabled).toBe(true)                 // sin color no se puede bloquear
    await act(async () => { container.querySelector('button[aria-label="#ff9f0a"]').click() })
    expect(lock().disabled).toBe(false)
    await act(async () => { lock().click() })
    await act(async () => { button('Guardar').click() })
    await tick()
    const [, opts] = apiMock.mock.calls.find(([u, o]) => u === '/api/owner/branding' && o?.method === 'PUT')
    expect(JSON.parse(opts.body)).toEqual({ appName: 'Gym Centro', shortName: '', tagline: '', color: '#ff9f0a', lockColor: true })
    expect(useStore.getState().config.branding).toMatchObject({ appName: 'Gym Centro', color: '#ff9f0a', lockColor: true })
  })

  it('guardar espera la subida (el logo pesa MB) y un 413 dice que la imagen es muy pesada', async () => {
    await mount(<Personalizacion />)
    await type(container.querySelector('input[name="app-brand-name"]'), 'Gym Centro')
    await act(async () => { button('Guardar').click() })
    await tick()
    const [, opts] = apiMock.mock.calls.find(([u, o]) => u === '/api/owner/branding' && o?.method === 'PUT')
    // El default de api() corta a los 8 s: con 1 a 5 MB por datos móviles no alcanza.
    expect(opts.timeoutMs).toBeGreaterThanOrEqual(60000)
    apiMock.mockImplementation((url, o) => o?.method === 'PUT'
      ? Promise.reject(Object.assign(new Error('HTTP 413'), { status: 413, data: {} }))
      : Promise.resolve({ branding: FACTORY }))
    await type(container.querySelector('input[name="app-brand-name"]'), 'Gym Otro')
    await act(async () => { button('Guardar').click() })
    await tick()
    expect(useUI.getState().toastMsg).toMatch(/demasiado pesada/)
  })

  it('la vista previa muestra el nombre bajo el ícono, cortado, y el login con la frase', async () => {
    await mount(<Personalizacion />)
    await type(container.querySelector('input[name="app-brand-name"]'), 'Gimnasio Centro Norte')
    await type(container.querySelector('input[name="app-brand-tagline"]'), 'Entrená mejor')
    await act(async () => { button('Vista previa').click() })
    expect(container.querySelector('.pv-app-mine .pv-label').textContent).toBe('Gimnasio Cen')
    await act(async () => { button('Login').click() })
    expect(container.querySelector('.pv-login-name').textContent).toBe('Gimnasio Centro Norte')
    expect(container.querySelector('.pv-login-tag').textContent).toBe('Entrená mejor')
    await act(async () => { button('Cerrar').click() })
    expect(container.querySelector('.pv-overlay')).toBeNull()
  })
})
