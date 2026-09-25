// @vitest-environment happy-dom
// Fichas de socio en el admin, con la App real (como AdminRoutes.test.jsx): alta, lista,
// detalle de una ficha sin app, código de vinculación y unir una ficha con una cuenta.
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
const FICHA = { id: 'f', name: 'Juan Ficha', hasApp: false, workouts: 0, lastSync: null }
const STAFF = { id: 's', name: 'staff', hasApp: true, admin: true, workouts: 0, lastSync: null }
const NEW = { id: 'new', name: 'Nuevo Socio', hasApp: false, workouts: 0, lastSync: null }
const PLANS = [{ id: 1, name: 'Mensual', price: 20000, durationDays: 30, active: true }, { id: 2, name: 'Viejo', price: 1, durationDays: 7, active: false }]
const EXPIRES = '2026-09-26T21:30:00.000Z'

let billingOn, fields, users, mergePlan
const basePlan = () => ({
  ficha: { id: 'f', name: 'Juan Ficha' }, target: { id: 'a', name: 'ana' }, payments: 2,
  billing: { ficha: { planId: 1, planName: 'Mensual', dueDate: '2026-10-10' }, cuenta: { planId: 1, planName: 'Mensual', dueDate: '2026-11-01' }, conflict: true, keep: null },
  profile: { ficha: true, cuenta: false, conflict: false, action: 'move' },
  lost: { routines: 2 }
})

apiMock.mockImplementation((url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {}
  if (url === '/api/admin/users') return Promise.resolve({ users, invite_only: false, audit_enabled: true, billing_enabled: billingOn })
  if (url === '/api/admin/members/settings') return Promise.resolve({ fields })
  if (url === '/api/admin/billing/plans') return Promise.resolve({ plans: PLANS })
  if (url.startsWith('/api/admin/members/lookup')) {
    return url.endsWith('dni=30111222') ? Promise.resolve({ userId: 'a', name: 'ana', hasApp: true }) : fail(404, { error: 'No hay ningún socio con ese DNI' })
  }
  if (url === '/api/admin/members') {
    if (body.dni === '30999888') return fail(409, { error: 'dni_duplicado', userId: 'f', name: 'Juan Ficha', hasApp: false })
    users = [...users, NEW]
    return Promise.resolve({ member: { userId: 'new', name: 'Nuevo Socio', hasApp: false } })
  }
  if (url.startsWith('/api/admin/user?id=')) {
    const u = [...users, NEW].find(x => x.id === decodeURIComponent(url.split('=')[1]))
    return Promise.resolve({ user: { ...u, created: '2026-01-01' }, workouts: [], bodyweight: [], routines: [], lastSync: null, unit: 'kg' })
  }
  if (url.endsWith('/profile') && opts.method === 'PUT') {
    return body.dni === '30111222' ? fail(409, { error: 'dni_duplicado', userId: 'a', name: 'ana', hasApp: true }) : Promise.resolve({ profile: {} })
  }
  if (url.endsWith('/profile')) return Promise.resolve({ profile: { fullName: 'Juan Pérez', dni: '30.999.888', phone: null, email: null, hasApp: false }, fields })
  if (url.endsWith('/link-code')) return Promise.resolve(opts.method === 'DELETE' ? { ok: true, revoked: 1 } : { code: 'ABCD-EFGH', link: 'https://gym.test/?link=ABCD-EFGH', expiresAt: EXPIRES })
  if (url.endsWith('/merge')) return body.dry_run ? Promise.resolve({ dry_run: true, ...mergePlan }) : Promise.resolve({ ok: true, ...mergePlan })
  if (url.startsWith('/api/admin/users/') && url.endsWith('/billing')) return Promise.resolve({ billing: { planId: null, status: 'sin_plan', debt: 0 }, payments: [] })
  if (url === '/api/admin/billing') return Promise.resolve({ today: '2026-09-24', settings: {}, summary: { al_dia: 0, por_vencer: 0, vencido: 0, bloqueado: 0, sin_plan: 2, deuda_total: 0 }, members: [
    { id: 'a', name: 'ana', disabled: false, admin: false, hasApp: true, planId: null, status: 'sin_plan', debt: 0 },
    { id: 'f', name: 'Juan Ficha', disabled: false, admin: false, hasApp: false, planId: null, status: 'sin_plan', debt: 0 }] })
  if (url === '/api/admin/invites') return Promise.resolve({ invites: [] })
  if (url === '/api/presets') return Promise.resolve({ presets: [] })
  if (url === '/api/admin/attendance-heatmap') return Promise.resolve({ start: 'monday', totalUsers: 1, days: {} })
  return Promise.resolve({})
})

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { default: App } = await import('../../App.jsx')
const { setLang } = await import('../../lib/i18n.js')

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const flush = async () => {
  for (let i = 0; i < 5; i++) await tick()
  for (let i = 0; i < 150 && document.querySelector('.page-loading'); i++) await tick()
  for (let i = 0; i < 5; i++) await tick()
}
const text = () => document.body.textContent
const calls = (pred) => apiMock.mock.calls.filter(([u, o]) => pred(u, o || {}))
// Topmost match: sheets stack in #modal-root after the page.
const button = label => [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === label).at(-1)
const click = async el => { expect(el).toBeTruthy(); await act(async () => { el.click() }); await flush() }
// input-safety renames every field in the DOM (anti-autofill): find inputs by their label.
const fieldInput = label => [...document.querySelectorAll('.member-field')]
  .filter(f => f.querySelector('.member-field-l').textContent.replace(/ \*$/, '') === label).at(-1)?.querySelector('input')
const searchInput = () => document.querySelector('input[aria-label="Buscar por nombre o DNI"]')
const topSheet = () => [...document.querySelectorAll('#modal-root .compound-builder')].at(-1)
const type = async (el, value) => {
  expect(el).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return el
}
const blur = async el => { await act(async () => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) }); await flush() }
const sheetTitle = () => [...document.querySelectorAll('#modal-root h3')].at(-1)?.textContent

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
const openFicha = async () => {
  await mount('#/admin/usuarios')
  await click([...document.querySelectorAll('.admin-users .item')].find(el => el.textContent.includes('Juan Ficha')))
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  billingOn = true
  fields = { full_name: { enabled: true, required: true }, dni: { enabled: true, required: true }, phone: { enabled: true, required: false }, email: { enabled: false, required: false } }
  users = [ANA, FICHA, STAFF]
  mergePlan = basePlan()
  apiMock.mockClear()
  useUI.setState({ sheets: [] })
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
})

describe('alta de ficha', () => {
  const openCreate = async () => {
    await mount('#/admin/usuarios')
    await click(button('Nuevo socio (sin app)'))
    expect(sheetTitle()).toBe('Nuevo socio')
  }

  it('muestra solo los campos que se piden y marca los obligatorios', async () => {
    await openCreate()
    const labels = [...document.querySelectorAll('.member-field-l')].map(l => l.textContent)
    expect(labels).toEqual(['Nombre y apellido *', 'DNI *', 'Celular'])
    expect(text()).toContain('Estos datos se usan solo para identificar al socio en el gimnasio y solo los ve el staff.')
    expect(text()).toContain('Cuota (opcional)')
  })

  it('con cuotas apagado no ofrece plan', async () => {
    billingOn = false
    await openCreate()
    expect(text()).not.toContain('Cuota (opcional)')
    expect(calls(u => u === '/api/admin/billing/plans')).toHaveLength(0)
  })

  it('al salir del DNI avisa del duplicado y "Abrir" abre a esa persona', async () => {
    await openCreate()
    await blur(await type(fieldInput('DNI'), '30111222'))
    expect(text()).toContain('Ya existe ana (con app)')
    expect(button('Crear socio').disabled).toBe(true)
    await click(button('Abrir'))
    expect(sheetTitle()).toBe('ana')
    expect(calls(u => u === '/api/admin/members')).toHaveLength(0)
  })

  it('un 409 dni_duplicado al guardar muestra quién es', async () => {
    await openCreate()
    await type(fieldInput('Nombre y apellido'), 'Pedro Gómez')
    await type(fieldInput('DNI'), '30999888')
    await click(button('Crear socio'))
    expect(text()).toContain('Ya existe Juan Ficha (sin app)')
    expect(button('Abrir')).toBeTruthy()
  })

  it('guarda con plan y vencimiento, refresca la lista y abre el detalle nuevo', async () => {
    await openCreate()
    await type(fieldInput('Nombre y apellido'), 'Nuevo Socio')
    await type(fieldInput('DNI'), '40111222')
    await click([...topSheet().querySelectorAll('.lrow')].find(r => r.textContent.startsWith('Plan')))
    await click([...document.querySelectorAll('#modal-root button, #modal-root .lrow')].filter(el => el.textContent.startsWith('Mensual')).at(-1))
    const before = calls(u => u === '/api/admin/users').length
    await click(button('Crear socio'))
    const [, opts] = calls(u => u === '/api/admin/members')[0]
    const sent = JSON.parse(opts.body)
    expect(sent).toMatchObject({ fullName: 'Nuevo Socio', dni: '40111222', planId: 1 })
    expect(sent.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(sent.phone).toBeUndefined()
    expect(calls(u => u === '/api/admin/users').length).toBeGreaterThan(before)
    expect(sheetTitle()).toBe('Nuevo Socio')
  })
})

describe('lista de usuarios', () => {
  const names = () => [...document.querySelectorAll('.admin-users .item .tt')].map(el => el.textContent)

  it('badge "Sin app" y chips de filtro', async () => {
    await mount('#/admin/usuarios')
    expect(names().find(n => n.includes('Juan Ficha'))).toContain('Sin app')
    expect(names().find(n => n.includes('ana'))).not.toContain('Sin app')
    await click(button('Sin app'))
    expect(names()).toHaveLength(1)
    expect(names()[0]).toContain('Juan Ficha')
    await click(button('Con app'))
    expect(names().some(n => n.includes('Juan Ficha'))).toBe(false)
    await click(button('Todos'))
    expect(names()).toHaveLength(3)
  })

  it('una búsqueda de 6-9 dígitos consulta el DNI y muestra la coincidencia arriba', async () => {
    await mount('#/admin/usuarios')
    await type(searchInput(), '30111222')
    await act(async () => { await new Promise(r => setTimeout(r, 350)) })
    await flush()
    expect(calls(u => u === '/api/admin/members/lookup?dni=30111222')).toHaveLength(1)
    const match = document.querySelector('.member-dni-match')
    expect(match.textContent).toContain('ana')
    expect(match.textContent).toContain('Coincide DNI')
    await type(searchInput(), 'ana')
    await act(async () => { await new Promise(r => setTimeout(r, 350)) })
    expect(calls(u => u.startsWith('/api/admin/members/lookup'))).toHaveLength(1)
  })

  it('Cuotas marca las fichas con "Sin app"', async () => {
    await mount('#/admin/cuotas')
    const rows = [...document.querySelectorAll('.tt, td')].map(r => r.textContent)
    expect(rows.find(r => r.includes('Juan Ficha'))).toContain('Sin app')
    expect(rows.find(r => r.includes('ana'))).not.toContain('Sin app')
  })
})

describe('detalle de una ficha sin app', () => {
  it('oculta lo de entrenamiento y ofrece código y vincular', async () => {
    await openFicha()
    const sheet = document.querySelector('#modal-root')
    expect(sheet.querySelector('.tiles')).toBeNull()
    expect(sheet.textContent).not.toContain('Administrar Nutrición/Rutina')
    expect(sheet.textContent).toContain('Generar código de vinculación')
    expect(sheet.textContent).toContain('Vincular con cuenta existente')
    expect(sheet.querySelector('.member-ficha').textContent).toContain('30.999.888')
  })

  it('una cuenta con app sigue mostrando sus tiles y no los botones de ficha', async () => {
    await mount('#/admin/usuarios')
    await click([...document.querySelectorAll('.admin-users .item')].find(el => el.textContent.includes('ana')))
    const sheet = document.querySelector('#modal-root')
    expect(sheet.querySelector('.tiles')).toBeTruthy()
    expect(sheet.textContent).not.toContain('Generar código de vinculación')
  })
})

describe('código de vinculación', () => {
  it('muestra QR, código y vencimiento; revocar pide confirmación', async () => {
    await openFicha()
    await click(button('Generar código de vinculación'))
    expect(calls((u, o) => u === '/api/admin/users/f/link-code' && o.method === 'POST')).toHaveLength(1)
    expect(document.querySelector('.link-code-v').textContent).toBe('ABCD-EFGH')
    expect(document.querySelector('.link-code canvas')).toBeTruthy()
    const d = new Date(EXPIRES), p = n => String(n).padStart(2, '0')
    expect(text()).toContain(`Vence el ${p(d.getDate())}/${p(d.getMonth() + 1)} a las ${p(d.getHours())}:${p(d.getMinutes())}`)
    expect(text()).toContain('El código se muestra una sola vez. Si cerrás, generá uno nuevo.')

    await click(button('Revocar'))
    expect(text()).toContain('¿Revocar el código?')
    expect(calls((u, o) => u.endsWith('/link-code') && o.method === 'DELETE')).toHaveLength(0)
    await click(button('Revocar'))       // el del confirm, arriba de todo
    expect(calls((u, o) => u === '/api/admin/users/f/link-code' && o.method === 'DELETE')).toHaveLength(1)
  })
})

describe('unir ficha con cuenta', () => {
  it('elegir cuenta → vista previa → elegir plan → confirmar → abre la cuenta destino', async () => {
    await openFicha()
    await click(button('Vincular con cuenta existente'))
    const picker = [...topSheet().querySelectorAll('.lrow')].map(r => r.textContent)
    expect(picker).toEqual(['ana'])                      // ni la ficha ni el staff
    await click([...topSheet().querySelectorAll('.lrow')].find(r => r.textContent === 'ana'))
    expect(JSON.parse(calls(u => u.endsWith('/merge'))[0][1].body)).toEqual({ targetId: 'a', dry_run: true })
    expect(text()).toContain('2 pagos')
    expect(text()).toContain('Los datos de la ficha (nombre y apellido, DNI, celular, mail)')
    expect(text()).toContain('Se pierde')
    expect(text()).toContain('rutinas')
    const unir = button('Unir ficha con ana')
    expect(unir.disabled).toBe(true)                      // conflicto de plan: hay que elegir
    await click([...topSheet().querySelectorAll('.lrow')].find(r => r.textContent.startsWith('Mantener el plan de la cuenta')))
    expect(button('Unir ficha con ana').disabled).toBe(false)
    await click(button('Unir ficha con ana'))
    expect(text()).toContain('La ficha se borra, esta acción no se puede deshacer.')
    expect(calls(u => u.endsWith('/merge'))).toHaveLength(1)
    await click(button('Unir'))
    const real = calls(u => u.endsWith('/merge'))[1]
    expect(JSON.parse(real[1].body)).toEqual({ targetId: 'a', keepBilling: 'cuenta' })
    expect(sheetTitle()).toBe('ana')
    expect(document.querySelectorAll('#modal-root h3')).toHaveLength(1)   // la ficha ya no está abierta
  })

  it('dni_conflict corta: explica y no deja unir', async () => {
    mergePlan = { ...basePlan(), profile: { ficha: true, cuenta: true, conflict: true, action: 'fill' } }
    await openFicha()
    await click(button('Vincular con cuenta existente'))
    await click([...topSheet().querySelectorAll('.lrow')].find(r => r.textContent === 'ana'))
    expect(text()).toContain('tienen DNI distintos: no se pueden unir')
    expect(button('Unir ficha con ana')).toBeUndefined()
  })

  it('editar la ficha con el DNI de una cuenta ofrece Vincular con las dos ya elegidas', async () => {
    await openFicha()
    await click(button('Editar'))
    expect(sheetTitle()).toBe('Editar ficha')
    await type(fieldInput('DNI'), '30111222')
    await click(button('Guardar'))
    expect(text()).toContain('Ya existe ana (con app)')
    await click(button('Vincular'))
    expect(sheetTitle()).toBe('Vincular con cuenta existente')
    expect(JSON.parse(calls(u => u.endsWith('/merge'))[0][1].body)).toEqual({ targetId: 'a', dry_run: true })
  })
})
