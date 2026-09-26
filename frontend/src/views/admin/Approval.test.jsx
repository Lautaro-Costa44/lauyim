// @vitest-environment happy-dom
// Aprobación de cuentas en el admin (spec 12.3), con la App real: contador en Resumen, filtro
// "Pendientes" en Usuarios, habilitar según el modo (con el DNI de una ficha → Vincular) y rechazar.
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
window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {} })
window.HTMLCanvasElement.prototype.toDataURL = () => ''
window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })

const fail = (status, data) => Promise.reject(Object.assign(new Error(data.message || data.error), { status, data }))
const ANA = { id: 'a', name: 'ana', hasApp: true, workouts: 3, lastSync: Date.now() }
const PEPE = { id: 'p', name: 'pepe', hasApp: true, pending: true, workouts: 0, lastSync: null }
const FIELDS = { full_name: { enabled: true, required: true }, dni: { enabled: true, required: true }, phone: { enabled: false, required: false }, email: { enabled: false, required: false } }
const PLANS = [{ id: 1, name: 'Mensual', price: 20000, durationDays: 30, active: true }]
let mode, users

apiMock.mockImplementation((url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {}
  if (url === '/api/admin/users') return Promise.resolve({ users, invite_only: false, audit_enabled: true, billing_enabled: true })
  if (url === '/api/admin/members/settings') return Promise.resolve({ fields: FIELDS })
  if (url === '/api/admin/billing/plans') return Promise.resolve({ plans: PLANS })
  if (url === '/api/admin/billing/settings') return Promise.resolve({ settings: { payment_methods: ['efectivo', 'transferencia'], trial_days: 1, gym_tz: 'America/Argentina/Buenos_Aires' } })
  if (url.startsWith('/api/admin/members/lookup')) {
    return url.endsWith('dni=30111222') ? Promise.resolve({ userId: 'f', name: 'Ana Ficha', hasApp: false }) : fail(404, { error: 'No hay' })
  }
  if (url.startsWith('/api/admin/user?id=')) {
    const u = users.find(x => x.id === decodeURIComponent(url.split('=')[1]))
    return Promise.resolve({ user: { ...u, created: '2026-01-01' }, workouts: [], bodyweight: [], routines: [], lastSync: null, unit: 'kg' })
  }
  if (url.endsWith('/profile')) return Promise.resolve({ profile: {}, fields: FIELDS })
  if (url.endsWith('/approve')) {
    const allowed = mode === 'approve' ? ['none', 'payment', 'trial'] : [mode]
    if (body.dry_run) return Promise.resolve({ dry_run: true, mode, allowed, covered: false, dueDate: body.start?.type === 'payment' ? '2026-10-26' : null, trialUntil: null, trialDays: 1 })
    users = users.map(u => u.id === 'p' ? { ...u, pending: false } : u)
    return Promise.resolve({ ok: true })
  }
  if (url.endsWith('/reject')) { users = users.map(u => u.id === 'p' ? { ...u, disabled: true } : u); return Promise.resolve({ ok: true }) }
  if (url.startsWith('/api/admin/users/') && url.endsWith('/billing')) return Promise.resolve({ billing: { planId: null, status: 'sin_plan', debt: 0 }, payments: [] })
  if (url === '/api/admin/invites') return Promise.resolve({ invites: [] })
  if (url === '/api/admin/presets') return Promise.resolve({ presets: [] })
  if (url === '/api/admin/attendance-heatmap') return Promise.resolve({ start: 'monday', totalUsers: 1, days: {} })
  return Promise.resolve({})
})

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { default: App } = await import('../../App.jsx')
const { setLang } = await import('../../lib/i18n.js')
const { flush, preloadAdminChunks } = await import('./test-utils.js')
await preloadAdminChunks()
await import('./Resumen.jsx')

const text = () => document.body.textContent
const button = label => [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === label).at(-1)
const click = async el => { expect(el).toBeTruthy(); await act(async () => { el.click() }); await flush() }
const fieldInput = label => [...document.querySelectorAll('.member-field')]
  .filter(f => f.querySelector('.member-field-l').textContent.replace(/ \*$/, '') === label).at(-1)?.querySelector('input')
const type = async (el, value) => {
  expect(el).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const blur = async el => { await act(async () => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) }); await flush() }
const sheet = () => [...document.querySelectorAll('#modal-root .compound-builder')].at(-1)
const posts = suffix => apiMock.mock.calls.filter(([u, o]) => u.endsWith(suffix) && o?.method === 'POST').map(([, o]) => JSON.parse(o.body))

let root, container
async function mount(hash) {
  window.location.hash = hash
  useStore.setState({ boot: () => {}, ready: true, user: { id: 'o', name: 'o', admin: true, owner: true }, licenseExpired: false })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<App />) })
  await flush()
}
const openPepe = async () => {
  await mount('#/admin/usuarios')
  await click([...document.querySelectorAll('.admin-users .item')].find(el => el.textContent.includes('pepe')))
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mode = 'payment'
  users = [ANA, PEPE]
  apiMock.mockClear()
  useUI.setState({ sheets: [] })
})
afterEach(async () => {
  if (!root) return
  await act(async () => { root.unmount() })
  container.remove()
  root = null
})

describe('pendientes', () => {
  it('Resumen muestra el contador y lleva a Usuarios filtrado', async () => {
    await mount('#/admin/resumen')
    const banner = document.querySelector('.admin-pending-banner')
    expect(banner.textContent).toContain('1cuenta pendiente de aprobación')
    await click(banner)
    expect(window.location.hash).toBe('#/admin/usuarios?filtro=pendientes')
    const chip = [...document.querySelectorAll('.member-filter .chip')].find(c => c.textContent.startsWith('Pendientes'))
    expect(chip.textContent).toBe('Pendientes (1)')
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    const items = [...document.querySelectorAll('.admin-users .item')]
    expect(items).toHaveLength(1)
    expect(items[0].textContent).toContain('Pendiente')
  })

  it('sin pendientes no hay contador ni chip', async () => {
    users = [ANA]
    await mount('#/admin/resumen')
    expect(document.querySelector('.admin-pending-banner')).toBeNull()
    await mount('#/admin/usuarios')
    expect(text()).not.toContain('Pendientes')
  })

  it('habilitar en modo primer pago: DNI de una ficha ofrece vincular; después, solo "Registrar pago"', async () => {
    await openPepe()
    expect(text()).toContain('Cuenta pendiente')
    await click(button('Revisar y habilitar'))
    expect(sheet().textContent).toContain('Paso 1 de 2 · Datos de pepe')
    await type(fieldInput('Nombre y apellido'), 'Pepe Pérez')
    const dni = fieldInput('DNI')
    await type(dni, '30111222')
    await blur(dni)
    expect(sheet().textContent).toContain('Ya existe Ana Ficha (sin app)')
    expect(button('Vincular')).toBeTruthy()
    expect(button('Siguiente').disabled).toBe(true)
    await type(fieldInput('DNI'), '41000111')
    await flush()
    await click(button('Siguiente'))
    const options = [...sheet().querySelectorAll('.start-opt')].map(r => r.querySelector('.lrow-t').textContent)
    expect(options).toEqual(['Registrar pago'])
    expect(sheet().textContent).toContain('Vence el')
    await click(button('Habilitar cuenta'))
    const sent = posts('/approve').filter(b => !b.dry_run)
    expect(sent).toHaveLength(1)
    expect(sent[0].profile).toEqual({ fullName: 'Pepe Pérez', dni: '41000111' })
    expect(sent[0].start).toMatchObject({ type: 'payment', planId: 1, method: 'efectivo', amount: 20000 })
    expect(useUI.getState().toastMsg).toBe('Cuenta habilitada')
  })

  it('modo aprobar: "Solo habilitar" y las opciones de cuota como opcionales', async () => {
    mode = 'approve'
    await openPepe()
    await click(button('Revisar y habilitar'))
    await type(fieldInput('Nombre y apellido'), 'Pepe Pérez')
    await type(fieldInput('DNI'), '41000111')
    await click(button('Siguiente'))
    const options = [...sheet().querySelectorAll('.start-opt')].map(r => r.querySelector('.lrow-t').textContent)
    expect(options).toEqual(['Registrar pago', 'Iniciar prueba', 'Solo habilitar'])
    await click([...sheet().querySelectorAll('.start-opt')].find(r => r.textContent.includes('Solo habilitar')))
    await click(button('Habilitar cuenta'))
    expect(posts('/approve').filter(b => !b.dry_run)[0].start).toEqual({ type: 'none' })
  })

  it('rechazar pide el motivo', async () => {
    await openPepe()
    await click(button('Rechazar'))
    expect(button('Rechazar').disabled).toBe(true)
    await type(fieldInput('Motivo'), 'No es socio')
    await click(button('Rechazar'))
    expect(posts('/reject')).toEqual([{ reason: 'No es socio' }])
    expect(useUI.getState().toastMsg).toBe('Cuenta rechazada')
  })
})
