// @vitest-environment happy-dom
// Tablero de Cuotas: tarjetas resumen, filtro al tocar una tarjeta, staff oculto por defecto y
// el alta de un pago desde la acción global (vista previa con dry_run y después el POST real).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

let desktop = false
window.matchMedia = query => ({ matches: query.includes('min-width: 1000px') ? desktop : false, media: query, addEventListener() {}, removeEventListener() {} })

const { default: Cuotas } = await import('./Cuotas.jsx')
const { default: Modals } = await import('../../components/Modals.jsx')
const { useUI } = await import('../../store/useUI.js')
const { bindUI } = await import('../../components/ui.jsx')
const { setLang } = await import('../../lib/i18n.js')
bindUI(useUI)

const PLAN = { id: 1, name: 'Mensual', price: 20000, durationDays: 30, active: true }
const MEMBERS = [
  { id: 'a', name: 'Ana', disabled: false, admin: false, planId: 1, planName: 'Mensual', dueDate: '2026-10-20', status: 'al_dia', debt: 0 },
  { id: 'b', name: 'Beto', disabled: false, admin: false, planId: 1, planName: 'Mensual', dueDate: '2026-09-01', status: 'bloqueado', debt: 20000 },
  { id: 'c', name: 'Carla', disabled: true, admin: false, planId: null, planName: null, dueDate: null, status: 'sin_plan', debt: 0 },
  { id: 'o', name: 'Dueña', disabled: false, admin: true, planId: null, planName: null, dueDate: null, status: 'sin_plan', debt: 0 }
]
const SUMMARY = { al_dia: 1, por_vencer: 0, vencido: 0, bloqueado: 1, sin_plan: 0, deuda_total: 20000 }

function handleApi(url, opts = {}) {
  const body = opts.body ? JSON.parse(opts.body) : null
  if (url === '/api/admin/billing') return Promise.resolve({ today: '2026-09-24', settings: {}, summary: SUMMARY, members: MEMBERS })
  if (url === '/api/admin/billing/plans') return Promise.resolve({ plans: [PLAN] })
  if (url === '/api/admin/billing/settings') return Promise.resolve({ settings: { payment_methods: ['efectivo', 'transferencia'] } })
  if (url === '/api/admin/users/b/billing') return Promise.resolve({ billing: { planId: 1, planName: 'Mensual', planPrice: 20000, dueDate: '2026-09-01', status: 'bloqueado', debt: 20000 }, payments: [] })
  if (url === '/api/admin/users/b/payments' && opts.method === 'POST') {
    return Promise.resolve(body.dry_run
      ? { dry_run: true, billing: { dueDate: '2026-10-24', status: 'al_dia' }, period: { dueDate: '2026-10-24' } }
      : { billing: { dueDate: '2026-10-24', status: 'al_dia' }, payment: { id: 1 } })
  }
  return Promise.reject(new Error('ruta no mockeada: ' + (opts.method || 'GET') + ' ' + url))
}

let container, root
const text = () => document.body.textContent
const all = selector => [...document.querySelectorAll(selector)]
const byText = (selector, label) => all(selector).find(el => el.textContent.trim() === label) || all(selector).find(el => el.textContent.includes(label))
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await tick() }
const click = async el => { expect(el, 'control no encontrado').toBeTruthy(); await act(async () => { el.click() }); await flush() }
const rows = () => all('.list .item .tt').map(el => el.textContent)

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  desktop = false
  apiMock.mockReset()
  apiMock.mockImplementation(handleApi)
  useUI.setState({ sheets: [] })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<><Cuotas /><Modals /></>) })
  await flush()
})
afterEach(async () => { await act(async () => { root.unmount() }); container.remove() })

describe('Cuotas', () => {
  it('muestra las tarjetas del resumen con montos es-AR', () => {
    const tiles = all('.billing-tiles .tile').map(el => [el.querySelector('.l').textContent, el.querySelector('.v').textContent])
    expect(tiles).toEqual([['Al día', '1'], ['Por vencer', '0'], ['Vencidos', '0'], ['Bloqueados', '1'], ['Sin plan', '0'], ['Deuda total', '$20.000']])
  })

  it('tocar una tarjeta filtra la lista y tocarla de nuevo lo quita', async () => {
    // Staff oculto por defecto; los desactivados se ven, con badge.
    expect(rows()).toEqual(['Ana', 'Beto', 'CarlaInactivo'])
    await click(byText('.billing-tiles .tile', 'Bloqueados'))
    expect(rows()).toEqual(['Beto'])
    await click(byText('.billing-tiles .tile', 'Deuda total'))
    expect(rows()).toEqual(['Beto'])
    await click(byText('.billing-tiles .tile', 'Deuda total'))
    expect(rows()).toHaveLength(3)
  })

  it('"Mostrar staff" suma a admins y owner', async () => {
    await click(byText('.lrow', 'Mostrar staff').querySelector('[role="switch"]'))
    expect(rows()).toContain('DueñaStaff')
  })

  it('en escritorio muestra la tabla', async () => {
    await act(async () => { root.unmount() })
    desktop = true
    root = createRoot(container)
    await act(async () => { root.render(<><Cuotas /><Modals /></>) })
    await flush()
    expect(all('.billing-table tbody tr')).toHaveLength(3)
    expect(all('.billing-table th').map(th => th.textContent)).toEqual(['Socio', 'Plan', 'Vence', 'Estado', 'Deuda', ''])
  })

  it('registrar pago: pide la vista previa con dry_run y después hace el POST', async () => {
    await click(byText('.billing-actions button', 'Registrar pago'))
    await flush(10)                     // la ficha se carga con import() dinámico
    expect(text()).toContain('Elegí el socio')
    await click(byText('#modal-root .lrow', 'Beto'))
    await flush(20)                     // datos + debounce de la vista previa
    expect(text()).toContain('Nuevo vencimiento')
    expect(byText('#modal-root .nutri-live', 'Nuevo vencimiento').textContent).toContain('24/10/2026')

    await click(byText('#modal-root button', 'Confirmar pago'))
    const posts = apiMock.mock.calls.filter(([url, opts]) => url === '/api/admin/users/b/payments' && opts?.method === 'POST').map(([, opts]) => JSON.parse(opts.body))
    expect(posts[0]).toMatchObject({ planId: 1, method: 'efectivo', amount: 20000, dry_run: true })
    const real = posts.filter(b => !b.dry_run)
    expect(real).toHaveLength(1)
    expect(real[0]).toMatchObject({ planId: 1, method: 'efectivo', amount: 20000 })
    expect(posts.indexOf(real[0])).toBeGreaterThan(0)
    // Refresca el tablero después de pagar.
    expect(apiMock.mock.calls.filter(([url]) => url === '/api/admin/billing').length).toBeGreaterThan(1)
  })
})

describe('Ficha de cuota', () => {
  it('ofrece "Anular" solo en el último pago vigente y muestra el 409 claro', async () => {
    const payments = [
      { id: 3, amount: 20000, method: 'efectivo', paidAt: Date.UTC(2026, 8, 20, 15), periodStart: '2026-09-01', periodEnd: '2026-10-01', planName: 'Mensual', createdByName: 'Dueña', voidedAt: null },
      { id: 2, amount: 20000, method: 'transferencia', paidAt: Date.UTC(2026, 8, 10, 15), periodStart: '2026-08-01', periodEnd: '2026-09-01', planName: 'Mensual', createdByName: 'Dueña', voidedAt: 1, voidReason: 'duplicado', voidedByName: 'Dueña' },
      { id: 1, amount: 18000, method: 'efectivo', paidAt: Date.UTC(2026, 7, 1, 15), periodStart: '2026-08-01', periodEnd: '2026-09-01', planName: 'Mensual', createdByName: 'Dueña', voidedAt: null }
    ]
    apiMock.mockImplementation((url, opts = {}) => {
      if (url === '/api/admin/users/b/billing') return Promise.resolve({ billing: { planId: 1, planName: 'Mensual', planPrice: 20000, dueDate: '2026-10-01', status: 'al_dia', debt: 0 }, payments })
      if (url === '/api/admin/users/b/payments/3/void') return Promise.reject(Object.assign(new Error('El vencimiento cambió después de este pago; no se puede anular'), { status: 409 }))
      return handleApi(url, opts)
    })
    await click(byText('.list .item', 'Beto'))
    await flush(10)
    const payRows = all('#modal-root .pay-row')
    expect(payRows).toHaveLength(3)
    expect(payRows.map(r => !!byTextIn(r, 'Anular'))).toEqual([true, false, false])
    expect(payRows[1].classList.contains('voided')).toBe(true)
    expect(payRows[1].textContent).toContain('Anulado · Dueña: duplicado')
    expect(payRows[0].textContent).toContain('$20.000 · Efectivo · 20/09/2026')

    await click(byTextIn(payRows[0], 'Anular'))
    await click(byText('#modal-root .confirm-dialog button', 'Anular pago'))
    expect(byText('#modal-root [role="alert"]', 'vencimiento cambió').textContent).toBe('El vencimiento cambió después de este pago; no se puede anular')
  })
})

function byTextIn(root, label) { return [...root.querySelectorAll('button')].find(el => el.textContent.trim() === label) }
