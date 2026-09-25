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

let billingOn, fields, users, mergePlan, billingDetail, linked
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
  if (url === '/api/admin/billing/settings') return Promise.resolve({ settings: { payment_methods: ['efectivo', 'transferencia'], trial_days: 1, gym_tz: 'America/Argentina/Buenos_Aires', due_soon_days: 5, push_days_before: 3, grace_days: 5 } })
  if (url.startsWith('/api/admin/members/lookup')) {
    return url.endsWith('dni=30111222') ? Promise.resolve({ userId: 'a', name: 'ana', hasApp: true }) : fail(404, { error: 'No hay ningún socio con ese DNI' })
  }
  if (url === '/api/admin/members' && body.dry_run) {
    return Promise.resolve({ dry_run: true, dueDate: body.start.type === 'payment' ? '2026-10-24' : null, amount: 20000, trialUntil: body.start.type === 'trial' ? '2026-09-24' : null, trialDays: 1 })
  }
  if (url === '/api/admin/members') {
    if (body.dni === '30999888') return fail(409, { error: 'dni_duplicado', userId: 'f', name: 'Juan Ficha', hasApp: false })
    users = [...users, NEW]
    return Promise.resolve({ member: { userId: 'new', name: 'Nuevo Socio', hasApp: false } })
  }
  if (url.startsWith('/api/admin/user?id=')) {
    const u = [...users, NEW].find(x => x.id === decodeURIComponent(url.split('=')[1]))
    return Promise.resolve({ user: { ...u, ...(linked && u.id === 'f' ? { hasApp: true } : {}), created: '2026-01-01' }, workouts: [], bodyweight: [], routines: [], lastSync: null, unit: 'kg' })
  }
  if (url.endsWith('/profile') && opts.method === 'PUT') {
    return body.dni === '30111222' ? fail(409, { error: 'dni_duplicado', userId: 'a', name: 'ana', hasApp: true }) : Promise.resolve({ profile: {} })
  }
  if (url.endsWith('/profile')) return Promise.resolve({ profile: { fullName: 'Juan Pérez', dni: '30.999.888', phone: null, email: null, hasApp: false }, fields })
  if (url.endsWith('/link-code')) return Promise.resolve(opts.method === 'DELETE' ? { ok: true, revoked: 1 } : { code: 'ABCD-EFGH', link: 'https://gym.test/?link=ABCD-EFGH', expiresAt: EXPIRES })
  if (url.endsWith('/merge')) return body.dry_run ? Promise.resolve({ dry_run: true, ...mergePlan }) : Promise.resolve({ ok: true, ...mergePlan })
  if (url.startsWith('/api/admin/users/') && url.endsWith('/billing')) return Promise.resolve(billingDetail)
  if (url.endsWith('/trial')) return Promise.resolve({ billing: { ...billingDetail.billing, status: 'prueba', trialUntil: '2026-09-24' } })
  if (url === '/api/admin/billing') return Promise.resolve({ today: '2026-09-24', settings: {}, summary: { al_dia: 0, por_vencer: 0, vencido: 0, bloqueado: 0, sin_plan: 1, en_prueba: 1, deuda_total: 0 }, members: [
    { id: 'a', name: 'ana', disabled: false, admin: false, hasApp: true, planId: null, status: 'sin_plan', debt: 0 },
    { id: 'f', name: 'Juan Ficha', disabled: false, admin: false, hasApp: false, planId: null, trialUntil: '2026-09-26', status: 'prueba', debt: 0 }] })
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
  linked = false
  billingDetail = { billing: { planId: null, status: 'sin_plan', debt: 0, trialUntil: null }, payments: [], trial: { days: 1, until: '2026-09-24', available: true, blocker: null } }
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
  const fillData = async (name, dni) => {
    await type(fieldInput('Nombre y apellido'), name)
    if (dni) await type(fieldInput('DNI'), dni)
  }
  const option = label => [...topSheet().querySelectorAll('.start-opt')].find(r => r.textContent.startsWith(label))
  const createBody = () => JSON.parse(calls((u, o) => u === '/api/admin/members' && !JSON.parse(o.body).dry_run)[0][1].body)

  it('muestra solo los campos que se piden, marca los obligatorios y sigue a "Cuota inicial"', async () => {
    await openCreate()
    const labels = [...document.querySelectorAll('.member-field-l')].map(l => l.textContent)
    expect(labels).toEqual(['Nombre y apellido *', 'DNI *', 'Celular'])
    expect(text()).toContain('Estos datos se usan solo para identificar al socio en el gimnasio y solo los ve el staff.')
    expect(button('Crear socio')).toBeUndefined()
    await click(button('Siguiente'))
    expect([...topSheet().querySelectorAll('.start-opt .lrow-t')].map(el => el.textContent)).toEqual(['Registrar pago', 'Iniciar prueba', 'Solo ficha'])
  })

  it('el DNI solo acepta dígitos, hasta 8', async () => {
    await openCreate()
    const dni = await type(fieldInput('DNI'), '30.111.222-99')
    expect(dni.value).toBe('30111222')
    expect(dni.maxLength).toBe(8)
    expect(dni.getAttribute('inputmode')).toBe('numeric')
  })

  it('con cuotas apagado no hay cuota inicial: se crea directo', async () => {
    billingOn = false
    await openCreate()
    expect([...topSheet().querySelectorAll('button')].some(b => b.textContent.trim() === 'Siguiente')).toBe(false)   // "Siguiente" de la paginación no cuenta
    expect(calls(u => u === '/api/admin/billing/plans' || u === '/api/admin/billing/settings')).toHaveLength(0)
    await fillData('Solo Ficha', '40111223')
    await click(button('Crear socio'))
    expect(createBody().start).toBeUndefined()
  })

  it('al salir del DNI avisa del duplicado y "Abrir" abre a esa persona', async () => {
    await openCreate()
    await blur(await type(fieldInput('DNI'), '30111222'))
    expect(text()).toContain('Ya existe ana (con app)')
    expect(button('Siguiente').disabled).toBe(true)
    await click(button('Abrir'))
    expect(sheetTitle()).toBe('ana')
    expect(calls(u => u === '/api/admin/members')).toHaveLength(0)
  })

  it('un 409 dni_duplicado al guardar vuelve a los datos y muestra quién es', async () => {
    await openCreate()
    await fillData('Pedro Gómez', '30999888')
    await click(button('Siguiente'))
    await click(option('Solo ficha'))
    await click(button('Crear socio'))
    expect(text()).toContain('Ya existe Juan Ficha (sin app)')
    expect(fieldInput('DNI')).toBeTruthy()
  })

  it('registrar pago: plan como paso interno, vencimiento del dry_run y alta con start payment', async () => {
    await openCreate()
    await fillData('Nuevo Socio', '40111222')
    await click(button('Siguiente'))
    expect(option('Registrar pago').querySelector('.lrow-k')).toBeTruthy()          // elegido por defecto
    await act(async () => { await new Promise(r => setTimeout(r, 300)) })
    await flush()
    expect(topSheet().querySelector('.nutri-live').textContent).toContain('24/10/2026')
    // Elegir plan no apila otro sheet: es un paso del mismo.
    const sheets = useUI.getState().sheets.length
    await click([...topSheet().querySelectorAll('.lrow')].find(r => r.textContent.startsWith('Plan')))
    expect(useUI.getState().sheets).toHaveLength(sheets)
    expect(topSheet().querySelector('.picker-step h3').textContent).toBe('Plan')
    await click([...topSheet().querySelectorAll('.picker-step .lrow')].find(r => r.textContent.startsWith('Mensual')))
    expect(topSheet().querySelector('.picker-step')).toBeNull()
    expect(option('Registrar pago')).toBeTruthy()                                     // de vuelta en "Cuota inicial"
    const before = calls(u => u === '/api/admin/users').length
    await click(button('Crear socio'))
    const body = createBody()
    expect(body).toMatchObject({ fullName: 'Nuevo Socio', dni: '40111222', start: { type: 'payment', planId: 1, amount: 20000, method: 'efectivo' } })
    expect(body.planId).toBeUndefined()
    expect(calls(u => u === '/api/admin/users').length).toBeGreaterThan(before)
    expect(sheetTitle()).toBe('Nuevo Socio')
  })

  it('iniciar prueba: deshabilitada sin DNI; con DNI muestra el vencimiento y crea con start trial', async () => {
    await openCreate()
    await fillData('Sin Documento')
    await click(button('Siguiente'))
    expect(option('Iniciar prueba').classList.contains('lrow-disabled')).toBe(true)
    expect(option('Iniciar prueba').textContent).toContain('Cargá el DNI en el paso anterior')
    expect(option('Iniciar prueba').tagName).toBe('DIV')                              // sin onClick
    await click(button('Volver'))
    await type(fieldInput('DNI'), '40111224')
    await click(button('Siguiente'))
    await click(option('Iniciar prueba'))
    await act(async () => { await new Promise(r => setTimeout(r, 300)) })
    await flush()
    expect(option('Iniciar prueba').textContent).toContain('Prueba de 1 día, vence el 24/09')
    await click(button('Crear socio'))
    expect(createBody().start).toEqual({ type: 'trial' })
  })

  it('prueba deshabilitada si el gimnasio no pide DNI', async () => {
    fields = { ...fields, dni: { enabled: false, required: false } }
    await openCreate()
    await fillData('Sin Campo')
    await click(button('Siguiente'))
    expect(option('Iniciar prueba').textContent).toContain('este gimnasio no lo pide')
  })

  it('solo ficha: sin start', async () => {
    await openCreate()
    await fillData('Solo Ficha', '40111225')
    await click(button('Siguiente'))
    await click(option('Solo ficha'))
    await click(button('Crear socio'))
    expect(createBody().start).toBeUndefined()
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
    await type(searchInput(), '301112229')                 // 9 dígitos: ya no es un DNI
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

describe('prueba en Cuotas', () => {
  const openBilling = async () => {
    await mount('#/admin/cuotas')
    await click([...document.querySelectorAll('.list .item')].find(el => el.textContent.includes('Juan Ficha')))
    expect(sheetTitle()).toBe('Cuota')
  }

  it('tablero: tarjeta y chip "En prueba" y la fila con "Prueba hasta dd/mm"', async () => {
    await mount('#/admin/cuotas')
    const tile = [...document.querySelectorAll('.billing-tiles .tile')].find(el => el.textContent.startsWith('En prueba'))
    expect(tile.querySelector('.v').textContent).toBe('1')
    expect([...document.querySelectorAll('.chips .chip')].map(c => c.textContent)).toContain('En prueba')
    const row = [...document.querySelectorAll('.list .item')].find(el => el.textContent.includes('Juan Ficha'))
    expect(row.textContent).toContain('Prueba hasta 26/09')
    expect(row.querySelector('.tag.st-prueba').textContent).toBe('En prueba')
    await click(tile)
    expect([...document.querySelectorAll('.list .item')]).toHaveLength(1)
  })

  it('ficha de cuota: "Iniciar prueba" pide confirmación y la inicia', async () => {
    await openBilling()
    await click(button('Iniciar prueba'))
    expect(text()).toContain('Prueba de 1 día: puede usar la app solo hoy. Es una sola por persona.')
    expect(calls(u => u.endsWith('/trial'))).toHaveLength(0)
    await click(button('Iniciar prueba'))              // el del confirm
    expect(calls((u, o) => u === '/api/admin/users/f/trial' && o.method === 'POST')).toHaveLength(1)
  })

  it('ficha de cuota: "Ya usó su prueba" en lugar del botón', async () => {
    billingDetail = { ...billingDetail, trial: { days: 1, until: '2026-09-24', available: false, blocker: 'trial_used' } }
    await openBilling()
    expect(button('Iniciar prueba')).toBeUndefined()
    expect(text()).toContain('Ya usó su prueba')
  })

  it('registrar pago: el plan se elige como paso interno y el back vuelve al formulario', async () => {
    await openBilling()
    await click(button('Registrar pago'))
    const sheets = useUI.getState().sheets.length
    await click([...topSheet().querySelectorAll('.lrow')].find(r => r.textContent.startsWith('Plan')))
    expect(useUI.getState().sheets).toHaveLength(sheets)
    expect(topSheet().querySelector('.picker-step')).toBeTruthy()
    // Gesto de atrás: cierra la lista, no el sheet.
    const back = useUI.getState().getSheetOnBack(useUI.getState().sheets.at(-1).id)
    await act(async () => { back() })
    await flush()
    expect(topSheet().querySelector('.picker-step')).toBeNull()
    expect(topSheet().textContent).toContain('Monto ($)')
  })

  it('configuración: la zona horaria se elige como paso interno', async () => {
    await mount('#/admin/cuotas')
    await click(button('Configuración'))
    expect(text()).toContain('Días de prueba')
    const sheets = useUI.getState().sheets.length
    await click([...document.querySelectorAll('#modal-root .lrow')].find(r => r.textContent.startsWith('Zona horaria')))
    expect(useUI.getState().sheets).toHaveLength(sheets)
    await click([...document.querySelectorAll('#modal-root .picker-step .lrow')].find(r => r.textContent.startsWith('Cordoba')))
    expect(document.querySelector('#modal-root .picker-step')).toBeNull()
    expect([...document.querySelectorAll('#modal-root .lrow')].find(r => r.textContent.startsWith('Zona horaria')).textContent).toContain('Cordoba')
  })
})

describe('código de vinculación: se cierra solo al vincular', () => {
  afterEach(() => { vi.useRealTimers() })
  const polls = () => calls(u => u === '/api/admin/user?id=f').length

  it('consulta cada 3 s y, con hasApp, cierra, avisa y refresca detalle y lista', async () => {
    await openFicha()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await click(button('Generar código de vinculación'))
    expect(document.querySelector('.link-code-v')).toBeTruthy()
    const start = polls()
    await act(async () => { vi.advanceTimersByTime(3000) })
    await flush()
    expect(polls()).toBe(start + 1)
    expect(document.querySelector('.link-code-v')).toBeTruthy()      // todavía sin app
    const usersBefore = calls(u => u === '/api/admin/users').length
    linked = true
    await act(async () => { vi.advanceTimersByTime(3000) })
    await flush()
    expect(document.querySelector('.link-code-v')).toBeNull()
    expect(useUI.getState().toastMsg).toBe('Juan Ficha ya tiene acceso a la app')
    expect(calls(u => u === '/api/admin/users').length).toBeGreaterThan(usersBefore)
    expect(document.querySelector('#modal-root .tiles')).toBeTruthy()   // el detalle ya no es "sin app"
    const after = polls()
    await act(async () => { vi.advanceTimersByTime(9000) })
    await flush()
    expect(polls()).toBe(after)                                       // polling cortado
  })

  it('cerrar el sheet corta el polling', async () => {
    await openFicha()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await click(button('Generar código de vinculación'))
    await click(topSheet().querySelector('.compound-builder-header .iconbtn'))
    expect(document.querySelector('.link-code-v')).toBeNull()
    const before = polls()
    await act(async () => { vi.advanceTimersByTime(9000) })
    await flush()
    expect(polls()).toBe(before)
  })
})
