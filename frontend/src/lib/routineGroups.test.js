import { describe, expect, it } from 'vitest'
import { applyPlannedDays, findPlannedDayConflict } from './routineGroups.js'

const routine = (id, name, plannedDay) => ({ id, name, plannedDay })

describe('plannedDay scheduling', () => {
  it('uses plannedDay and leaves null routines out of week', () => {
    const routines = [routine('a', 'Push', 1), routine('b', 'Optional', null), routine('c', 'Legs', 5)]
    const result = applyPlannedDays(routines, {})
    expect(result.ok).toBe(true)
    expect(result.week).toEqual({ 1: 'a', 5: 'c' })
  })

  it('rejects two routines on the same day in one group', () => {
    const routines = [routine('a', 'Push', 1), routine('b', 'Chest', 1)]
    const result = applyPlannedDays(routines, {})
    expect(result.ok).toBe(false)
    expect(result.conflict.day).toBe(1)
    expect(result.conflict.existingRoutine.name).toBe('Push')
  })

  it('allows multiple routines without a planned day', () => {
    const routines = [routine('a', 'A', null), routine('b', 'B', null)]
    expect(findPlannedDayConflict(routines)).toBeNull()
    expect(applyPlannedDays(routines, {}).week).toEqual({})
  })

  it('rejects a new routine when the target day is already occupied in the group', () => {
    const existing = routine('existing', 'Push', 1)
    const result = applyPlannedDays([routine('new', 'Chest', 1)], { 1: 'existing' }, { groupRoutines: [existing] })
    expect(result.ok).toBe(false)
    expect(result.conflict.existingRoutine.name).toBe('Push')
  })

  it('does not mutate the week when validation fails', () => {
    const week = { 1: 'existing' }
    const result = applyPlannedDays([routine('new', 'Chest', 1)], week, { groupRoutines: [routine('existing', 'Push', 1)] })
    expect(result.ok).toBe(false)
    expect(week).toEqual({ 1: 'existing' })
  })
})
