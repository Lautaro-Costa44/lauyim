// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { useSupplements } = await import('../../store/useSupplements.js')
const { setLang } = await import('../../lib/i18n.js')
const { openGuide } = await import('./GuiaSheet.jsx')

async function render(id) {
  openGuide(id)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => r.render(sheet.render(() => {}, { setOnBack: () => {} })))
  return host
}
beforeEach(async () => {
  await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  useStore.setState({ user: { id: 'ana' }, S: { ...useStore.getState().S, genero: 'masculino', bodyweight: [{ d: '2026-10-09', w: 80 }] } })
  useSupplements.setState({ loaded: true, enabled: true, adult: 'adult', items: [{ id: 'c1', catalogId: 'creatina', status: 'active', doses: 1 }], logs: [], ackVersion: 'v', profile: { ackVersion: 'v' } })
})

describe('guía', () => {
  it('lista: agua arriba, niveles y "la tomás"', async () => {
    const h = await render(null)
    expect(h.textContent.indexOf('Recordá tomar agua')).toBeLessThan(h.textContent.indexOf('Funciona'))
    expect(h.textContent).toContain('2,5 L')
    for (const l of ['Funciona', 'Evidencia en desarrollo', 'Con indicación profesional', 'No recomendado']) expect(h.textContent).toContain(l)
    expect(h.textContent).toContain('la tomás')
    expect(h.textContent).toContain('Otro suplemento')
  })
  it('ficha de creatina: cómo tomarla primero, carga, precauciones y fuentes; ya la toma', async () => {
    const t = (await render('creatina')).textContent
    expect(t.indexOf('Cómo tomarla')).toBeLessThan(t.indexOf('Qué dice la evidencia'))
    expect(t).toContain('recién empezás'); expect(t).toContain('Precauciones'); expect(t).toContain('Revisado')
    expect(t).toContain('Ya lo tomás'); expect(t).toContain('Dejar de tomar')
  })
  it('"Configurar" edita el que existe (no crea otro)', async () => {
    const h = await render('creatina')
    await act(async () => [...h.querySelectorAll('button')].find(b => b.textContent === 'Configurar').click())
    const n = useUI.getState().sheets.length
    for (let i = 0; i < 50 && useUI.getState().sheets.length === n; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    const top = document.createElement('div'); const r2 = createRoot(top)
    await act(async () => r2.render(useUI.getState().sheets.at(-1).render(() => {}, { setOnBack: () => {} })))
    expect(top.textContent).toContain('Editar')
  })
  it('cafeína: rango con el peso', async () => {
    expect((await render('cafeina')).textContent).toContain('Para tus 80 kg: 240 a 400 mg')
  })
  it('no recomendado: sin "Agregar"', async () => {
    expect((await render('quemadores')).textContent).not.toContain('Agregar a mis suplementos')
  })
  it('menor: sin dosis ni "Agregar"', async () => {
    useSupplements.setState({ adult: 'minor', items: [] })
    const t = (await render('creatina')).textContent
    expect(t).toContain('No recomendado para menores de 18'); expect(t).not.toContain('Agregar a mis suplementos')
    expect((await render(null)).textContent).not.toContain('Otro suplemento')
  })
  it('el atrás del sistema vuelve de la ficha a la lista; desde la lista, cierra', async () => {
    let back = null; const closed = vi.fn()
    openGuide(null)
    const sheet = useUI.getState().sheets.at(-1)
    const host = document.createElement('div'); document.body.appendChild(host); const r = createRoot(host)
    await act(async () => r.render(sheet.render(closed, { setOnBack: fn => { back = fn } })))
    await act(async () => [...host.querySelectorAll('.supp-item')].find(b => b.textContent.includes('Creatina')).click())
    expect(host.querySelector('.supp-ficha')).toBeTruthy()
    await act(async () => back())
    expect(host.querySelector('.supp-ficha')).toBeNull()
    expect(closed).not.toHaveBeenCalled()
    await act(async () => back())
    expect(closed).toHaveBeenCalled()
  })
})
