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
let billingOn
let dniEnabled
let anaCreated = '2026-01-01'
let approval = { required: false, mode: 'approve' }
let checkin = { enabled: false, mode: 'full', digits: 4, showStatus: true }
let devices = []
const ANA = { id: 'a', name: 'ana', lastSync: Date.now(), workouts: 1, hasApp: true }
// A member record without a passkey: listed in Usuarios, never counted in Resumen.
const FICHA = { id: 'f', name: 'ficha', lastSync: null, workouts: 0, hasApp: false, disabled: true }
const FIELDS = () => ({ full_name: { enabled: true, required: true }, dni: { enabled: dniEnabled, required: dniEnabled }, phone: { enabled: true, required: true }, email: { enabled: true, required: false } })
apiMock.mockImplementation((url, opts) => {
  if (url === '/api/admin/users') return Promise.resolve({ users: [ANA, FICHA], invite_only: false, audit_enabled: auditOn, billing_enabled: billingOn, checkin_enabled: checkin.enabled })
  if (url.split('?')[0] === '/api/admin/checkin') return Promise.resolve({ settings: checkin, billingEnabled: billingOn, today: '2026-09-24', devices, date: new URL('http://x' + url).searchParams.get('date') || '2026-09-24', checkins: !checkin.enabled ? [] : (new URL('http://x' + url).searchParams.get('date') || '2026-09-24') === '2026-09-24'
    ? [{ userId: 'a', fullName: 'Ana Pérez', nick: 'anita', source: 'physical', at: Date.UTC(2026, 8, 24, 12, 5), billing: { status: 'por_vencer', days: 3 } }, { userId: 'b', fullName: null, nick: 'beto', source: 'physical', at: Date.UTC(2026, 8, 24, 11, 0) }]
    : [] })
  if (url === '/api/owner/checkin/settings') { checkin = { ...checkin, ...JSON.parse(opts.body) }; if (checkin.enabled === false) devices = []; return Promise.resolve({ settings: checkin }) }
  if (url.startsWith('/api/admin/checkin/devices/') && opts?.method === 'DELETE') { devices = devices.filter(d => '/api/admin/checkin/devices/' + d.id !== url); return Promise.resolve({ ok: true }) }
  if (url === '/api/admin/members/settings') return Promise.resolve({ fields: FIELDS() })
  if (url === '/api/owner/billing/enable-preview') return Promise.resolve({ today: '2026-09-24', bloqueado: 2, vencido: 1, por_vencer: 3 })
  if (url === '/api/owner/billing/enabled') { billingOn = JSON.parse(opts.body).enabled; return Promise.resolve({ enabled: billingOn }) }
  if (url.startsWith('/api/admin/users/') && url.endsWith('/billing')) return Promise.resolve({ billing: { planId: null, status: 'sin_plan', debt: 0 }, payments: [] })
  if (url === '/api/admin/invites') return Promise.resolve({ invites: [] })
  if (url === '/api/admin/presets') return Promise.resolve({ presets: [] })
  if (url === '/api/admin/attendance-heatmap') return Promise.resolve({ start: 'monday', totalUsers: 1, days: {} })
  if (url === '/api/owner/qr') return Promise.resolve({ token: 'qr-token' })
  if (url === '/api/owner/supplements') return Promise.resolve({ enabled: true })
  if (url === '/api/admin/approval' || url === '/api/owner/approval') {
    if (opts?.method === 'PUT') approval = { ...approval, ...JSON.parse(opts.body) }
    return Promise.resolve({ ...approval, effectiveMode: billingOn ? approval.mode : 'approve', billingEnabled: billingOn, dniEnabled, pendingCount: approval.pendingCount ?? 0 })
  }
  if (url === '/api/owner/privacy') return Promise.resolve(opts?.method === 'PUT' ? JSON.parse(opts.body) : { gymName: '', contact: '' })
  if (url.startsWith('/api/admin/audit')) return Promise.resolve({ enabled: auditOn, events: [], total: 0, retention: {}, now: Date.now() })
  if (url === '/api/admin/billing') return Promise.resolve({ today: '2026-09-24', settings: {}, summary: { al_dia: 0, por_vencer: 0, vencido: 0, bloqueado: 0, sin_plan: 1, deuda_total: 0 }, members: [{ id: 'a', name: 'ana', disabled: false, admin: false, planId: null, planName: null, dueDate: null, status: 'sin_plan', debt: 0 }] })
  if (url === '/api/admin/billing/plans') return Promise.resolve({ plans: [] })
  if (url.startsWith('/api/admin/user?id=')) return Promise.resolve({ user: { id: 'a', name: 'ana', created: anaCreated }, workouts: [], bodyweight: [], routines: [], lastSync: Date.now(), unit: 'kg' })
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
const called = url => apiMock.mock.calls.some(([u]) => u === url)
const sheetText = () => document.querySelector('#modal-root')?.textContent || ''
const clickSwitch = async label => {
  const sw = document.querySelector(`[role="switch"][aria-label="${label}"]`)
  expect(sw, label).toBeTruthy()
  await act(async () => { sw.click() })
  await flush()
}
const clickButton = async (scope, label) => {
  const btn = [...scope.querySelectorAll('button')].find(b => b.textContent === label)
  expect(btn, label).toBeTruthy()
  await act(async () => { btn.click() })
  await flush()
}

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
  billingOn = true
  dniEnabled = true
  anaCreated = '2026-01-01'
  approval = { required: false, mode: 'approve' }
  checkin = { enabled: false, mode: 'full', digits: 4, showStatus: true }
  devices = []
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

  it('con rol: solo sus secciones, entra a la primera y un link a otra la devuelve ahí', async () => {
    const NUTRI = { id: 'n', name: 'n', admin: true, owner: false, role: { id: 'nutrition', name: 'Nutricionista', color: '#30d158' }, permissions: ['members.view', 'nutrition.manage', 'health.view'] }
    await mount('#/admin', NUTRI)
    expect(window.location.hash).toBe('#/admin/usuarios')
    expect(tabs()).toEqual(['Usuarios*', 'Volver a la app'])
    await go('#/admin/cuotas')
    expect(window.location.hash).toBe('#/admin/usuarios')
    // No pide lo que no puede ver.
    const asked = apiMock.mock.calls.map(([url]) => url)
    expect(asked).not.toContain('/api/admin/presets')
    expect(asked).not.toContain('/api/admin/attendance-heatmap')
    expect(asked).not.toContain('/api/admin/invites')
  })

  it('offline: every section shows the connection notice instead of a spinner, and recovers online', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    try {
      await mount('#/admin/usuarios', ADMIN)
      expect(text()).toContain('Esta sección requiere conexión a internet')
      expect(document.querySelector('.page-loading')).toBeNull()
      expect(tabs()).toContain('Usuarios*')   // the menu stays, so there is a way out
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
      await act(async () => { window.dispatchEvent(new Event('online')) })
      await flush()
      expect(text()).not.toContain('Esta sección requiere conexión a internet')
    } finally { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }) }
  })

  it('navigator.onLine says online but the server is unreachable: same notice, no toast spam, recovers', async () => {
    const real = apiMock.getMockImplementation()
    let down = true
    apiMock.mockImplementation((url, opts) => down && url.startsWith('/api/admin') ? Promise.reject(new TypeError('Failed to fetch')) : real(url, opts))
    try {
      await mount('#/admin/usuarios', ADMIN)
      expect(text()).toContain('Esta sección requiere conexión a internet')
      expect(text()).not.toContain('Failed to fetch')
      expect(useUI.getState().toasts?.length ?? 0).toBe(0)
      down = false
      await act(async () => { document.querySelector('.admin-nav a:nth-child(1)')?.click() })
      await flush()
    } finally { apiMock.mockImplementation(real) }
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
    expect(text()).toContain('Deuda total')
  })

  it('tab order: Resumen, Usuarios, Cuotas, Rutinas, Clases, Notificaciones, Acceso, Roles, Personalización, Ingreso Físico, Logs', async () => {
    await mount('#/admin/resumen', OWNER)
    expect(tabs()).toEqual(['Resumen*', 'Usuarios', 'Cuotas', 'Rutinas', 'Clases', 'Notificaciones', 'Acceso', 'Roles', 'Personalización', 'Ingreso Físico', 'Logs', 'Volver a la app'])
  })

  it('Personalización es solo del owner: un admin no la ve ni entra por el link', async () => {
    await mount('#/admin/personalizacion', ADMIN)
    expect(tabs()).not.toContain('Personalización')
    expect(tabs()).toContain('Resumen*')
  })

  it('/admin/qr redirects to Acceso', async () => {
    await mount('#/admin/qr', ADMIN)
    expect(window.location.hash).toBe('#/admin/acceso')
    // On a cold Acceso chunk the active tab lands a render after the first flush: settle on it.
    for (let i = 0; i < 50 && !tabs().includes('Acceso*'); i++) await tick()
    expect(tabs()).toContain('Acceso*')
  })

  it('a plain admin sees Acceso with only the invites', async () => {
    await mount('#/admin/acceso', ADMIN)
    expect(tabs()).toContain('Acceso*')
    expect(text()).toContain('Códigos de invitación')
    expect(text()).not.toContain('Acceso por QR')
    expect(text()).not.toContain('Datos del registro')
    expect(text()).not.toContain('Cobro de cuotas')
    expect(called('/api/owner/qr')).toBe(false)
    expect(called('/api/admin/members/settings')).toBe(false)
  })

  it('the owner gets the seven Acceso cards, in order', async () => {
    await mount('#/admin/acceso', OWNER)
    const titles = [...document.querySelectorAll('.admin-cards > .card h2')].map(h => h.textContent)
    expect(titles).toEqual(['Códigos de invitación', 'Acceso por QR', 'Datos del registro', 'Aprobación de cuentas', 'Aviso de privacidad', 'Cobro de cuotas', 'Suplementos'])
    expect(text()).toContain('qr-token')
    expect(text()).toContain('El nombre de usuario siempre se pide.')
    expect(text()).not.toContain('Sin DNI no se pueden detectar socios duplicados')
  })

  it('privacy notice: the owner saves the gym name and the contact', async () => {
    await mount('#/admin/acceso', OWNER)
    expect(text()).toContain('Completalos antes de cargar datos reales de socios.')
    const set = async (name, value) => {
      const input = document.querySelector(`input[placeholder="${name}"]`)
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await set('Ej. Gimnasio Norte de Juan Pérez', 'Gimnasio Norte')
    await set('Mail, WhatsApp o dirección de la recepción', 'hola@norte.com')
    const card = [...document.querySelectorAll('.admin-cards > .card')].find(c => c.querySelector('h2').textContent === 'Aviso de privacidad')
    await act(async () => { [...card.querySelectorAll('button')].find(b => b.textContent === 'Guardar').click() })
    await flush()
    const put = apiMock.mock.calls.find(([u, o]) => u === '/api/owner/privacy' && o?.method === 'PUT')
    expect(JSON.parse(put[1].body)).toEqual({ gymName: 'Gimnasio Norte', contact: 'hola@norte.com' })
    expect(text()).not.toContain('Completalos antes de cargar datos reales de socios.')
  })

  it('account approval: the switch reveals the modes; payment and trial need billing', async () => {
    billingOn = false
    await mount('#/admin/acceso', OWNER)
    expect(text()).not.toContain('Para habilitar una cuenta:')
    await clickSwitch('Requerir aprobación del staff')
    const put = apiMock.mock.calls.find(([u, o]) => u === '/api/owner/approval' && o?.method === 'PUT')
    expect(JSON.parse(put[1].body)).toEqual({ required: true })
    const radios = [...document.querySelectorAll('.approval-modes [role="radio"]')]
    expect(radios.map(r => r.querySelector('.lrow-t').textContent)).toEqual(['Aprobar', 'Registrar primer pago', 'Iniciar prueba'])
    expect(radios.map(r => r.disabled)).toEqual([false, true, true])
    expect(radios[1].textContent).toContain('Necesita el cobro de cuotas activado.')
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
  })

  it('account approval: turning it off with pending accounts warns first', async () => {
    approval = { required: true, mode: 'approve', pendingCount: 2 }
    await mount('#/admin/acceso', OWNER)
    await clickSwitch('Requerir aprobación del staff')
    expect(sheetText()).toContain('Hay 2 cuentas pendientes: habilitalas o siguen esperando.')
    expect(apiMock.mock.calls.some(([u, o]) => u === '/api/owner/approval' && o?.method === 'PUT')).toBe(false)
    await clickButton(document.querySelector('#modal-root'), 'Apagar')
    const put = apiMock.mock.calls.find(([u, o]) => u === '/api/owner/approval' && o?.method === 'PUT')
    expect(JSON.parse(put[1].body)).toEqual({ required: false })
  })

  it('invites moved out of Usuarios', async () => {
    await mount('#/admin/usuarios', ADMIN)
    expect(text()).not.toContain('Códigos de invitación')
  })

  it('registration fields: DNI off shows the warning and disables its "Obligatorio"', async () => {
    dniEnabled = false
    await mount('#/admin/acceso', OWNER)
    expect(text()).toContain('Sin DNI no se pueden detectar socios duplicados')
    expect(document.querySelector('[role="switch"][aria-label="DNI obligatorio"]').disabled).toBe(true)
    expect(document.querySelector('[role="switch"][aria-label="Celular obligatorio"]').disabled).toBe(false)
    const dniRow = [...document.querySelectorAll('.access-row')].find(r => r.querySelector('.access-name')?.textContent === 'DNI')
    expect(dniRow.querySelector('.access-warn').textContent).toBe('Sin DNI no se pueden detectar socios duplicados')
  })

  it('registration fields: one header over the switches, rows with no switch labels', async () => {
    await mount('#/admin/acceso', OWNER)
    const [head, ...rows] = document.querySelectorAll('.access-fields > .access-row')
    expect([...head.querySelectorAll('.access-col')].map(c => c.textContent)).toEqual(['Pedir', 'Obligatorio'])
    expect(rows.map(r => r.textContent)).toEqual(['Nombre y apellido', 'DNI', 'Celular', 'Mail'])
    for (const r of rows) expect(r.querySelectorAll('[role="switch"][aria-label]')).toHaveLength(2)
  })

  it('turning "Pedir" off sends required: false too', async () => {
    await mount('#/admin/acceso', OWNER)
    await clickSwitch('Pedir Mail')
    const put = apiMock.mock.calls.find(([u, o]) => u === '/api/admin/members/settings' && o?.method === 'PUT')
    expect(JSON.parse(put[1].body)).toEqual({ fields: { email: { enabled: false, required: false } } })
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

  it('billing off: no Cuotas tab and /admin/cuotas lands on Resumen without loading Cuotas', async () => {
    billingOn = false
    await mount('#/admin/cuotas', ADMIN)
    expect(window.location.hash).toBe('#/admin/resumen')
    expect(tabs().some(x => x.startsWith('Cuotas'))).toBe(false)
    expect(called('/api/admin/billing')).toBe(false)
    expect(called('/api/admin/billing/plans')).toBe(false)
  })

  it('turning billing off asks first, then hides Cuotas', async () => {
    await mount('#/admin/acceso', OWNER)
    await clickSwitch('Habilitar el módulo de cuotas')
    expect(sheetText()).toContain('No se borra ningún dato')
    expect(sheetText()).toContain('recordatorio manual')
    expect(called('/api/owner/billing/enabled')).toBe(false)
    await clickButton(document.querySelector('#modal-root'), 'Desactivar')
    expect(called('/api/owner/billing/enabled')).toBe(true)
    expect(tabs().some(x => x.startsWith('Cuotas'))).toBe(false)
  })

  it('turning billing on shows the enable-preview in the confirmation', async () => {
    billingOn = false
    await mount('#/admin/acceso', OWNER)
    await clickSwitch('Habilitar el módulo de cuotas')
    expect(called('/api/owner/billing/enable-preview')).toBe(true)
    expect(sheetText()).toContain('Al activar, 2 socios quedan bloqueados y 1 vencido.')
    await clickButton(document.querySelector('#modal-root'), 'Activar')
    expect(billingOn).toBe(true)
    expect(tabs()).toContain('Cuotas')
  })

  it('Resumen counts app users only', async () => {
    await mount('#/admin/resumen', ADMIN)
    const values = [...document.querySelectorAll('.tiles .tile .v')].map(el => el.textContent)
    expect(values[0]).toBe('1')          // ana; the ficha (hasApp: false) is left out
    expect(values[3]).toBe('0')          // the ficha is disabled, but not counted either
  })

  it('the app tab bar is marked on /admin/* only', async () => {
    await mount('#/admin/resumen', ADMIN)
    expect(document.querySelector('#tabbar').className).toBe('admin')
    await go('#/home')
    expect(document.querySelector('#tabbar').className).toBe('')
  })
})

// happy-dom has no layout: every tab is 100px wide and the strip shows 300px, so centering
// tab i means scrollLeft = i * 100 - 100.
describe('admin tabs on a phone: the active one is centered', () => {
  let scrolls
  const stubs = {
    offsetLeft() { return [...this.parentElement.children].indexOf(this) * 100 },
    offsetWidth() { return 100 },
  }
  const findDescriptor = name => {
    for (let p = HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) {
      const d = Object.getOwnPropertyDescriptor(p, name)
      if (d) return d
    }
  }
  const saved = {}
  beforeEach(() => {
    scrolls = []
    for (const name of ['offsetLeft', 'offsetWidth', 'clientWidth']) {
      saved[name] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)
      const real = findDescriptor(name)
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get() {
          if (name === 'clientWidth' && this.classList.contains('admin-nav')) return 300
          if (name !== 'clientWidth' && this.parentElement?.classList.contains('admin-nav')) return stubs[name].call(this)
          return real ? real.get.call(this) : 0
        }
      })
    }
    saved.scrollTo = HTMLElement.prototype.scrollTo
    HTMLElement.prototype.scrollTo = function (opts) { if (this.classList.contains('admin-nav')) scrolls.push(opts) }
  })
  afterEach(() => {
    for (const name of ['offsetLeft', 'offsetWidth', 'clientWidth']) {
      if (saved[name]) Object.defineProperty(HTMLElement.prototype, name, saved[name])
      else delete HTMLElement.prototype[name]
    }
    HTMLElement.prototype.scrollTo = saved.scrollTo
  })

  it('a direct link to the last tab jumps to it, later taps glide', async () => {
    await mount('#/admin/logs', OWNER)        // Logs is tab 10 (the owner also sees Clases, Roles, Personalización and Ingreso Físico)
    expect(scrolls[0]).toEqual({ left: 900, behavior: 'auto' })
    expect(scrolls.every(s => s.behavior === 'auto')).toBe(true)
    await go('#/admin/resumen')
    expect(scrolls.at(-1)).toEqual({ left: 0, behavior: 'smooth' })   // clamped at the start
    await go('#/admin/acceso')                // tab 6
    expect(scrolls.at(-1)).toEqual({ left: 500, behavior: 'smooth' })
  })

  it('does nothing with the desktop side menu', async () => {
    desktop = true
    await mount('#/admin/logs', OWNER)
    await go('#/admin/resumen')
    expect(scrolls).toEqual([])
  })
})

describe('Usuarios: tabla en escritorio', () => {
  const PEOPLE = [
    { id: 'o', name: 'dueña', fullName: 'Olga Dueña', owner: true, admin: true, hasApp: true, lastSeen: '2026-09-20', billing: { status: 'sin_plan' } },
    { id: 'j', name: 'Juani', fullName: 'Juan Fernández', hasApp: true, lastSeen: '2026-09-23', billing: { status: 'vencido' } },
    { id: 'b', name: 'beto', fullName: null, hasApp: false, lastSeen: null, billing: { status: 'al_dia' } },
    { id: 'z', name: 'zoe', fullName: 'Zoe Z', hasApp: true, lastSeen: '2026-09-24', billing: { status: 'bloqueado' } },
  ]
  const withPeople = async fn => {
    const real = apiMock.getMockImplementation()
    apiMock.mockImplementation((url, opts) => url === '/api/admin/users'
      ? Promise.resolve({ users: PEOPLE.map(p => ({ workouts: 0, lastSync: null, ...p })), invite_only: false, audit_enabled: true, billing_enabled: billingOn, checkin_enabled: false })
      : real(url, opts))
    try { await fn() } finally { apiMock.mockImplementation(real) }
  }
  const rowNames = () => [...document.querySelectorAll('.utable .urow.item .uname')].map(el => el.textContent)
  const head = label => [...document.querySelectorAll('.uhead')].find(b => b.textContent === label)

  it('columnas Nombre / Cuota / Último ingreso; nombre [usuario]; dueño y admin junto al nombre', async () => {
    desktop = true
    await withPeople(async () => {
      await mount('#/admin/usuarios', OWNER)
      expect([...document.querySelectorAll('.uhead')].map(b => b.textContent)).toEqual(['Nombre', 'Cuota', 'Último ingreso'])
      expect(rowNames()).toEqual(['beto', 'Juan Fernández', 'Olga Dueña', 'Zoe Z'])           // por nombre
      const juan = [...document.querySelectorAll('.utable .urow.item')].find(r => r.textContent.includes('Juan Fernández'))
      expect(juan.querySelector('.unick').textContent).toBe(' [Juani]')
      expect(juan.textContent).toContain('Vencido')
      const olga = [...document.querySelectorAll('.utable .urow.item')].find(r => r.textContent.includes('Olga'))
      expect(olga.querySelector('.role-badge.owner').textContent).toBe('Dueño')
      expect(olga.textContent).not.toContain('Sin plan')                                      // al staff no se le muestra cuota
      // Ordenar por cuota: lo urgente primero; y por último ingreso, lo más reciente primero.
      await act(async () => { head('Cuota').click() }); await flush()
      expect(rowNames()).toEqual(['Zoe Z', 'Juan Fernández', 'beto', 'Olga Dueña'])
      await act(async () => { head('Último ingreso').click() }); await flush()
      expect(rowNames()).toEqual(['Zoe Z', 'Juan Fernández', 'Olga Dueña', 'beto'])
      // Buscar también por nombre y apellido.
      await act(async () => {
        const input = document.querySelector('input[aria-label="Buscar por nombre o DNI"]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'fernández')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }); await flush()
      expect(rowNames()).toEqual(['Juan Fernández'])
    })
  })

  it('con cuotas apagado no hay columna Cuota', async () => {
    desktop = true
    billingOn = false
    await withPeople(async () => {
      await mount('#/admin/usuarios', OWNER)
      expect([...document.querySelectorAll('.uhead')].map(b => b.textContent)).toEqual(['Nombre', 'Último ingreso'])
    })
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

  it('historial del socio: cumplimiento de la semana y tocar un entreno lo abre como panel, en solo lectura', async () => {
    desktop = true
    const real = apiMock.getMockImplementation()
    const w = (id, d, extra = {}) => ({ id, d, start: Date.parse(d + 'T18:00:00Z'), end: Date.parse(d + 'T19:00:00Z'), name: 'Push', routineId: 'r1', vol: 900,
      entries: [{ id: 'cx-remo', sets: [{ w: 40, r: 10, done: true }] }], ...extra })
    apiMock.mockImplementation((url, opts) => url.startsWith('/api/admin/user?id=')
      ? Promise.resolve({ user: { id: 'a', name: 'ana', created: '2026-01-01', hasApp: true }, bodyweight: [], routines: [{ id: 'r1', name: 'Push', emoji: 'dumbbell', count: 1 }], lastSync: Date.now(), unit: 'kg',
        healthConsent: 'granted', today: '2026-09-24', week: { 1: 'r1', 3: 'r1', 5: 'r1' }, dayPlan: {}, names: { 'cx-remo': 'Remo en máquina' },
        workouts: [w('w2', '2026-09-22', { note: 'Buen día', bw: 70 }), w('w1', '2026-09-15')] })
      : real(url, opts))
    try {
      await mount('#/admin/usuarios', ADMIN)
      await clickAna()
      const panel = document.querySelector('.admin-user-panel')
      // Semana del 21 al 27/09, hoy jueves 24: lunes planeado sin entrenar, martes extra, miércoles planeado sin entrenar, viernes pendiente.
      expect(panel.querySelector('.adh-t').textContent).toBe('Esta semana: 0 de 3 días planeados · 1 pendiente · +1 día extra')
      expect([...panel.querySelectorAll('.adh-d')].map(d => d.className.replace('adh-d ', ''))).toEqual(['missed', 'done extra', 'missed', 'rest today', 'pending', 'rest', 'rest'])
      expect(panel.querySelectorAll('.adh-i svg').length).toBe(7)          // ícono en cada día, no solo color
      expect(panel.querySelector('.wh-month-h').textContent).toContain('2 entrenos')
      await act(async () => { panel.querySelector('.wh-row').click() }); await flush()
      const sheet = document.querySelector('#modal-root .sheet.panel')
      expect(sheet).toBeTruthy()
      expect(sheet.textContent).toContain('Remo en máquina')                // ejercicio propio del socio, por su nombre
      expect(sheet.textContent).toContain('Igual vs. 15 sept')               // misma serie que la vez anterior
      expect(sheet.textContent).toContain('Buen día')
      expect(sheet.textContent).toContain('Peso corporal')
      expect(sheet.querySelector('textarea')).toBeNull()
      expect(sheet.textContent).not.toContain('Repetir este entreno')
      expect(sheet.textContent).not.toContain('Delete workout')
    } finally { apiMock.mockImplementation(real) }
  })

  it('on a phone, selecting a member opens UserDetail in a sheet', async () => {
    await mount('#/admin/usuarios', ADMIN)
    expect(document.querySelector('.admin-user-panel')).toBeNull()
    await clickAna()
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(document.querySelector('#modal-root h3').textContent).toBe('ana')
    expect(document.querySelector('.admin-users .item.on')).toBeNull()
  })

  it('billing off hides the membership card in the member detail', async () => {
    desktop = true
    await mount('#/admin/usuarios', ADMIN)
    await clickAna()
    expect(document.querySelector('.admin-user-panel .billing-summary')).toBeTruthy()
    await act(async () => { root.unmount() })
    container.remove()
    billingOn = false
    await mount('#/admin/usuarios', ADMIN)
    await clickAna()
    expect(document.querySelector('.admin-user-panel h3').textContent).toBe('ana')
    expect(document.querySelector('.admin-user-panel .billing-summary')).toBeNull()
  })

  it('does not crash when created is missing or not a string', async () => {
    desktop = true
    for (const created of [1700000000000, undefined, null]) {
      anaCreated = created
      await mount('#/admin/usuarios', ADMIN)
      await clickAna()
      const panel = document.querySelector('.admin-user-panel')
      expect(panel.querySelector('h3').textContent).toBe('ana')
      expect(panel.textContent).toContain('—')
      await act(async () => { root.unmount() })
      container.remove()
    }
    await mount('#/admin/usuarios', ADMIN)   // afterEach desmonta este
  })

  describe('Ingreso Físico', () => {
    const ingresoTab = () => tabs().find(x => x.startsWith('Ingreso Físico'))
    it('apagado: un admin no owner no ve la sección y el link directo va a Resumen', async () => {
      await mount('#/admin/ingreso-fisico', ADMIN)
      expect(ingresoTab()).toBeUndefined()
      expect(window.location.hash).toBe('#/admin/resumen')
    })

    it('apagado: el owner ve la sección solo con el interruptor y la explicación; al encenderlo aparece todo', async () => {
      await mount('#/admin/ingreso-fisico', OWNER)
      expect(ingresoTab()).toBe('Ingreso Físico*')
      expect(text()).toContain('tipea su DNI en un teclado numérico')
      expect(text()).not.toContain('Dispositivos')
      expect(text()).not.toContain('kiosco')
      await clickSwitch('Ingreso Físico')
      expect(checkin.enabled).toBe(true)
      expect(text()).toContain('Identificación')
      expect(text()).toContain('Dispositivos')
      expect(text()).toContain('Abrir Ingreso Físico en este dispositivo')
      expect(text()).toContain('Registro de ingresos')
      expect(text()).toContain('Ana Pérez [anita]')
      expect(text()).toContain('2 ingresos')
      // Cuota de hoy junto al nombre, con el color del estado; sin datos de cuota, nada.
      expect([...document.querySelectorAll('.checkin-log-fee')].map(el => [el.textContent, el.className])).toEqual([['Vence en 3 días', 'checkin-log-fee st-por_vencer']])
      expect(document.querySelector('.checkin-log .tag')).toBeNull()   // sin la etiqueta de origen en cada fila
      expect([...document.querySelectorAll('.checkin-log-row')].map(r => r.getAttribute('title'))).toEqual(['Ana Pérez [anita]', 'beto'])
      // Días anteriores: se consultan con ?date= y se vuelve a hoy.
      const prev = document.querySelector('[aria-label="Día anterior"]')
      await act(async () => { prev.click() }); await flush()
      expect(apiMock.mock.calls.some(([u]) => u === '/api/admin/checkin?date=2026-09-23')).toBe(true)
      expect(text()).toContain('Ayer')
      expect(text()).toContain('No hubo ingresos este día.')
      await clickButton(document, 'Volver a hoy')
      expect(text()).toContain('Ana Pérez [anita]')
      // Tocar un ingreso abre el detalle del socio (el de Usuarios) como panel.
      await act(async () => { document.querySelector('.checkin-log-row[title="Ana Pérez [anita]"]').click() }); await flush()
      const panel = document.querySelector('#modal-root .sheet.panel')
      expect(panel).toBeTruthy()
      expect(panel.getAttribute('role')).toBe('dialog')
      expect(apiMock.mock.calls.some(([u]) => u === '/api/admin/user?id=a')).toBe(true)
      expect(panel.textContent).toContain('ana')
      await act(async () => { panel.querySelector('.panel-close').click() }); await flush()
      expect(document.querySelector('#modal-root .sheet.panel')).toBeNull()
    })

    it('encendido: un admin no owner ve dispositivos e ingresos, sin cambiar la configuración, y puede revocar', async () => {
      checkin = { ...checkin, enabled: true }
      devices = [{ id: 7, name: 'Tablet recepción', createdAt: Date.UTC(2026, 8, 1), lastUsedAt: null }]
      await mount('#/admin/ingreso-fisico', ADMIN)
      expect(ingresoTab()).toBe('Ingreso Físico*')
      expect(document.querySelector('[role="switch"][aria-label="Ingreso Físico"]')).toBeNull()
      expect(document.querySelector('[role="switch"][aria-label="Mostrar el estado de la cuota"]')).toBeNull()
      expect(text()).toContain('Solo el dueño cambia esta configuración.')
      expect(text()).toContain('Tablet recepción')
      await clickButton(document, 'Revocar')
      await clickButton(document.querySelector('#modal-root'), 'Revocar')
      expect(apiMock.mock.calls.some(([u, o]) => u === '/api/admin/checkin/devices/7' && o?.method === 'DELETE')).toBe(true)
      expect(text()).toContain('Ningún dispositivo activado.')
    })

    it('apagarlo pide confirmar y avisa que los dispositivos quedan desactivados', async () => {
      checkin = { ...checkin, enabled: true }
      await mount('#/admin/ingreso-fisico', OWNER)
      await clickSwitch('Ingreso Físico')
      expect(sheetText()).toContain('un admin tiene que activarlos de nuevo')
      expect(checkin.enabled).toBe(true)
      await clickButton(document.querySelector('#modal-root'), 'Desactivar')
      expect(checkin.enabled).toBe(false)
    })
  })
})
