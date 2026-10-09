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
const { CAFFEINE_SOURCES } = await import('../../lib/suplementos-data.js')
const { openCaffeine } = await import('./CafeinaSheet.jsx')

const TODAY = '2026-10-09'
const MATE = CAFFEINE_SOURCES.find(s => s.id === 'mate').mg
async function render() {
  openCaffeine()
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => r.render(sheet.render(() => {}, { setOnBack: () => {} })))
  return host
}
const btn = (h, re) => [...h.querySelectorAll('button')].find(b => re.test(b.textContent))
beforeEach(async () => {
  await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockReset(); apiMock.mockImplementation((url, o) => Promise.resolve(url.endsWith('/log') ? { log: { ...JSON.parse(o.body), createdAt: new Date().toISOString() } } : { ok: true }))
  useUI.setState({ sheets: [] }); useStore.setState({ user: { id: 'ana' } })
  useSupplements.setState({ loaded: true, enabled: true, today: TODAY, items: [], logs: [] })
})

describe('cafeína del día', () => {
  it('cada toque del mate suma ½ termo y muestra ×N', async () => {
    const h = await render()
    await act(async () => btn(h, /Mate/).click())
    await act(async () => btn(h, /Mate/).click())
    expect(useSupplements.getState().logs.filter(l => l.source === 'mate')).toHaveLength(2)
    expect(btn(h, /Mate/).textContent).toContain('×2')
    expect(h.textContent).toContain(`≈ ${MATE * 2} mg`)
    expect(h.textContent).toContain('por ½ termo')
  })
  it('"Eliminar último consumo" borra el último', async () => {
    useSupplements.setState({ logs: [
      { id: 'a', source: 'cafe', date: TODAY, amount: 90, createdAt: '2026-10-09T11:00:00Z' },
      { id: 'b', source: 'mate', date: TODAY, amount: MATE, createdAt: '2026-10-09T14:40:00Z' }] })
    const h = await render()
    await act(async () => btn(h, /Eliminar último consumo/).click())
    expect(useSupplements.getState().logs.map(l => l.id)).toEqual(['a'])
  })
  it('lista de hoy con "Eliminar" en cada uno y consejos del mate', async () => {
    useSupplements.setState({ logs: [{ id: 'a', source: 'cafe', date: TODAY, amount: 90, createdAt: '2026-10-09T11:00:00Z' }] })
    const h = await render()
    expect(h.textContent).toContain('Consumos de hoy')
    expect([...h.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Eliminar')).toHaveLength(1)
    expect(h.textContent).toContain('no deshidrata')
  })
})
