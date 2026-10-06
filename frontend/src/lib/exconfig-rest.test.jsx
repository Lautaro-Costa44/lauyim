// @vitest-environment happy-dom
// The per-exercise rest is set in the exercise config sheet and only written when it differs
// from the default, so plans saved before it existed keep exactly their shape.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useUI } from '../store/useUI.js'
import { exConfigSheet } from '../sheets.jsx'
import { EXDB } from './exercises.js'

let root
function open(onSave, existing) {
  const ex = EXDB.find(e => e.bp !== 'cardio') || EXDB[0]
  exConfigSheet(ex, existing, onSave, null, null, null)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const restStepper = host => [...host.querySelectorAll('.stp-w')].find(w => /Rest between sets|Descanso entre series/.test(w.textContent))
const save = host => act(() => { host.querySelector('button.btn.primary').click() })

describe('exercise config: rest between sets', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    document.body.innerHTML = ''
  })
  afterEach(() => act(() => { root?.unmount() }))

  it('leaves restSec out while it follows the default', () => {
    const onSave = vi.fn()
    const host = open(onSave)
    expect(restStepper(host)).toBeTruthy()
    save(host)
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('restSec')
  })

  it('saves the rest picked with the stepper', () => {
    const onSave = vi.fn()
    const host = open(onSave, { id: 'x', sets: 3, mode: 'reps', reps: 5, weight: 60, restSec: 90 })
    act(() => { restStepper(host).querySelector('[aria-label="Increase"]').click() })
    save(host)
    expect(onSave.mock.calls[0][0].restSec).toBe(105)
  })
})
