import { describe, expect, it } from 'vitest'
import { applySyncMappings, diffState } from './sync-queue.js'

describe('offline sync patches', () => {
  it('emits only changed top-level fields and never sends transient workout state', () => {
    const before = { routines: [{ id: 'r1' }], workouts: [], active: { id: 'live' }, _ts: 1 }
    const after = { routines: [{ id: 'r1' }, { id: 'r2' }], workouts: [], active: { id: 'new' }, _ts: 2 }
    expect(diffState(before, after)).toEqual([{ path: ['routines'], op: 'replace', value: after.routines }])
  })

  it('represents removed fields explicitly', () => {
    expect(diffState({ reminder: { on: true }, theme: 'dark' }, { theme: 'light' })).toEqual([
      { path: ['reminder'], op: 'remove' },
      { path: ['theme'], op: 'replace', value: 'light' },
    ])
  })

  it('reconciles temporary template and group IDs in cached nutrition data', () => {
    localStorage.setItem('gym_nutrition_templates_v1', JSON.stringify([{ id: 'offline:template', name: 'x', grupo: 'offline:group' }]))
    localStorage.setItem('gym_nutrition_cache_v1:2026-09-10', JSON.stringify([{ id: 'offline:meal', grupo_id: 'offline:group' }]))
    applySyncMappings([{ result: { tempId: 'offline:template', id: 42, tempGroupId: 'offline:group', grupo_id: 'g-server' } }])
    expect(JSON.parse(localStorage.getItem('gym_nutrition_templates_v1'))[0].id).toBe('42')
    expect(JSON.parse(localStorage.getItem('gym_nutrition_templates_v1'))[0].grupo).toBe('g-server')
    expect(JSON.parse(localStorage.getItem('gym_nutrition_cache_v1:2026-09-10'))[0].grupo_id).toBe('g-server')
  })
})
