// @vitest-environment happy-dom
// Admin → Resumen → Cierres: la tarjeta (en curso y futuros, estado, botones según el permiso), la
// hoja de cierre (aviso a todos, correr vencimientos solo si el servidor lo ofrece) y reabrir
// (devolver los días, con permiso de cuotas).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { setLang } = await import('../../lib/i18n.js')
const { default: ClosuresCard, statusLine } = await import('./closures/ClosuresCard.jsx')
const { closureSheet, reopenClosure, whenText } = await import('./closures/ClosureSheet.jsx')

let container, root
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
const mount = async el => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<MemoryRouter>{el}</MemoryRouter>) })
  for (let i = 0; i < 4; i++) await tick()
}
const button = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
async function openLastSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => { r.render(<MemoryRouter>{sheet.render(() => useUI.getState().closeSheet(sheet.id))}</MemoryRouter>) })
  await act(async () => { await new Promise(res => setTimeout(res, 300)) })   // la vista previa espera 250 ms
  return { host, unmount: async () => { await act(async () => r.unmount()); host.remove() } }
}

const list = { today: '2026-10-09', closures: [
  { id: 'k0', from: '2026-10-03', to: '2026-10-03', reason: 'Viejo', notifyAll: false, announceAt: null, announcedAt: null, notified: 0, extendDays: 0, extended: 0 },
  { id: 'k1', from: '2026-10-12', to: '2026-10-12', reason: 'Feriado', notifyAll: true, announceAt: null, announcedAt: 123, notified: 3, extendDays: 1, extended: 48 }
] }

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockReset()
  useUI.setState({ sheets: [], toastMsg: '' })
})
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove(); root = null })

describe('tarjeta de cierres', () => {
  it('muestra solo en curso y futuros, con su estado; sin permiso, sin botones', async () => {
    useStore.setState({ user: { id: 'u', permissions: ['stats.view'] } })
    apiMock.mockImplementation(url => url === '/api/admin/closures' ? Promise.resolve(list) : Promise.resolve({}))
    await mount(<ClosuresCard />)
    expect(container.textContent).toContain('Lun 12/10')
    expect(container.textContent).not.toContain('Viejo')
    expect(container.textContent).toContain('avisado a todos · 3 con reserva avisados · vencimientos +1 día')
    expect(container.querySelector('[data-action="close-gym"]')).toBe(null)
    expect(button(container, 'Reabrir')).toBeFalsy()
  })

  it('con gym.closures: vacía lo dice, y Cerrar abre la hoja sin vencimientos si el servidor no los ofrece', async () => {
    useStore.setState({ user: { id: 'u', permissions: ['gym.closures', 'stats.view'] } })
    apiMock.mockImplementation(url => url === '/api/admin/closures' ? Promise.resolve({ today: '2026-10-09', closures: [] })
      : url.startsWith('/api/admin/closures/preview') ? Promise.resolve({ days: 1, classes: 0, booked: 0, appMembers: 112, announceAt: 0 })
      : Promise.resolve({}))
    await mount(<ClosuresCard />)
    expect(container.textContent).toContain('No hay cierres programados')
    await act(async () => { container.querySelector('[data-action="close-gym"]').click() })
    const { host, unmount } = await openLastSheet()
    expect(apiMock).toHaveBeenCalledWith('/api/admin/closures/preview?from=2026-10-10&to=2026-10-10')
    expect(host.textContent).toContain('Avisar a todos los socios')
    expect(host.textContent).toContain('112 con la app · sale ahora')
    expect(host.textContent).not.toContain('Correr los vencimientos')
    await unmount()
  })

  it('statusLine: aviso pendiente con su hora', () => {
    const at = new Date(2026, 9, 10, 8, 0).getTime()
    expect(statusLine({ notifyAll: true, announceAt: at, announcedAt: null, notified: 0, extended: 0 }, new Date(2026, 9, 9, 12).getTime())).toBe('aviso: 10/10 08:00')
    expect(statusLine({ notifyAll: true, announceAt: at, announcedAt: null, notified: 0, extended: 0 }, new Date(2026, 9, 10, 7).getTime())).toBe('aviso: hoy 08:00')
  })
})

describe('hoja de cierre', () => {
  it('manda notifyAll y extendDays cuando se prende "Correr los vencimientos"', async () => {
    useStore.setState({ user: { id: 'u', owner: true } })
    apiMock.mockImplementation((url, opts) => url.startsWith('/api/admin/closures/preview')
      ? Promise.resolve({ days: 1, classes: 0, booked: 0, appMembers: 5, announceAt: Date.now() + 86400000, extend: { members: 48, trials: 3 } })
      : url === '/api/admin/closures' && opts?.method === 'POST' ? Promise.resolve({ closure: { id: 'k9' }, notified: 0, classes: 0, extended: 48 })
      : Promise.resolve({}))
    const onChange = vi.fn()
    closureSheet({ today: '2026-10-09', onChange })
    const { host, unmount } = await openLastSheet()
    expect(host.textContent).toContain('+1 día a 48 socios al día o por vencer (y 3 en prueba)')
    await act(async () => { host.querySelector('[aria-label="Correr los vencimientos"]').click() })
    await act(async () => { host.querySelector('[data-action="confirm-closure"]').click() })
    await tick()
    const post = apiMock.mock.calls.find(([u, o]) => u === '/api/admin/closures' && o?.method === 'POST')
    expect(JSON.parse(post[1].body)).toEqual({ from: '2026-10-10', to: '2026-10-10', reason: 'Feriado', notifyAll: true, extendDays: 1 })
    expect(useUI.getState().toastMsg).toBe('Gimnasio cerrado: vencimientos corridos a 48 socios')
    expect(onChange).toHaveBeenCalled()
    await unmount()
  })

  it('whenText: ahora, hoy, mañana u otro día', () => {
    const now = new Date(2026, 9, 9, 10, 0).getTime()
    expect(whenText(now, now)).toBe('sale ahora')
    expect(whenText(new Date(2026, 9, 9, 18, 0).getTime(), now)).toBe('sale hoy a las 18:00')
    expect(whenText(new Date(2026, 9, 10, 8, 0).getTime(), now)).toBe('sale mañana a las 08:00')
    expect(whenText(new Date(2026, 9, 12, 8, 0).getTime(), now)).toBe('sale el 12/10 a las 08:00')
  })
})

describe('reabrir', () => {
  it('con permiso de cuotas ofrece devolver los días (prendido) y lo manda', async () => {
    apiMock.mockImplementation(() => Promise.resolve({ ok: true, reverted: 48 }))
    reopenClosure(list.closures[1], { canRevert: true, onChange: () => {} })
    const { host, unmount } = await openLastSheet()
    expect(host.textContent).toContain('Devolver el día corrido a 48 socios')
    await act(async () => { button(host, 'Reabrir').click() })
    expect(apiMock).toHaveBeenCalledWith('/api/admin/closures/delete', { method: 'POST', body: JSON.stringify({ id: 'k1', revert: true }) })
    expect(useUI.getState().toastMsg).toBe('Reabierto: devolvimos los días a 48 socios')
    await unmount()
  })

  it('sin permiso de cuotas no ofrece devolver y no lo pide', async () => {
    apiMock.mockImplementation(() => Promise.resolve({ ok: true, reverted: 0 }))
    reopenClosure(list.closures[1], { canRevert: false, onChange: () => {} })
    const { host, unmount } = await openLastSheet()
    expect(host.textContent).not.toContain('Devolver')
    await act(async () => { button(host, 'Reabrir').click() })
    expect(apiMock).toHaveBeenCalledWith('/api/admin/closures/delete', { method: 'POST', body: JSON.stringify({ id: 'k1', revert: false }) })
    await unmount()
  })
})
