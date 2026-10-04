// @vitest-environment happy-dom
// Ficha del socio → Clases: el último mes, la penalización (y levantarla), las próximas reservas
// (y cancelarlas) y los días fijos; sin nada, el texto de vacío.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { useUI } = await import('../../../store/useUI.js')
const { setLang } = await import('../../../lib/i18n.js')
const { default: ClassesMemberCard } = await import('./ClassesCard.jsx')

const card = extra => ({
  month: { present: 9, absent: 3, late: 1, rate: 75 },
  penalty: { count: 3, until: '2026-10-12' },
  upcoming: Array.from({ length: 6 }, (_, i) => ({ bookingId: 'b' + i, name: i ? 'GAP' : 'Spinning', color: '#ff9f0a', date: '2026-10-05', start: '19:00', status: i === 1 ? 'waitlist' : 'booked', waitlistPos: i === 1 ? 2 : null })),
  fixed: [{ slotId: 's1', name: 'Spinning', color: '#ff9f0a', weekday: 1, start: '19:00' }],
  canCancel: true, canReset: true, ...extra
})

let container, root
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
const mount = async () => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<ClassesMemberCard userId="ana" userName="Ana" />) })
  for (let i = 0; i < 3; i++) await tick()
}
const button = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
async function confirmLast() {
  // confirmSheet llega por un import dinámico: se espera a que la hoja esté.
  for (let i = 0; i < 50 && !useUI.getState().sheets.length; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => { r.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))) })
  return { host, unmount: async () => { await act(async () => r.unmount()); host.remove() } }
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockReset()
  useUI.setState({ sheets: [], toastMsg: '' })
})
afterEach(async () => { await act(async () => { root.unmount() }); container.remove() })

describe('ficha del socio → Clases', () => {
  it('el último mes, la penalización, las próximas (5 y "Ver todas") y las fijas', async () => {
    apiMock.mockResolvedValue(card())
    await mount()
    expect(apiMock).toHaveBeenCalledWith('/api/admin/classes/member?userId=ana')
    expect([...container.querySelectorAll('.member-classes-tiles b')].map(b => b.textContent)).toEqual(['9', '3', '1', '75%'])
    expect(container.querySelector('.member-classes-penalty').textContent).toContain('No puede reservar hasta el Lun 12 · 3 ausencias')
    expect(container.querySelectorAll('.list .item')).toHaveLength(5)
    expect(container.textContent).toContain('En espera n.º 2')
    await act(async () => { button(container, 'Ver todas (6)').click() })
    expect(container.querySelectorAll('.list .item')).toHaveLength(6)
    expect(container.querySelector('.member-classes-fixed').textContent).toBe('Lun 19:00 Spinning')
  })

  it('cancelar una reserva (con confirmación) y levantar la penalización', async () => {
    apiMock.mockImplementation(url => url.startsWith('/api/admin/classes/member?') ? Promise.resolve(card()) : Promise.resolve({ ok: true }))
    await mount()
    await act(async () => { container.querySelector('.member-classes-cancel').click() })
    await tick()
    let sheet = await confirmLast()
    await act(async () => { button(sheet.host, 'Cancelar el lugar').click() })
    await tick()
    expect(apiMock).toHaveBeenCalledWith('/api/admin/classes/member/cancel', { method: 'POST', body: JSON.stringify({ bookingId: 'b0' }) })
    await sheet.unmount()
    useUI.setState({ sheets: [] })
    await act(async () => { button(container, 'Levantar penalización').click() })
    await tick()
    sheet = await confirmLast()
    await act(async () => { button(sheet.host, 'Levantar').click() })
    await tick()
    expect(apiMock).toHaveBeenCalledWith('/api/admin/classes/member/penalty-reset', { method: 'POST', body: JSON.stringify({ userId: 'ana' }) })
    await sheet.unmount()
  })

  it('sin permisos para cancelar ni levantar: no aparecen los botones', async () => {
    apiMock.mockResolvedValue(card({ canCancel: false, canReset: false }))
    await mount()
    expect(container.querySelector('.member-classes-cancel')).toBeNull()
    expect(button(container, 'Levantar penalización')).toBeFalsy()
  })

  it('sin clases: el texto de vacío', async () => {
    apiMock.mockResolvedValue(card({ month: { present: 0, absent: 0, late: 0, rate: null }, penalty: null, upcoming: [], fixed: [] }))
    await mount()
    expect(container.textContent).toContain('Todavía no fue a ninguna clase.')
  })
})
