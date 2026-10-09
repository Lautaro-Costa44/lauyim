// @vitest-environment happy-dom
// El cartel del día cerrado (con la fecha del servidor, una vez por día, nunca en medio de un entreno)
// y el banner de Inicio (desde 7 días antes, con ✕; el día del cierre sin ✕).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { useClosures } = await import('../../store/useClosures.js')
const { setLang } = await import('../../lib/i18n.js')
const { default: ClosureNotice, shouldShowNotice } = await import('./ClosureNotice.jsx')
const { default: ClosureBanner } = await import('./ClosureBanner.jsx')

const K = { id: 'k1', from: '2026-10-12', to: '2026-10-13', reason: 'Feriado' }
let container, root
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
const mount = async el => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(el) })
  await tick(); await tick()
}

beforeEach(() => {
  setLang('es')
  localStorage.clear()
  apiMock.mockReset()
  useUI.setState({ sheets: [] })
  useClosures.setState({ today: null, closures: [] })
  useStore.setState({ user: { id: 'ana' }, pulled: true, S: { ...useStore.getState().S, active: null } })
})
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; vi.useRealTimers() })

describe('shouldShowNotice', () => {
  it('solo el día cerrado, según el today del servidor, y una vez por día', () => {
    expect(shouldShowNotice({ today: '2026-10-11', closures: [K], seen: () => false })).toBe(null)
    expect(shouldShowNotice({ today: '2026-10-12', closures: [K], seen: () => false })).toBe(K)
    expect(shouldShowNotice({ today: '2026-10-12', closures: [K], seen: key => key === 'closure-seen:k1:2026-10-12' })).toBe(null)
    expect(shouldShowNotice({ today: '2026-10-13', closures: [K], seen: key => key === 'closure-seen:k1:2026-10-12' })).toBe(K)
    expect(shouldShowNotice({ today: null, closures: [K], seen: () => false })).toBe(null)
  })
})

describe('ClosureNotice', () => {
  it('abre el cartel con el today del servidor (no el reloj) y Aceptar lo recuerda', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-20T12:00:00'), shouldAdvanceTime: true })   // el celular dice otra fecha
    apiMock.mockImplementation(url => url === '/api/closures' ? Promise.resolve({ today: '2026-10-12', closures: [K] }) : Promise.resolve({}))
    await mount(<ClosureNotice />)
    const sheets = useUI.getState().sheets
    expect(sheets).toHaveLength(1)
    expect(sheets[0].kind).toBe('center')
    const host = document.createElement('div'); document.body.appendChild(host)
    const r = createRoot(host)
    const close = vi.fn()
    await act(async () => { r.render(sheets[0].render(close)) })
    expect(host.textContent).toContain('Hoy el gimnasio está cerrado')
    expect(host.textContent).toContain('Feriado')
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Aceptar').click() })
    expect(close).toHaveBeenCalled()
    expect(localStorage.getItem('closure-seen:k1:2026-10-12')).toBe('1')
    act(() => r.unmount()); host.remove()
  })

  it('no abre nada con un entreno en curso, ni un día abierto', async () => {
    useStore.setState({ S: { ...useStore.getState().S, active: { name: 'Push' } } })
    apiMock.mockImplementation(() => Promise.resolve({ today: '2026-10-12', closures: [K] }))
    await mount(<ClosureNotice />)
    expect(useUI.getState().sheets).toHaveLength(0)
    act(() => root.unmount()); container.remove(); root = null
    useStore.setState({ S: { ...useStore.getState().S, active: null } })
    apiMock.mockImplementation(() => Promise.resolve({ today: '2026-10-11', closures: [K] }))
    await mount(<ClosureNotice />)
    expect(useUI.getState().sheets).toHaveLength(0)
  })
})

describe('ClosureBanner', () => {
  it('desde 7 días antes, con ✕ que lo oculta; el día del cierre vuelve sin ✕', async () => {
    useClosures.setState({ today: '2026-10-08', closures: [K] })
    await mount(<ClosureBanner />)
    expect(container.textContent).toContain('El gimnasio cierra del 12/10 al 13/10')
    await act(async () => { container.querySelector('button').click() })
    expect(container.querySelector('.closure-banner')).toBe(null)
    act(() => useClosures.setState({ today: '2026-10-12' }))
    expect(container.textContent).toContain('Hoy el gimnasio está cerrado')
    expect(container.querySelector('button')).toBe(null)
  })

  it('nada si falta más de una semana', async () => {
    useClosures.setState({ today: '2026-10-04', closures: [K] })
    await mount(<ClosureBanner />)
    expect(container.querySelector('.closure-banner')).toBe(null)
  })
})
