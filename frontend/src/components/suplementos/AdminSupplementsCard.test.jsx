// @vitest-environment happy-dom
// Suplementos de un socio para el staff: activos con cumplimiento, días con exceso, interruptor solo con
// "Deshabilitar suplementos" (con motivo) y nada si el módulo está apagado.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { setLang } = await import('../../lib/i18n.js')
const { addDays } = await import('../../lib/suplementos.js')
const { default: AdminSupplementsCard } = await import('./AdminSupplementsCard.jsx')

const TODAY = '2026-10-13'
const crea = { id: 'crea0001', catalogId: 'creatina', dose: 5, unit: 'g', scoopG: 5, doses: 1, slot: 'morning', days: 'daily', status: 'active', createdAt: '2026-09-01T12:00:00Z', reminderTimes: [] }
const data = (extra = {}) => ({
  enabled: true,
  access: { disabled: false, reason: null, at: null },
  items: [crea, { ...crea, id: 'old00001', catalogId: 'omega3', status: 'archived' }],
  logs: [
    ...Array.from({ length: 10 }, (_, i) => ({ itemId: 'crea0001', date: addDays(TODAY, -1 - i), amount: 5 })),
    { itemId: 'crea0001', date: addDays(TODAY, -2), amount: 20 },
  ],
  caffeine: [{ date: addDays(TODAY, -3), mg: 520 }],
  plan: { week: {}, dayPlan: {}, workoutDates: [] },
  ...extra,
})
let container, root
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
async function mount(body, user) {
  useStore.setState({ user })
  apiMock.mockImplementation((url, o) => o?.method === 'PUT'
    ? Promise.resolve({ access: { disabled: !JSON.parse(o.body).enabled, reason: JSON.parse(o.body).reason || null, at: 'x' } })
    : Promise.resolve(body))
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<AdminSupplementsCard userId="ana" userName="Ana" />))
  await tick()
}
const text = () => container.textContent
const NUTRI = { id: 'n', permissions: ['members.view', 'health.view', 'supplements.view', 'supplements.manage'] }
const VIEWER = { id: 'v', permissions: ['members.view', 'health.view', 'supplements.view'] }

beforeEach(async () => {
  await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 13, 12))
  apiMock.mockReset(); useUI.setState({ sheets: [], toastMsg: '' })
})
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.useRealTimers() })

describe('suplementos del socio (staff)', () => {
  it('activos con racha y %, excesos con cafeína y el aviso arriba; sin "aceptó el aviso"', async () => {
    await mount(data(), NUTRI)
    expect(text()).toContain('2 días con exceso')
    expect(text()).toContain('Creatina monohidrato')
    expect(text()).toMatch(/\d+ %/)
    expect(text()).toContain('1 archivado')
    expect(text()).toContain('Cafeína'); expect(text()).toContain('520 mg')
    expect(text()).toContain('25 g')
    expect(text()).not.toMatch(/aviso/i)
  })
  it('solo con "Ver": sin interruptor, con el estado en texto', async () => {
    await mount(data(), VIEWER)
    expect(container.querySelector('[role="switch"]')).toBeNull()
    expect(text()).toContain('Habilitado para este socio')
  })
  it('deshabilitar pide confirmación con motivo y lo manda', async () => {
    await mount(data(), NUTRI)
    await act(async () => container.querySelector('[role="switch"]').click())
    const sheet = useUI.getState().sheets.at(-1)
    expect(sheet.overlay).toBe(true)   // sobre Administrar, sin taparla
    const host = document.createElement('div'); const r = createRoot(host)
    await act(async () => r.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
    expect(host.textContent).toContain('¿Deshabilitar suplementos para Ana?')
    const input = host.querySelector('input[name="supp-reason"]')
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, 'Por indicación médica'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Deshabilitar').click())
    await tick()
    expect(apiMock).toHaveBeenCalledWith('/api/admin/users/ana/supplements/access', { method: 'PUT', body: JSON.stringify({ enabled: false, reason: 'Por indicación médica' }) })
    expect(text()).toContain('Deshabilitado para este socio · Por indicación médica')
  })
  it('sin nada cargado: "No registra suplementos." y el acceso', async () => {
    await mount(data({ items: [], logs: [], caffeine: [] }), NUTRI)
    expect(text()).toContain('No registra suplementos.')
    expect(container.querySelector('[role="switch"]')).toBeTruthy()
  })
  it('módulo apagado por el owner: no muestra nada', async () => {
    await mount({ enabled: false }, NUTRI)
    expect(text()).toBe('')
  })
})
