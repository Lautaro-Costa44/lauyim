// @vitest-environment happy-dom
// Real offline queue (its localStorage fallback in this environment), mocked server.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { enqueueSync, countSync } from '../lib/sync-queue.js'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { useStore } = await import('./useStore.js')

const USER = 'terminal-user'
const patch = id => [{ path: ['workouts', id], op: 'add', value: { id, d: '2026-09-10', entries: [] } }]

describe('syncPending conflict handling', () => {
  let warn
  beforeEach(() => {
    localStorage.clear()
    apiMock.mockReset()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useStore.setState({ user: { id: USER } })
  })
  afterEach(() => warn.mockRestore())

  it('drops an operation the server rejects as oversized instead of retrying it forever', async () => {
    const bad = await enqueueSync(USER, patch('w-huge'))
    const good = await enqueueSync(USER, patch('w-fine'))
    apiMock.mockResolvedValueOnce({
      results: [{ id: good, opId: good, result: { ts: 5 } }],
      appliedIds: [good],
      conflicts: [{ id: bad, opId: bad, reason: 'set_meta_too_large' }],
    })
    apiMock.mockResolvedValue({ results: [], appliedIds: [], conflicts: [] })

    await useStore.getState().syncPending()

    expect(await countSync(USER)).toBe(0)
    expect(localStorage.getItem('gym_dirty')).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      'sync: dropping operations the server will never accept',
      [expect.objectContaining({ id: bad, reason: 'set_meta_too_large' })],
    )
  })

  it('keeps retrying an ordinary conflict', async () => {
    const stale = await enqueueSync(USER, patch('w-stale'))
    apiMock.mockResolvedValueOnce({ results: [], appliedIds: [], conflicts: [{ id: stale, opId: stale, reason: 'sync_failed' }] })
    apiMock.mockResolvedValue({ results: [], appliedIds: [], conflicts: [] })

    await useStore.getState().syncPending()

    expect(await countSync(USER)).toBe(1)
    expect(localStorage.getItem('gym_dirty')).toBe('1')
    expect(warn).not.toHaveBeenCalled()
  })

  it('keeps draining the queue after a batch that held only terminal conflicts', async () => {
    const bad = await enqueueSync(USER, patch('w-huge'))
    apiMock.mockResolvedValueOnce({ results: [], appliedIds: [], conflicts: [{ id: bad, opId: bad, reason: 'workout_meta_too_large' }] })
    // an operation queued meanwhile is taken by the next round of the same sync
    apiMock.mockImplementationOnce(async (_url, { body }) => {
      const ids = JSON.parse(body).operations.map(row => row.id)
      return { results: ids.map(id => ({ id, opId: id, result: { ts: 6 } })), appliedIds: ids, conflicts: [] }
    })
    apiMock.mockResolvedValue({ results: [], appliedIds: [], conflicts: [] })
    await enqueueSync(USER, patch('w-next'))

    await useStore.getState().syncPending()

    expect(await countSync(USER)).toBe(0)
  })
})
