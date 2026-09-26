// @vitest-environment happy-dom
// Aviso de privacidad: página pública (sin sesión y con la licencia vencida), con el responsable
// y el contacto del gym, los datos según la config, y links desde el login y el registro.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock, webauthnOK: () => true }))

let privacy
apiMock.mockImplementation(url => {
  if (url === '/api/privacy') return Promise.resolve(privacy)
  return Promise.resolve({})
})

const { useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { default: App } = await import('../App.jsx')
const { setLang } = await import('../lib/i18n.js')

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const flush = async () => { for (let i = 0; i < 8; i++) await tick() }
const text = () => document.body.textContent
const button = label => [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === label).at(-1)
const click = async el => { expect(el).toBeTruthy(); await act(async () => { el.click() }); await flush() }

let root, container
async function mount(hash, state = {}) {
  window.history.replaceState(null, '', '/' + hash)
  useStore.setState({ boot: () => {}, ready: true, user: null, licenseExpired: false, ...state })
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
  privacy = { gymName: 'Gimnasio Norte', contact: 'privacidad@norte.com.ar', fields: ['full_name', 'dni'], billingEnabled: true, auditDays: 90 }
  useUI.setState({ sheets: [] })
})
afterEach(async () => {
  if (!root) return
  await act(async () => { root.unmount() })
  container.remove()
  root = null
})

describe('/privacidad', () => {
  it('se ve sin sesión, con responsable, encargado, datos pedidos, derechos, AAIP y contacto', async () => {
    await mount('#/privacidad')
    expect(apiMock).toHaveBeenCalledWith('/api/privacy')
    const body = text()
    expect(body).toContain('Borrador para revisión legal')
    expect(body).toContain('El responsable de la base de datos es Gimnasio Norte')
    expect(body).toContain('encargado del tratamiento')
    expect(body).toContain('Tus datos de socio: nombre y apellido, DNI.')
    expect(body).toContain('Tu cuota: plan, vencimientos')
    expect(body).toContain('Ley 25.326')
    expect(body).toContain('AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA')
    expect(body).toContain('a los 90 días')
    expect(body).toContain('privacidad@norte.com.ar')
    // No es el login ni la app: sin TabBar.
    expect(body).not.toContain('Ingresar con passkey')
    expect(document.querySelector('.tabbar')).toBeNull()
  })

  it('sin config: "el gimnasio", recepción, y sin cuotas ni campos que no se piden', async () => {
    privacy = { gymName: '', contact: '', fields: [], billingEnabled: false, auditDays: null }
    await mount('#/privacidad')
    const body = text()
    expect(body).toContain('El responsable de la base de datos es el gimnasio')
    expect(body).toContain('acercate a la recepción del gimnasio')
    expect(body).not.toContain('Tus datos de socio')
    expect(body).not.toContain('Tu cuota')
  })

  it('se ve también con la licencia vencida', async () => {
    await mount('#/privacidad', { licenseExpired: true })
    expect(text()).toContain('El responsable de la base de datos es Gimnasio Norte')
  })

  it('Volver sin historial lleva al login', async () => {
    await mount('#/privacidad')
    await click(button('Volver'))
    expect(window.location.hash).toBe('#/home')
    expect(text()).toContain('Ingresar con passkey')
  })
})

describe('links', () => {
  it('el login linkea al aviso', async () => {
    await mount('#/home')
    const link = [...document.querySelectorAll('a')].find(a => a.textContent === 'Aviso de privacidad')
    expect(link.getAttribute('href')).toBe('#/privacidad')
  })

  it('el registro lo abre como paso interno y vuelve con lo escrito', async () => {
    await mount('#/home')
    await click(button('Crear nuevo perfil'))
    const input = document.querySelector('input[name="app-profile-name"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'juan')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button('Aviso de privacidad'))
    expect(text()).toContain('El responsable de la base de datos es Gimnasio Norte')
    await click(button('Volver'))
    // El input se renombra (anti-autofill): se busca por placeholder.
    expect(document.querySelector('input[placeholder="Tu nombre"]').value).toBe('juan')
    expect(text()).not.toContain('El responsable de la base de datos')
  })
})
