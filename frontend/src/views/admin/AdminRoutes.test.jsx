// @vitest-environment happy-dom
// Mounts the real App (HashRouter + Shell) on /admin/* and walks it the way an operator does:
// redirects, guards, hidden tabs, the shared #app key that keeps the layout (and its 15 s poll)
// alive across sections, and the Usuarios detail panel on desktop vs. the sheet on a phone.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
vi.mock('html5-qrcode/third_party/zxing-js.umd.js', () => ({
  BrowserMultiFormatReader: class {},
  QRCodeWriter: class { encode() { return { getWidth: () => 1, get: () => false } } },
  BarcodeFormat: {},
}))

// happy-dom has no 2D canvas (QrCanvas draws into one) and no layout for media queries.
window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {} })
window.HTMLCanvasElement.prototype.toDataURL = () => ''
let desktop = false
window.matchMedia = query => ({
  matches: query.includes('min-width: 1000px') ? desktop : false,
  media: query, addEventListener() {}, removeEventListener() {},
})

let auditOn
const ANA = { id: 'a', name: 'ana', lastSync: Date.now(), workouts: 1 }
apiMock.mockImplementation(url => {
  if (url === '/api/admin/users') return Promise.resolve({ users: [ANA], invite_only: false, audit_enabled: auditOn })
  if (url === '/api/admin/invites') return Promise.resolve({ invites: [] })
  if (url === '/api/presets') return Promise.resolve({ presets: [] })
  if (url === '/api/admin/attendance-heatmap') return Promise.resolve({ start: 'monday', totalUsers: 1, days: {} })
  if (url === '/api/owner/qr') return Promise.resolve({ token: 'qr-token' })
  if (url.startsWith('/api/admin/audit')) return Promise.resolve({ enabled: auditOn, events: [], total: 0, retention: {}, now: Date.now() })
  if (url.startsWith('/api/admin/user?id=')) return Promise.resolve({ user: { id: 'a', name: 'ana', created: '2026-01-01' }, workouts: [], bodyweight: [], routines: [], lastSync: Date.now(), unit: 'kg' })
  return Promise.resolve({})
})

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { default: App } = await import('../../App.jsx')
const { setLang } = await import('../../lib/i18n.js')

// Lazy sections resolve over a few macrotasks (more on a cold transform): flush until no
// Suspense fallback is left and a navigation that was pending in a transition has landed.
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const flush = async () => {
  for (let i = 0; i < 5; i++) await tick()
  for (let i = 0; i < 150 && document.querySelector('.page-loading'); i++) await tick()
  for (let i = 0; i < 5; i++) await tick()
}
const go = async hash => {
  await act(async () => { window.location.hash = hash; window.dispatchEvent(new PopStateEvent('popstate')) })
  await flush()
}
const tabs = () => [...document.querySelectorAll('.admin-nav a')].map(a => a.textContent + (a.classList.contains('on') ? '*' : ''))
const text = () => document.body.textContent
const usersCalls = () => apiMock.mock.calls.filter(([u]) => u === '/api/admin/users').length

let root, container
async function mount(hash, user) {
  window.location.hash = hash
  useStore.setState({ boot: () => {}, ready: true, user, licenseExpired: false })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<App />) })
  await flush()
}

const ADMIN = { id: 'x', name: 'x', admin: true, owner: false }
const OWNER = { id: 'o', name: 'o', admin: true, owner: true }

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  auditOn = true
  desktop = false
  apiMock.mockClear()
  useUI.setState({ sheets: [] })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
})

describe('admin routes', () => {
  it('/admin and unknown sections land on Resumen', async () => {
    await mount('#/admin', ADMIN)
    expect(window.location.hash).toBe('#/admin/resumen')
    expect(tabs()).toContain('Resumen*')
    await go('#/admin/nope')
    expect(window.location.hash).toBe('#/admin/resumen')
  })

  it('a non-admin is sent home', async () => {
    await mount('#/admin/usuarios', { id: 'u', name: 'u', admin: false })
    expect(window.location.hash).toBe('#/home')
  })

  it('switching sections keeps #app mounted and does not re-fetch or restart the poll', async () => {
    await mount('#/admin/resumen', ADMIN)
    const app = document.querySelector('#app')
    expect(usersCalls()).toBe(1)
    await go('#/admin/usuarios')
    await go('#/admin/cuotas')
    expect(document.querySelector('#app')).toBe(app)
    expect(usersCalls()).toBe(1)
    expect(text()).toContain('Próximamente')
  })

  it('QR is owner only: hidden tab and redirect for a plain admin', async () => {
    await mount('#/admin/qr', ADMIN)
    expect(window.location.hash).toBe('#/admin/resumen')
    expect(tabs()).not.toContain('QR')
  })

  it('the owner gets the QR section', async () => {
    await mount('#/admin/qr', OWNER)
    expect(tabs()).toContain('QR*')
    expect(text()).toContain('qr-token')
  })

  it('Logs is hidden and redirects when the audit log is off', async () => {
    auditOn = false
    await mount('#/admin/logs', ADMIN)
    expect(tabs().some(x => x.startsWith('Logs'))).toBe(false)
    expect(window.location.hash).toBe('#/admin/resumen')
  })

  it('the Logs tab comes from the users poll, without probing the audit log', async () => {
    auditOn = false
    await mount('#/admin/resumen', ADMIN)
    expect(tabs().some(x => x.startsWith('Logs'))).toBe(false)
    expect(apiMock.mock.calls.some(([u]) => u.startsWith('/api/admin/audit'))).toBe(false)
  })

  it('the app tab bar is marked on /admin/* only', async () => {
    await mount('#/admin/resumen', ADMIN)
    expect(document.querySelector('#tabbar').className).toBe('admin')
    await go('#/home')
    expect(document.querySelector('#tabbar').className).toBe('')
  })
})

describe('Usuarios: member detail', () => {
  const clickAna = async () => {
    const item = [...document.querySelectorAll('.admin-users .item')].find(el => el.textContent.includes('ana'))
    expect(item).toBeTruthy()
    await act(async () => { item.click() })
    await flush()
  }

  it('on desktop, selecting a member fills the side panel instead of opening a sheet', async () => {
    desktop = true
    await mount('#/admin/usuarios', ADMIN)
    expect(document.querySelector('.admin-user-panel').textContent).toContain('Seleccioná un socio')
    await clickAna()
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(document.querySelector('#modal-root')).toBeNull()
    expect(document.querySelector('.admin-user-panel h3').textContent).toBe('ana')
    expect(document.querySelector('.admin-users .item.on').textContent).toContain('ana')
  })

  it('on a phone, selecting a member opens UserDetail in a sheet', async () => {
    await mount('#/admin/usuarios', ADMIN)
    expect(document.querySelector('.admin-user-panel')).toBeNull()
    await clickAna()
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(document.querySelector('#modal-root h3').textContent).toBe('ana')
    expect(document.querySelector('.admin-users .item.on')).toBeNull()
  })
})
