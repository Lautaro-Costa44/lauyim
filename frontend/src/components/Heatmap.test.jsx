// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
const { HeatmapGrid, default: Heatmap } = await import('./Heatmap.jsx')
const { setLang } = await import('../lib/i18n.js')
const { todayISO } = await import('../lib/format.js')

async function mount(el) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const c = document.createElement('div'); document.body.appendChild(c)
  const r = createRoot(c); await act(async () => r.render(el)); return c
}

describe('HeatmapGrid', () => {
  it('pinta el nivel de cada día y solo deja tocar los días con nivel', async () => {
    await setLang('es')
    const today = todayISO(), onDay = vi.fn()
    const c = await mount(<HeatmapGrid weeks={4} levelOf={iso => iso === today ? 3 : 0} titleOf={iso => 'día ' + iso} onDay={onDay} legend={['Menos', 'Más']} />)
    const cell = c.querySelector('.hm-c.today')
    expect(cell.className).toContain('l3')
    expect(cell.title).toBe('día ' + today)
    await act(async () => cell.click())
    expect(onDay).toHaveBeenCalledWith(today)
    expect(c.querySelector('.hm-legend').textContent).toContain('Menos')
  })
  it('Heatmap de Stats sigue igual', async () => {
    const c = await mount(<Heatmap S={{ workouts: [], unit: 'kg' }} onDay={() => {}} />)
    expect(c.querySelectorAll('.hm-col').length).toBe(53)
  })
})
