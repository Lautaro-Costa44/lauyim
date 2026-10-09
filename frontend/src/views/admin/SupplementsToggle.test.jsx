// @vitest-environment happy-dom
// Interruptor de suplementos del owner (Admin → Acceso): lee el estado y apagarlo pide confirmación.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
const { useUI } = await import('../../store/useUI.js')
const { setLang } = await import('../../lib/i18n.js')
const { SupplementsToggleCard } = await import('./Acceso.jsx')

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
beforeEach(async () => {
  await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  apiMock.mockReset()
  apiMock.mockImplementation((url, opts) => Promise.resolve(opts?.method === 'PUT' ? JSON.parse(opts.body) : { enabled: true }))
})

describe('interruptor de suplementos', () => {
  it('muestra el estado y apagarlo pide confirmación', async () => {
    const c = document.createElement('div'); document.body.appendChild(c)
    const r = createRoot(c)
    await act(async () => r.render(<SupplementsToggleCard />)); await tick()
    expect(c.textContent).toContain('Guía y seguimiento de suplementos')
    await act(async () => c.querySelector('[role="switch"]').click())
    expect(apiMock).not.toHaveBeenCalledWith('/api/owner/supplements', expect.objectContaining({ method: 'PUT' }))
    const sheet = useUI.getState().sheets.at(-1)
    const host = document.createElement('div'); const r2 = createRoot(host)
    await act(async () => r2.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Desactivar')).click()); await tick()
    expect(apiMock).toHaveBeenCalledWith('/api/owner/supplements', { method: 'PUT', body: JSON.stringify({ enabled: false }) })
    expect(c.querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('false')
  })
})
