// @vitest-environment happy-dom
// Body weight is asked before every workout, and the member can skip it for one session without
// turning the question off (audit plan §2.2): no weigh-in recorded, the switch untouched.
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { startFlow } from '../sheets.jsx'

let root
describe('start without weighing in', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ healthConsent: 'granted', S: { ...s.S, active: null, bodyweight: [], configuracion: {} } }))
  })
  afterEach(() => act(() => { root?.unmount() }))

  it('starts the workout with no weigh-in and leaves the ask-every-time switch on', () => {
    startFlow(null)
    const sheet = useUI.getState().sheets.at(-1)
    expect(sheet).toBeTruthy()
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))

    const skip = [...host.querySelectorAll('button')].find(b => /Start without weighing in|Empezar sin pesarse/.test(b.textContent))
    act(() => { skip.click() })

    const { S } = useStore.getState()
    expect(S.active).toBeTruthy()
    expect(S.active.bw).toBeNull()
    expect(S.bodyweight).toHaveLength(0)
    expect(S.configuracion?.pedirPesoAlEntrenar).not.toBe(false)
  })
})
