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
const { openConfig } = await import('./ConfigSuplemento.jsx')

async function render(...args) {
  openConfig(...args)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => r.render(sheet.render(() => useUI.getState().closeSheet(sheet.id), { setOnBack: () => {} })))
  return host
}
const btn = (h, label) => [...h.querySelectorAll('button')].find(b => b.textContent.trim() === label)
beforeEach(async () => {
  await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockReset(); apiMock.mockImplementation((url, o) => Promise.resolve({ item: { ...JSON.parse(o.body), status: 'active', createdAt: '2026-10-09T00:00:00Z' } }))
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ user: { id: 'ana' }, S: { ...useStore.getState().S, bodyweight: [{ d: '2026-10-09', w: 80 }] } })
  useSupplements.setState({ loaded: true, enabled: true, adult: 'adult', items: [], logs: [] })
})

describe('alta de suplemento', () => {
  it('creatina nueva: cartel de fase de carga, 5 g sugeridos y scoop', async () => {
    const h = await render('creatina')
    expect(h.textContent).toContain('¿Recién empezás?')
    expect(h.textContent).toContain('sugerido 3–5 g')
    expect(h.textContent).toContain('Mirá la etiqueta de tu marca')
    expect(h.textContent).toContain('1 scoop =')
  })
  it('sin cartel si ya tuvo creatina', async () => {
    useSupplements.setState({ items: [{ id: 'old', catalogId: 'creatina', status: 'archived' }] })
    expect((await render('creatina')).textContent).not.toContain('¿Recién empezás?')
  })
  it('cafeína: dosis precargada con el peso', async () => {
    const h = await render('cafeina')
    expect(h.querySelector('input[name="supp-dose"]').value).toBe('240')
  })
  it('guardar manda el item y lo suma al store', async () => {
    const h = await render('creatina')
    await act(async () => btn(h, 'Agregar').click())
    expect(apiMock).toHaveBeenCalledWith('/api/supplements/items', expect.objectContaining({ method: 'POST' }))
    const sent = JSON.parse(apiMock.mock.calls[0][1].body)
    expect(sent).toMatchObject({ catalogId: 'creatina', dose: 5, unit: 'g', doses: 1, days: 'daily', reminderTimes: [] })
    expect(useSupplements.getState().items).toHaveLength(1)
  })
  it('"Cantidad por día", "Separar en dosis" y un recordatorio por dosis', async () => {
    const h = await render('betaalanina')
    expect(h.textContent).toContain('Cantidad por día'); expect(h.textContent).toContain('Separar en dosis')
    expect(h.textContent).not.toMatch(/\btomas?\b/i)
    await act(async () => h.querySelector('[role="switch"]').click())
    expect(h.querySelectorAll('input[type="time"]').length).toBe(3)
    await act(async () => btn(h, 'Agregar').click())
    expect(JSON.parse(apiMock.mock.calls.at(-1)[1].body).reminderTimes).toEqual(['09:00', '14:00', '20:00'])
  })
  it('suplemento propio: pide nombre', async () => {
    const h = await render(null)
    expect(h.querySelector('input[name="supp-name"]')).toBeTruthy()
  })
  it('indicación profesional: sin dosis sugerida', async () => {
    expect((await render('vitaminad')).textContent).toContain('La que te indicó tu profesional')
  })
})
