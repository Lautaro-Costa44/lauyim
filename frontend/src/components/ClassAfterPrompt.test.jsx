// @vitest-environment happy-dom
// "¿Fuiste?" y las clases que se suman al historial esperan al primer pull del servidor: antes, el
// estado que baja pisaría la clase recién sumada (y el servidor ya la daría por sumada).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { useStore } = await import('../store/useStore.js')
const { default: ClassAfterPrompt } = await import('./ClassAfterPrompt.jsx')

let container, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockReset()
  apiMock.mockResolvedValue({ ask: [], log: [] })
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => { root.unmount() }); container.remove(); useStore.setState({ config: null, user: null, pulled: false }) })

it('no busca clases pendientes hasta que terminó el primer pull', async () => {
  useStore.setState({ config: { classes_enabled: true }, user: { id: 'socio' }, pulled: false })
  await act(async () => { root.render(<ClassAfterPrompt />) })
  expect(apiMock).not.toHaveBeenCalled()
  await act(async () => { useStore.setState({ pulled: true }) })
  expect(apiMock).toHaveBeenCalledWith('/api/classes/pending')
})

it('una clase corregida a ausente se saca del historial y se avisa al servidor', async () => {
  const { checkClassesAfter } = await import('./ClassAfterPrompt.jsx')
  useStore.setState({ S: { ...useStore.getState().S, workouts: [{ id: 'cls-b1', d: '2026-10-05', kind: 'class', classBookingId: 'b1', entries: [] }, { id: 'w2', d: '2026-10-05', entries: [] }] } })
  apiMock.mockImplementation(url => url === '/api/classes/pending' ? Promise.resolve({ ask: [], log: [], unlog: ['b1'] }) : Promise.resolve({ ok: true }))
  await checkClassesAfter()
  expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['w2'])
  expect(apiMock).toHaveBeenCalledWith('/api/classes/logged', { method: 'POST', body: JSON.stringify({ bookingId: 'b1', logged: false }) })
})
