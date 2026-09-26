// @vitest-environment happy-dom
// Importar socios (solo owner) con la App real, como Members.test.jsx: el botón, los pasos del
// asistente con el archivo de ejemplo, la vista previa con pestañas, la descarga de errores y el
// resultado. Más el historial de cuota con una prueba (sin botón anular).
import React, { act } from 'react'
import { readFileSync } from 'node:fs'
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

const FICHA = { id: 'f', name: 'Juan Ficha', hasApp: false, profileIncomplete: true, workouts: 0, lastSync: null }
const ANA = { id: 'a', name: 'ana', hasApp: true, profileIncomplete: false, workouts: 3, lastSync: Date.now() }
const PLANS = [{ id: 1, name: 'Mensual', price: 30000, durationDays: 30, active: true }]
const PREVIEW = {
  dry_run: true,
  summary: { nuevos: 17, existentes: 1, errores: 7, warnings: 3, completar: 1 },
  warnings: [],
  rows: [
    { rowNumber: 2, status: 'nuevo', messages: [{ level: 'info', text: 'Mensual · vence 10/10/2026' }] },
    { rowNumber: 13, status: 'nuevo', messages: [{ level: 'warning', text: 'Datos incompletos: falta celular' }] },
    { rowNumber: 8, status: 'existente', messages: [{ level: 'info', text: 'Ya existe: Socio Existente' }, { level: 'info', text: 'Se completa: celular' }] },
    { rowNumber: 5, status: 'error', messages: [{ level: 'error', text: 'El DNI debe tener entre 6 y 8 dígitos' }] },
    { rowNumber: 25, status: 'error', messages: [{ level: 'error', text: 'Falta el DNI' }] },
  ],
}
let owner, preview
apiMock.mockImplementation((url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {}
  if (url === '/api/admin/users') return Promise.resolve({ users: [ANA, FICHA], invite_only: false, audit_enabled: true, billing_enabled: true })
  if (url === '/api/admin/members/settings') return Promise.resolve({ fields: { full_name: { enabled: true, required: true }, dni: { enabled: true, required: true }, phone: { enabled: true, required: true }, email: { enabled: true, required: false } } })
  if (url === '/api/admin/billing/plans') return Promise.resolve({ plans: PLANS })
  if (url === '/api/admin/billing/settings') return Promise.resolve({ settings: { payment_methods: ['efectivo', 'transferencia'], trial_days: 1, gym_tz: 'America/Argentina/Buenos_Aires', due_soon_days: 5, push_days_before: 3, grace_days: 5 } })
  if (url === '/api/owner/members/import') return Promise.resolve(body.dry_run ? preview : { ok: true, created: 17, updated: 1, skipped: 0, errors: 7 })
  if (url === '/api/admin/invites') return Promise.resolve({ invites: [] })
  if (url === '/api/admin/presets') return Promise.resolve({ presets: [] })
  if (url === '/api/admin/attendance-heatmap') return Promise.resolve({ start: 'monday', totalUsers: 1, days: {} })
  return Promise.resolve({})
})

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { default: App } = await import('../../App.jsx')
const { setLang } = await import('../../lib/i18n.js')
const { MemberBillingSheet } = await import('./billing/MemberBillingSheet.jsx')

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const flush = async () => {
  for (let i = 0; i < 5; i++) await tick()
  for (let i = 0; i < 150 && document.querySelector('.page-loading'); i++) await tick()
  for (let i = 0; i < 5; i++) await tick()
}
const text = () => document.body.textContent
const calls = pred => apiMock.mock.calls.filter(([u, o]) => pred(u, o || {}))
const button = label => [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === label).at(-1)
const click = async el => { expect(el).toBeTruthy(); await act(async () => { el.click() }); await flush() }
const sheet = () => [...document.querySelectorAll('#modal-root .compound-builder')].at(-1)
const subtitle = () => sheet()?.querySelector('.t-sub')?.textContent
const rowByTitle = (selector, title) => [...sheet().querySelectorAll(selector)].find(r => r.querySelector('.lrow-t')?.textContent === title)
const pickOption = async label => click([...sheet().querySelectorAll('.picker-step button.lrow')].find(b => b.querySelector('.lrow-t').textContent === label))
const type = async (el, value) => {
  expect(el).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const chooseFile = async name => {
  const input = sheet().querySelector('input[type="file"]')
  const file = new File([new Uint8Array(readFileSync(new URL('./members/__fixtures__/' + name, import.meta.url)))], name)
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
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

let blobs
beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  owner = { id: 'o', name: 'o', admin: true, owner: true }
  preview = PREVIEW
  blobs = []
  URL.createObjectURL = vi.fn(b => { blobs.push(b); return 'blob:x' })
  URL.revokeObjectURL = () => {}
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  apiMock.mockClear()
  useUI.setState({ sheets: [] })
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.restoreAllMocks()
})

describe('importar socios', () => {
  it('el botón aparece solo para el owner; la lista marca "Datos incompletos"', async () => {
    await mount('#/admin/usuarios', { id: 'x', name: 'x', admin: true, owner: false })
    expect(button('Nuevo socio (sin app)')).toBeTruthy()
    expect(button('Importar socios')).toBeUndefined()
    const item = [...document.querySelectorAll('.admin-users .item')].find(el => el.textContent.includes('Juan Ficha'))
    expect(item.querySelector('.member-incomplete').textContent).toBe('Datos incompletos')
    await act(async () => { root.unmount() })
    container.remove()

    await mount('#/admin/usuarios', owner)
    expect(button('Importar socios')).toBeTruthy()
  })

  it('plantilla: CSV con BOM y ";"', async () => {
    await mount('#/admin/usuarios', owner)
    await click(button('Importar socios'))
    expect(subtitle()).toBe('Paso 1 de 4 · Archivo')
    await click(button('Descargar plantilla'))
    const csv = new TextDecoder().decode(await blobs[0].arrayBuffer())
    expect(csv).toMatch(/^Nombre y apellido;DNI;Celular;Mail;Plan;Vencimiento;Fecha último pago;Monto último pago\r\n/)
    expect(new Uint8Array(await blobs[0].arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]))
  })

  it('pasos: archivo → columnas → planes → opciones → vista previa con pestañas → resultado', async () => {
    await mount('#/admin/usuarios', owner)
    await click(button('Importar socios'))
    expect(button('Siguiente').disabled).toBe(true)
    await chooseFile('import-ejemplo.csv')
    expect(text()).toContain('25 filas con datos')
    await click(button('Siguiente'))

    // Columnas: autodetectadas, con 3 ejemplos cada una.
    expect(subtitle()).toMatch(/^Paso 2 de 5 · Columnas/)
    const col = title => rowByTitle('.import-col', title)
    expect(col('Nombre y apellido').querySelector('.lrow-v').textContent).toBe('Nombre y apellido')
    expect(col('Nombre y apellido').querySelector('.lrow-s').textContent).toBe('Lucía Gómez · Juan Carlos Ruiz · Ana Torres')
    expect(col('Apellido').querySelector('.lrow-v').textContent).toBe('Apellido')
    expect(col('Monto último pago').querySelector('.lrow-v').textContent).toBe('Monto último pago')
    // Cambiar una columna: el selector es un paso interno del mismo sheet.
    await click(col('Mail'))
    expect(sheet().querySelector('.picker-step')).toBeTruthy()
    await pickOption('Ignorar')
    expect(col('Mail').querySelector('.lrow-v').textContent).toBe('Ignorar')
    // Sin columna de DNI no se puede seguir.
    await click(col('DNI'))
    await pickOption('Ignorar')
    expect(text()).toContain('Elegí la columna del DNI')
    expect(button('Siguiente').disabled).toBe(true)
    await click(col('DNI'))
    await pickOption('DNI')
    await click(button('Siguiente'))

    // Planes: cada valor distinto con su cantidad; el que coincide con un plan queda elegido.
    expect(subtitle()).toMatch(/Planes$/)
    const planSection = value => [...sheet().querySelectorAll('.sect')].find(s => s.querySelector('.sect-t')?.textContent.startsWith(`"${value}"`))
    expect(planSection('Musculación').querySelector('.sect-t').textContent).toBe('"Musculación" · 2 socios')
    expect(planSection('Mensual').querySelector('.lrow-v').textContent).toBe('Mensual')
    expect(planSection('Funcional').querySelector('.lrow-v').textContent).toBe('Crear plan nuevo')
    expect(button('Siguiente').disabled).toBe(true)                       // falta el precio de los nuevos
    await click(planSection('Pase Libre').querySelector('button.lrow'))
    await pickOption('Sin plan')
    for (const value of ['Musculación', 'Funcional']) await type(planSection(value).querySelector('input[aria-label="Precio del plan"]'), '25000')
    await flush()
    await click(button('Siguiente'))

    // Opciones: duplicados y método de los pagos importados.
    expect(subtitle()).toMatch(/Opciones$/)
    await click(rowByTitle('.lrow', 'Completar solo datos vacíos'))
    await click(button('Transferencia'))
    await click(button('Ver vista previa'))

    const [, opts] = calls((u, o) => u === '/api/owner/members/import').at(-1)
    const sent = JSON.parse(opts.body)
    expect(sent.dry_run).toBe(true)
    expect(sent.rows).toHaveLength(25)
    expect(sent.rows.find(r => r.rowNumber === 3)).toMatchObject({ fullName: 'Martín Pérez', dni: '28111222', email: '' })
    expect(sent.options).toEqual({ duplicates: 'fill_empty', paymentMethod: 'transferencia' })
    expect(sent.planMap).toEqual(expect.arrayContaining([
      { value: 'Mensual', action: 'existing', planId: 1 },
      { value: 'Musculación', action: 'create', name: 'Musculación', price: 25000, durationDays: 30 },
      { value: 'Pase Libre', action: 'none' },
    ]))

    // Vista previa: totales y pestañas.
    expect(subtitle()).toMatch(/Vista previa$/)
    expect([...sheet().querySelectorAll('.import-totals .v')].map(v => v.textContent)).toEqual(['17', '1', '7', '3'])
    expect([...sheet().querySelectorAll('.import-tabs button')].map(b => b.textContent)).toEqual(['Nuevos (17)', 'Ya existen (1)', 'Errores (7)'])
    expect(text()).toContain('Fila 2 · Lucía Gómez')
    expect(text()).not.toContain('Fila 5')
    await click(button('Errores (7)'))
    expect(text()).toContain('Fila 5 · Juan Carlos Ruiz')
    expect(text()).toContain('El DNI debe tener entre 6 y 8 dígitos')
    await click(button('Descargar errores'))
    const csv = new TextDecoder().decode(await blobs.at(-1).arrayBuffer())
    expect(csv).toContain("25;'=Pedro Test;;Falta el DNI")
    await click(button('Ya existen (1)'))
    expect(text()).toContain('Se completa: celular')

    // Importar: nuevos + existentes a completar.
    await click(button('Importar 18 socios'))
    expect(JSON.parse(calls((u, o) => u === '/api/owner/members/import').at(-1)[1].body).dry_run).toBeUndefined()
    expect(subtitle()).toBe('Listo')
    expect(rowByTitle('.lrow', 'Creados').querySelector('.lrow-v').textContent).toBe('17')
    expect(rowByTitle('.lrow', 'Completados').querySelector('.lrow-v').textContent).toBe('1')
    await click(button('Ver socios'))
    expect(sheet()).toBeUndefined()
    expect(document.querySelector('.member-filter .chip.on').textContent).toBe('Sin app')
  }, 30000)

  it('"Importar" deshabilitado si no hay nada para importar; atrás retrocede un paso', async () => {
    preview = { ...PREVIEW, summary: { nuevos: 0, existentes: 1, errores: 7, warnings: 0, completar: 0 }, rows: PREVIEW.rows.filter(r => r.status !== 'nuevo') }
    await mount('#/admin/usuarios', owner)
    await click(button('Importar socios'))
    await chooseFile('import-ejemplo.csv')
    await click(button('Siguiente'))
    await click(button('Siguiente'))
    for (const value of ['Musculación', 'Funcional', 'Pase Libre']) {
      const s = [...sheet().querySelectorAll('.sect')].find(x => x.querySelector('.sect-t')?.textContent.startsWith(`"${value}"`))
      await click(s.querySelector('button.lrow'))
      await pickOption('Sin plan')
    }
    await click(button('Siguiente'))
    await click(button('Ver vista previa'))
    expect(button('Importar 0 socios').disabled).toBe(true)
    expect(button('Errores (7)').getAttribute('aria-pressed')).toBe('true')   // sin nuevos, abre en errores
    await click(button('Volver'))
    expect(subtitle()).toMatch(/Opciones$/)
  })
})

describe('importar socios en escritorio (>= 1000px)', () => {
  beforeEach(() => { window.matchMedia = query => ({ matches: /min-width: ?1000px/.test(query), media: query, addEventListener() {}, removeEventListener() {} }) })
  afterEach(() => { window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) })

  it('columnas, planes y vista previa son tablas; DNI enmascarado y aviso de la fila de ejemplo', async () => {
    preview = { ...PREVIEW, warnings: ['Se ignoró la fila de ejemplo de la plantilla.'] }
    await mount('#/admin/usuarios', owner)
    await click(button('Importar socios'))
    await chooseFile('import-ejemplo.csv')
    await click(button('Siguiente'))

    const headers = table => [...table.querySelectorAll('thead th')].map(th => th.textContent)
    const cols = sheet().querySelector('table.import-table')
    expect(headers(cols)).toEqual(['Columna del archivo', 'Ejemplos', 'Campo'])
    const nameRow = [...cols.querySelectorAll('tbody tr')][0]
    expect([...nameRow.querySelectorAll('td.samples div')].map(d => d.textContent)).toEqual(['Lucía Gómez', 'Juan Carlos Ruiz', 'Ana Torres'])
    expect(nameRow.querySelector('.import-pick').textContent).toBe('Nombre y apellido')
    await click(sheet().querySelector('button[aria-label="Campo de Mail"]'))
    await pickOption('Ignorar')
    expect(sheet().querySelector('button[aria-label="Campo de Mail"]').textContent).toBe('Ignorar')
    await click(button('Siguiente'))

    const plans = sheet().querySelector('table.import-plans')
    expect(headers(plans)).toEqual(['Valor del archivo', 'Socios', 'Acción', 'Plan nuevo: nombre · precio ($) · días'])
    const planRow = value => [...plans.querySelectorAll('tbody tr')].find(tr => tr.querySelector('td').textContent === value)
    expect(planRow('Musculación').querySelectorAll('td')[1].textContent).toBe('2')
    expect(planRow('Mensual').textContent).toContain('$30.000 · 30 días')
    await click(sheet().querySelector('button[aria-label="Plan para Pase Libre"]'))
    await pickOption('Sin plan')
    for (const value of ['Musculación', 'Funcional']) await type(planRow(value).querySelector('input[aria-label="Precio del plan"]'), '25000')
    await flush()
    await click(button('Siguiente'))
    await click(button('Ver vista previa'))

    expect(sheet().querySelector('.import-warning').textContent).toBe('Se ignoró la fila de ejemplo de la plantilla.')
    const table = sheet().querySelector('table.import-preview')
    expect(table.closest('.import-table-wrap')).toBeTruthy()
    expect(headers(table)).toEqual(['Fila', 'Nombre', 'DNI', 'Estado', 'Motivo'])
    expect([...table.querySelectorAll('tbody tr')[0].querySelectorAll('td')].map(td => td.textContent))
      .toEqual(['2', 'Lucía Gómez', '***456', 'Nuevo', 'Mensual · vence 10/10/2026'])
    await click(button('Errores (7)'))
    expect([...sheet().querySelectorAll('table.import-preview tbody tr')].map(tr => tr.querySelectorAll('td')[2].textContent)).toEqual(['***789', '—'])
    expect(table.textContent).not.toMatch(/30\.123\.456|123456789/)
  }, 30000)
})

describe('historial de cuota', () => {
  it('la prueba se muestra con días, fechas y quién, monto $0 y sin anular; un pago importado tampoco se anula', async () => {
    apiMock.mockImplementation(url => {
      if (url === '/api/admin/users/f/billing') return Promise.resolve({
        billing: { planId: 1, planName: 'Mensual', status: 'al_dia', dueDate: '2026-10-25', debt: 0, trialUntil: null },
        payments: [{ id: 7, amount: 30000, method: 'efectivo', paidAt: Date.UTC(2026, 8, 25, 15), planName: 'Mensual', note: 'Importado', source: 'import' }],
        history: [
          { type: 'payment', id: 7, amount: 30000, method: 'efectivo', paidAt: Date.UTC(2026, 8, 25, 15), planName: 'Mensual', note: 'Importado', source: 'import' },
          { type: 'trial', id: 3, startDate: '2026-09-20', trialUntil: '2026-09-22', days: 3, amount: 0, createdByName: 'Dueña' },
        ],
        trial: { days: 1, until: '2026-09-25', available: false, blocker: 'trial_used' }
      })
      if (url === '/api/admin/billing/plans') return Promise.resolve({ plans: PLANS })
      if (url === '/api/admin/billing/settings') return Promise.resolve({ settings: { payment_methods: ['efectivo'] } })
      return Promise.resolve({})
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<MemberBillingSheet userId="f" userName="Juan Ficha" close={() => {}} />) })
    await flush()
    const rows = [...container.querySelectorAll('.pay-row')]
    expect(rows).toHaveLength(2)
    expect(rows[1].classList.contains('trial')).toBe(true)
    expect(rows[1].querySelector('.lrow-t').textContent).toBe('Prueba gratis · 3 días · 20/09–22/09 · Dueña')
    expect(rows[1].querySelector('.lrow-v').textContent).toBe('$0')
    expect(rows[0].textContent).toContain('Importado')
    expect([...container.querySelectorAll('button')].some(b => b.textContent.trim() === 'Anular')).toBe(false)
  })
})
