// @vitest-environment happy-dom
// useStore pulls in api.js, which reads navigator.userAgent at module scope.
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { lastBW } from '../lib/history.js'

const apiMock = vi.hoisted(() => vi.fn())
const queueMock = vi.hoisted(() => ({ enqueueSync: vi.fn(), countSync: vi.fn() }))

vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
vi.mock('../lib/sync-queue.js', async importOriginal => ({
  ...(await importOriginal()),
  enqueueSync: queueMock.enqueueSync,
  countSync: queueMock.countSync,
}))

const { useStore, DEF } = await import('./useStore.js')

// The server sends bodyweight oldest-first, but a response a previous build cached offline can
// still arrive newest-first. Every reader assumes ascending, so hydration re-sorts.
const DESC = [
  { d: '2026-01-22', w: 82, t: Date.UTC(2026, 0, 22) },
  { d: '2026-01-15', w: 84, t: Date.UTC(2026, 0, 15) },
  { d: '2026-01-08', w: 86, t: Date.UTC(2026, 0, 8) },
]

describe('pullState bodyweight order', () => {
  beforeEach(() => {
    apiMock.mockReset()
    queueMock.enqueueSync.mockReset().mockResolvedValue(undefined)
    queueMock.countSync.mockReset().mockResolvedValue(0)
    localStorage.clear()
    useStore.setState({ user: { id: 'u1' }, S: { ...structuredClone(DEF), _ts: 1 } })
  })

  it('hydrates a newest-first payload ascending so lastBW is the most recent weigh-in', async () => {
    apiMock.mockResolvedValue({ state: { _ts: 2, bodyweight: DESC } })

    await useStore.getState().pullState()

    const S = useStore.getState().S
    expect(S.bodyweight.map(entry => entry.d)).toEqual(['2026-01-08', '2026-01-15', '2026-01-22'])
    expect(lastBW(S)).toEqual(DESC[0])
    // Home reads the entry before the last one as the previous weigh-in
    expect(S.bodyweight.at(-2).d).toBe('2026-01-15')
  })

  it('sorts by date when an older payload carries no t stamp', async () => {
    const noStamp = [{ d: '2026-01-22', w: 82 }, { d: '2026-01-08', w: 86 }]
    apiMock.mockResolvedValue({ state: { _ts: 2, bodyweight: noStamp } })

    await useStore.getState().pullState()

    expect(useStore.getState().S.bodyweight.map(entry => entry.d)).toEqual(['2026-01-08', '2026-01-22'])
  })

  it('leaves the payload the caller passed in untouched', async () => {
    const payload = DESC.map(entry => ({ ...entry }))
    apiMock.mockResolvedValue({ state: { _ts: 2, bodyweight: payload } })

    await useStore.getState().pullState()

    expect(payload.map(entry => entry.d)).toEqual(['2026-01-22', '2026-01-15', '2026-01-08'])
  })

  it('does not push, sync, or restamp just because it reordered the list', async () => {
    apiMock.mockResolvedValue({ state: { _ts: 2, bodyweight: DESC } })

    await useStore.getState().pullState()

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock).toHaveBeenCalledWith('/api/data')
    expect(queueMock.enqueueSync).not.toHaveBeenCalled()
    expect(useStore.getState().S._ts).toBe(2)
  })

  it('keeps a server list that already arrived ascending in place', async () => {
    const asc = [...DESC].reverse()
    apiMock.mockResolvedValue({ state: { _ts: 2, bodyweight: asc } })

    await useStore.getState().pullState()

    expect(useStore.getState().S.bodyweight).toEqual(asc)
    expect(queueMock.enqueueSync).not.toHaveBeenCalled()
  })
})
