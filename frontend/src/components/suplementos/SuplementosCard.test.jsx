// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { useSupplements } = await import('../../store/useSupplements.js')
const { setLang } = await import('../../lib/i18n.js')
const { default: SuplementosCard } = await import('./SuplementosCard.jsx')

const TODAY = '2026-10-09'
const crea = { id: 'crea0001', catalogId: 'creatina', dose: 5, unit: 'g', scoopG: 5, doses: 1, slot: 'morning', days: 'daily', status: 'active', createdAt: '2026-09-01T00:00:00Z' }
const beta = { id: 'beta0001', catalogId: 'betaalanina', dose: 3.2, unit: 'g', scoopG: null, doses: 2, slot: 'meals', days: 'daily', status: 'active', createdAt: '2026-09-01T00:00:00Z' }
const base = { enabled: true, ackVersion: '2026-10-09', profile: { ackVersion: '2026-10-09', adult: 1 }, adult: 'adult', today: TODAY, items: [], logs: [] }
let container, root
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
async function mount(state) {
  apiMock.mockImplementation(url => url === '/api/supplements' ? Promise.resolve(state) : Promise.resolve({ ok: true, log: { id: 'srv', itemId: 'crea0001', date: TODAY, amount: 5 } }))
  useSupplements.setState({ ...state, loaded: true })
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<MemoryRouter><SuplementosCard /></MemoryRouter>))
  await tick()
}
const text = () => container.textContent

beforeEach(async () => {
  await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 9, 12))
  apiMock.mockReset(); useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ user: { id: 'ana' }, config: { supplements_enabled: true }, S: { ...useStore.getState().S, routines: [], week: {}, dayPlan: {}, workouts: [], bodyweight: [{ d: TODAY, w: 80 }] } })
})
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.useRealTimers() })

describe('tarjeta de suplementos', () => {
  it('apagado por el gimnasio: no se ve', async () => {
    useStore.setState({ config: { supplements_enabled: false } })
    await mount(base)
    expect(text()).toBe('')
  })
  it('sin aviso aceptado: candado y "Leer el aviso" abre la hoja sin "Ahora no"', async () => {
    await mount({ ...base, profile: { ackVersion: null, adult: null }, adult: 'unknown' })
    expect(text()).toContain('leé y aceptá el aviso')
    await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent.includes('Leer el aviso')).click())
    const sheet = useUI.getState().sheets.at(-1)
    expect(sheet.locked).toBe(true)
    const host = document.createElement('div'); const r = createRoot(host)
    await act(async () => r.render(sheet.render(() => {})))
    expect(host.textContent).toContain('Leí y acepto')
    expect(host.textContent).not.toContain('Ahora no')
    expect(host.textContent).toContain('¿Tenés 18 años o más?')
    await act(async () => r.unmount())
  })
  it('vacío: llamado a la guía', async () => {
    await mount(base)
    expect(text()).toContain('¿Tomás suplementos?')
  })
  it('con items: agrupa por momento, muestra dosis y marca una toma', async () => {
    await mount({ ...base, items: [crea, beta] })
    expect(text()).toContain('Mañana'); expect(text()).toContain('Con las comidas')
    expect(text()).toContain('1 scoop · 5 g'); expect(text()).toContain('2 tomas · 1,6 g c/u')
    expect(text()).toContain('Hoy: 0 de 3 tomas')
    await act(async () => container.querySelector('[aria-label="Marcar Creatina monohidrato"]').click())
    await tick()
    expect(apiMock).toHaveBeenCalledWith('/api/supplements/log', expect.objectContaining({ method: 'POST' }))
    expect(text()).toContain('Hoy: 1 de 3 tomas')
  })
  it('cafeína: total del día y aviso al pasarse de 400', async () => {
    const logs = [{ id: 'a', itemId: null, source: 'mate', date: TODAY, amount: 300 }, { id: 'b', itemId: null, source: 'cafe', date: TODAY, amount: 150 }]
    await mount({ ...base, items: [crea], logs })
    expect(text()).toContain('450 mg')
    expect(text()).toContain('más de lo recomendado para un día')
  })
  it('un día sin nada que tomar lo dice (y no muestra "0 de 0")', async () => {
    const elec = { ...crea, id: 'elec0001', catalogId: 'electrolitos', days: 'training' }
    await mount({ ...base, items: [elec] })
    expect(text()).toContain('Hoy no toca ningún suplemento')
    expect(text()).not.toContain('0 de 0')
  })
  it('menor: solo la guía', async () => {
    await mount({ ...base, adult: 'minor', items: [crea] })
    expect(text()).toContain('no recomendamos suplementos a menores de 18')
    expect(text()).not.toContain('Hoy:')
  })
})
