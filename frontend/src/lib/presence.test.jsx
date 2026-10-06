// @vitest-environment happy-dom
// Presence used to be tied to the workout screen: leaving it mid-session told the server the
// member had stopped training (audit M3).
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const api = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
vi.mock('./api.js', () => ({ api, IS_APPLE: false, IS_ANDROID: false, BIO: 'biometrics' }))

const { useStore } = await import('../store/useStore.js')
const { useWorkoutPresence, presencePayload } = await import('./presence.js')

const sent = () => api.mock.calls.map(([, opts]) => JSON.parse(opts.body).active)
const session = id => ({ id, d: '2026-10-06', start: 1000, name: 'Push', cur: 0, entries: [{ id: 'bench', sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: false }] }] })

function Probe({ signedIn }) {
  const activeId = useStore(s => s.S.active?.id)
  useWorkoutPresence(signedIn, activeId)
  return null
}

let root
async function render(signedIn = true) {
  root = createRoot(document.createElement('div'))
  await act(async () => { root.render(React.createElement(Probe, { signedIn })) })
}
const setActive = async active => { await act(async () => { useStore.setState(s => ({ S: { ...s.S, active } })) }) }

describe('useWorkoutPresence', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    api.mockClear()
    useStore.setState(s => ({ S: { ...s.S, active: session('w1') } }))
  })
  afterEach(async () => { await act(async () => { root?.unmount() }); root = null })

  it('pings while a session exists, and says goodbye only when the session ends', async () => {
    await render()
    expect(sent()).toEqual([true])
    await setActive(null)
    expect(sent()).toEqual([true, false])
  })

  it('does not say goodbye when the app shell unmounts with the session still running', async () => {
    await render()
    await act(async () => { root.unmount() }); root = null
    expect(sent()).toEqual([true])
  })

  it('sends nothing for guests', async () => {
    await render(false)
    expect(api).not.toHaveBeenCalled()
  })

  it('reports progress by superset unit', () => {
    expect(presencePayload(session('w1'))).toEqual({
      active: true, name: 'Push', exIdx: 1, exTotal: 1, setsDone: 1, setsTotal: 2, startedAt: 1000,
    })
  })
})
