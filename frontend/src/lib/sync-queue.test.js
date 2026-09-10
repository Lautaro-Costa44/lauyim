import { describe, expect, it } from 'vitest'
import { applySyncMappings, countSync, diffState, enqueueSync, removeSync } from './sync-queue.js'

describe('offline sync patches', () => {
  it('updates the pending count when an operation is queued and removed', async () => {
    localStorage.removeItem('gym_sync_queue_v1')
    const events = []
    const onChange = () => events.push(true)
    window.addEventListener('gym:sync_queue_changed', onChange)
    const id = await enqueueSync('queue-test', [{ path: ['theme'], op: 'replace', value: 'light' }])
    expect(await countSync('queue-test')).toBe(1)
    await removeSync([id])
    expect(await countSync('queue-test')).toBe(0)
    expect(events.length).toBeGreaterThanOrEqual(2)
    window.removeEventListener('gym:sync_queue_changed', onChange)
  })

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
