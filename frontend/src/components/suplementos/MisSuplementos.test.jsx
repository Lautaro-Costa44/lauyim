// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { useSupplements } = await import('../../store/useSupplements.js')
const { setLang } = await import('../../lib/i18n.js')
const { openMine } = await import('./MisSuplementos.jsx')

const TODAY = '2026-10-09'
const crea = { id: 'crea0001', catalogId: 'creatina', dose: 5, unit: 'g', scoopG: 5, doses: 1, slot: 'morning', days: 'daily', status: 'active', createdAt: '2026-09-01T00:00:00Z' }
async function render() {
  openMine()
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => r.render(sheet.render(() => {}, { setOnBack: () => {} })))
  return host
}
beforeEach(async () => {
  await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 9, 12))
  apiMock.mockReset(); apiMock.mockImplementation((url, o) => Promise.resolve(url.endsWith('/log') ? { log: JSON.parse(o.body) } : { ok: true }))
  useUI.setState({ sheets: [] }); useStore.setState({ user: { id: 'ana' }, S: { ...useStore.getState().S, workouts: [], week: {}, dayPlan: {} } })
  const logs = ['2026-10-06', '2026-10-07', '2026-10-08'].map((d, i) => ({ id: 'l' + i, itemId: 'crea0001', date: d, amount: 5 }))
  useSupplements.setState({ loaded: true, enabled: true, today: TODAY, items: [crea, { ...crea, id: 'old00001', catalogId: 'omega3', status: 'archived' }], logs })
})

describe('mis suplementos', () => {
  it('racha, cumplimiento y archivados', async () => {
    const h = await render()
    await act(async () => [...h.querySelectorAll('button')].find(b => b.textContent.includes('Creatina')).click())
    expect(h.textContent).toContain('Racha: 3 días')
    expect(h.textContent).toContain('Últimos 30 días')
    expect(h.textContent).toContain('Archivados')
    expect(h.querySelectorAll('.hm-c').length).toBeGreaterThan(0)
  })
  it('marca un día anterior dentro de los 7 días', async () => {
    const h = await render()
    await act(async () => [...h.querySelectorAll('button')].find(b => b.textContent.includes('Creatina')).click())
    await act(async () => h.querySelector('[aria-label="Marcar creatina el 2026-10-05"]').click())
    expect(useSupplements.getState().logs.some(l => l.date === '2026-10-05')).toBe(true)
    expect(h.querySelector('[aria-label="Marcar creatina el 2026-10-01"]')).toBeNull()
  })
  it('cada activo tiene su ⚙️ y cada archivado "Volver a tomar" y 🗑️ con confirmación', async () => {
    const h = await render()
    expect(h.querySelector('[aria-label="Configurar Creatina monohidrato"]')).toBeTruthy()
    const trash = h.querySelector('[aria-label="Borrar Omega-3 y su historial"]')
    expect(trash).toBeTruthy()
    await act(async () => trash.click())
    for (let i = 0; i < 150 && useUI.getState().sheets.length < 2; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    const sheet = useUI.getState().sheets.at(-1)
    const host = document.createElement('div'); const r = createRoot(host)
    await act(async () => r.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
    expect(host.textContent).toContain('¿Borrar Omega-3?')
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Borrar').click())
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(apiMock).toHaveBeenCalledWith('/api/supplements/items/delete', { method: 'POST', body: JSON.stringify({ id: 'old00001' }) })
    expect(useSupplements.getState().items.map(i => i.id)).toEqual(['crea0001'])
  })
  it('el atrás del sistema vuelve del detalle a la lista', async () => {
    let back = null; const closed = vi.fn()
    openMine()
    const sheet = useUI.getState().sheets.at(-1)
    const host = document.createElement('div'); document.body.appendChild(host); const r = createRoot(host)
    await act(async () => r.render(sheet.render(closed, { setOnBack: fn => { back = fn } })))
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Creatina')).click())
    expect(host.querySelector('.supp-detail')).toBeTruthy()
    await act(async () => back())
    expect(host.querySelector('.supp-detail')).toBeNull()
    expect(closed).not.toHaveBeenCalled()
  })
})
