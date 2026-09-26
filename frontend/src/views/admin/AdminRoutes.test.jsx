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
const ANA = { id: 'a', name: 'ana', lastSync: Date.now(), workouts: 1, hasApp: true }
// A member record without a passkey: listed in Usuarios, never counted in Resumen.
const FICHA = { id: 'f', name: 'ficha', lastSync: null, workouts: 0, hasApp: false, disabled: true }
const FIELDS = () => ({ full_name: { enabled: true, required: true }, dni: { enabled: dniEnabled, required: dniEnabled }, phone: { enabled: true, required: true }, email: { enabled: true, required: false } })
apiMock.mockImplementation((url, opts) => {
  if (url === '/api/admin/users') return Promise.resolve({ users: [ANA, FICHA], invite_only: false, audit_enabled: auditOn, billing_enabled: billingOn })
  if (url === '/api/admin/members/settings') return Promise.resolve({ fields: FIELDS() })
  if (url === '/api/owner/billing/enable-preview') return Promise.resolve({ today: '2026-09-24', bloqueado: 2, vencido: 1, por_vencer: 3 })
  if (url === '/api/owner/billing/enabled') { billingOn = JSON.parse(opts.body).enabled; return Promise.resolve({ enabled: billingOn }) }
  if (url.startsWith('/api/admin/users/') && url.endsWith('/billing')) return Promise.resolve({ billing: { planId: null, status: 'sin_plan', debt: 0 }, payments: [] })
  if (url === '/api/admin/invites') return Promise.resolve({ invites: [] })
  if (url === '/api/admin/presets') return Promise.resolve({ presets: [] })
  if (url === '/api/admin/attendance-heatmap') return Promise.resolve({ start: 'monday', totalUsers: 1, days: {} })
  if (url === '/api/owner/qr') return Promise.resolve({ token: 'qr-token' })
  if (url === '/api/admin/approval' || url === '/api/owner/approval') {
    if (opts?.method === 'PUT') approval = { ...approval, ...JSON.parse(opts.body) }
    return Promise.resolve({ ...approval, effectiveMode: billingOn ? approval.mode : 'approve', billingEnabled: billingOn, dniEnabled })
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
    expect(text()).toContain('Deuda total')
  })

  it('tab order: Resumen, Usuarios, Cuotas, Rutinas, Notificaciones, Acceso, Logs', async () => {
    await mount('#/admin/resumen', OWNER)
    expect(tabs()).toEqual(['Resumen*', 'Usuarios', 'Cuotas', 'Rutinas', 'Notificaciones', 'Acceso', 'Logs', 'Volver a la app'])
  })

  it('/admin/qr redirects to Acceso', async () => {
    await mount('#/admin/qr', ADMIN)
    expect(window.location.hash).toBe('#/admin/acceso')
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

  it('the owner gets the six Acceso cards, in order', async () => {
    await mount('#/admin/acceso', OWNER)
    const titles = [...document.querySelectorAll('.admin-cards > .card h2')].map(h => h.textContent)
    expect(titles).toEqual(['Códigos de invitación', 'Acceso por QR', 'Datos del registro', 'Aprobación de cuentas', 'Aviso de privacidad', 'Cobro de cuotas'])
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
    await clickSwitch('Bloquear el acceso por cuota vencida')
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
    await clickSwitch('Bloquear el acceso por cuota vencida')
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
    await mount('#/admin/logs', OWNER)        // Logs is tab 6
    expect(scrolls[0]).toEqual({ left: 500, behavior: 'auto' })
    expect(scrolls.every(s => s.behavior === 'auto')).toBe(true)
    await go('#/admin/resumen')
    expect(scrolls.at(-1)).toEqual({ left: 0, behavior: 'smooth' })   // clamped at the start
    await go('#/admin/acceso')                // tab 5
    expect(scrolls.at(-1)).toEqual({ left: 400, behavior: 'smooth' })
  })

  it('does nothing with the desktop side menu', async () => {
    desktop = true
    await mount('#/admin/logs', OWNER)
    await go('#/admin/resumen')
    expect(scrolls).toEqual([])
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
})
