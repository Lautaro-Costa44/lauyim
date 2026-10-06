// @vitest-environment happy-dom
// The 2-hour inactivity close used to call a function Workout.jsx never imported, so any session
// left open that long crashed the screen on every visit (audit B1), and it always claimed the
// workout was kept even when it was thrown away (B4).
import { describe, expect, it, beforeEach } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { closeStaleWorkout } from '../sheets.jsx'

const H = 3600 * 1000
const NOW = 100 * H

function setActive(active) {
  useStore.setState(s => ({ S: { ...s.S, sound: false, workouts: [], active } }))
}
const session = (sets, extra = {}) => ({
  id: 'w1', d: '2026-10-06', start: NOW - 5 * H, name: 'Push',
  entries: [{ id: 'bench', target: { mode: 'reps', reps: 5 }, sets }], ...extra,
})

describe('closeStaleWorkout', () => {
  beforeEach(() => {
    useUI.setState({ sheets: [] })
  })

  it('keeps a stale session with logged sets as a partial workout ending at its last activity', () => {
    setActive(session([{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: false }], { lastActivity: NOW - 3 * H }))
    expect(closeStaleWorkout(NOW)).toBe(true)

    const { S } = useStore.getState()
    expect(S.active).toBeNull()
    expect(S.workouts).toHaveLength(1)
    expect(S.workouts[0].partial).toBe(true)
    expect(S.workouts[0].end).toBe(NOW - 3 * H)
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('discards a stale session with nothing logged and opens a single sheet', () => {
    setActive(session([{ w: 60, r: 5, done: false }]))
    expect(closeStaleWorkout(NOW)).toBe(true)

    const { S } = useStore.getState()
    expect(S.active).toBeNull()
    expect(S.workouts).toHaveLength(0)
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('leaves a session with recent activity alone, however long ago it started', () => {
    setActive(session([{ w: 60, r: 5, done: true }], { lastActivity: NOW - H }))
    expect(closeStaleWorkout(NOW)).toBe(false)
    expect(useStore.getState().S.active).not.toBeNull()
    expect(useUI.getState().sheets).toHaveLength(0)
  })
})
