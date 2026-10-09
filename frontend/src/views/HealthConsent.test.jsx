// @vitest-environment happy-dom
// Datos de salud (Ley 25.326, art. 7) con la App real: la pregunta de una vez a las cuentas de
// antes, qué se oculta sin consentimiento (Nutrición, peso corporal), retirarlo / darlo desde
// Ajustes, borrar a pedido, y el admin deshabilitado para ese socio.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
vi.mock('../lib/onboarding.js', () => ({ startTourA: vi.fn(), esperarElemento: vi.fn() }))

let consent, legalSent
apiMock.mockImplementation((url, opts = {}) => {
  if (url === '/api/me/legal') {
    legalSent = JSON.parse(opts.body).version
    if (legalSent !== '2026-10-01') return Promise.reject(Object.assign(new Error('x'), { status: 409, data: { error: 'legal_version_changed', version: '2026-10-01' } }))
    return Promise.resolve({ legal: { version: legalSent, accepted: true } })
  }
  if (url === '/api/me/health-consent') { consent = JSON.parse(opts.body).granted ? 'granted' : 'declined'; return Promise.resolve({ healthConsent: consent }) }
  if (url === '/api/me/health-data/delete') return Promise.resolve({ ok: true })
  if (url === '/api/data') return Promise.resolve({ state: null })
  if (url === '/api/privacy') return Promise.resolve({ gymName: '', fields: [] })
  return Promise.resolve({})
})

const { useStore, DEF } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { default: App } = await import('../App.jsx')
const { setLang } = await import('../lib/i18n.js')
const { AdminManageSheet } = await import('./admin/shared.jsx')
await import('./HealthConsent.jsx'); await import('./Home.jsx'); await import('./Settings.jsx')

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const flush = async () => { for (let i = 0; i < 10; i++) await tick() }
const text = () => document.body.textContent
const button = label => [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === label).at(-1)
const click = async el => { expect(el).toBeTruthy(); await act(async () => { el.click() }); await flush() }
const tabs = () => [...document.querySelectorAll('#tabbar button')].map(b => b.textContent)

let root, container
async function mount(hash, state = {}, S = {}) {
  window.history.replaceState(null, '', '/' + hash)
  useStore.setState({
    boot: () => {}, ready: true, licenseExpired: false, membershipBlocked: false, accountPending: false, profilePrompt: null,
    user: { id: 'u1', name: 'juan', admin: false }, healthAsk: false, healthConsent: 'granted', legalAsk: false, legalVersion: '2026-10-01',
    S: { ...JSON.parse(JSON.stringify(DEF)), onboardingCompletado: true, ...S }, ...state
  })
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
  consent = null
  legalSent = null
  localStorage.clear()
  useUI.setState({ sheets: [] })
})
afterEach(async () => {
  if (!root) return
  await act(async () => { root.unmount() })
  container.remove()
  root = null
})

describe('consentimiento de datos de salud', () => {
  it('cuenta de antes: se pregunta una vez; sin consentimiento se ocultan Nutrición y el peso corporal', async () => {
    await mount('#/home', { healthAsk: true, healthConsent: null })
    expect(text()).toContain('Tus datos de salud')
    expect(text()).toContain('peso, edad, género, lesiones, nutrición y suplementos')
    expect(text()).toContain('opcional')
    expect(document.querySelector('#tabbar')).toBeNull()
    // Solo falta la salud (los términos ya están aceptados): sin "Salir", se sigue sin darla.
    expect(button('Salir')).toBeUndefined()
    await click(button('Continuar'))
    expect(legalSent).toBeNull()
    expect(consent).toBe('declined')
    expect(localStorage.getItem('gym_health_consent')).toBe('declined')
    expect(text()).not.toContain('Tus datos de salud')
    expect(tabs().join()).not.toContain('Nutrición')
    expect(document.querySelector('[data-tour="bw-card"]')).toBeNull()
  })

  it('con consentimiento, todo como siempre', async () => {
    await mount('#/home')
    expect(tabs().join()).toContain('Nutrición')
    expect(document.querySelector('[data-tour="bw-card"]')).toBeTruthy()
  })

  it('sin consentimiento /nutricion vuelve a Inicio', async () => {
    await mount('#/nutricion', { healthConsent: 'declined' })
    expect(window.location.hash).toBe('#/home')
  })

  it('Ajustes: retirarlo, borrar los datos a pedido y volver a darlo', async () => {
    await mount('#/settings', {}, { edad: 30, altura: 170, bodyweight: [{ d: '2026-09-01', w: 70, t: 1 }] })
    expect(text()).toContain('Edad')
    await click([...document.querySelectorAll('.lrow')].find(r => r.textContent.startsWith('Datos de salud')))
    await click(button('Retirar el consentimiento'))
    expect(consent).toBe('declined')
    expect(useStore.getState().healthConsent).toBe('declined')
    await click(button('Borrar mis datos de salud'))
    expect(text()).toContain('Se borran para siempre')
    await click(button('Sí, borrar mis datos de salud'))
    expect(apiMock).toHaveBeenCalledWith('/api/me/health-data/delete', { method: 'POST', body: '{}' })
    const S = useStore.getState().S
    expect([S.edad, S.altura, S.bodyweight]).toEqual([null, null, []])
    // Sin consentimiento, Ajustes no muestra edad ni altura.
    expect([...document.querySelectorAll('.lrow-t')].map(e => e.textContent)).not.toContain('Edad')
    await click([...document.querySelectorAll('.lrow')].find(r => r.textContent.startsWith('Datos de salud')))
    await click(button('Dar mi consentimiento'))
    expect(useStore.getState().healthConsent).toBe('granted')
  })

  it('admin: nutrición deshabilitada para un socio sin consentimiento', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<AdminManageSheet userId="x" userName="ana" healthConsent="declined" close={() => {}} setOnBack={() => {}} />) })
    await flush()
    expect(text()).toContain('Sin consentimiento de datos de salud')
    expect(apiMock.mock.calls.some(([u]) => u.includes('/nutrition'))).toBe(false)
  })

  it('términos sin aceptar: obligatorios, con los dos textos a mano; salud opcional en la misma pantalla', async () => {
    await mount('#/home', { legalAsk: true, healthAsk: true, healthConsent: null })
    expect(text()).toContain('Antes de seguir')
    expect(document.querySelector('#tabbar')).toBeNull()
    expect(button('Continuar').disabled).toBe(true)
    // Los textos se abren adentro de la pantalla y se vuelve sin perder nada.
    await click(button('términos y condiciones'))
    expect(text()).toContain('Salud y entrenamiento')
    await click(button('Volver'))
    expect(document.querySelector('.consent-accept input').checked).toBe(false)   // el link no marca el check
    await act(async () => { document.querySelector('.consent-accept input').click() })
    await act(async () => { document.querySelector('[role="switch"][aria-label="Datos de salud"]').click() })
    await click(button('Continuar'))
    expect(legalSent).toBe('2026-10-01')
    expect(consent).toBe('granted')
    expect(useStore.getState().legalAsk).toBe(false)
    expect(text()).not.toContain('Antes de seguir')
    expect(tabs().join()).toContain('Nutrición')
  })

  it('si los textos cambiaron mientras los leía, pide revisarlos de nuevo', async () => {
    await mount('#/home', { legalAsk: true, legalVersion: '2026-01-01' })
    await act(async () => { document.querySelector('.consent-accept input').click() })
    await click(button('Continuar'))
    expect(text()).toContain('Los textos se actualizaron recién')
    expect(useStore.getState().legalVersion).toBe('2026-10-01')
    expect(button('Continuar').disabled).toBe(true)
  })

  it('"Salir" cierra la sesión sin aceptar', async () => {
    const signOut = vi.fn()
    await mount('#/home', { legalAsk: true, signOut })
    await click(button('Salir'))
    expect(signOut).toHaveBeenCalled()
    expect(legalSent).toBeNull()
  })
})
