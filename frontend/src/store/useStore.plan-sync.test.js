// @vitest-environment node
// Weekly plan / day overrides across two devices against the real server code (api/sync.js,
// api/data-put.js, SQLite from api/database.js). A device whose clock is ahead used to decide by
// `_ts` alone that its copy was newer and push it whole (PUT /api/data), erasing what the other
// device had just saved. Nothing pending locally means the server is the truth.
import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Window } from 'happy-dom'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-plan-sync-'))
const win = new Window({ url: 'http://localhost/' })
for (const key of ['window', 'document', 'localStorage', 'navigator', 'CustomEvent']) Object.defineProperty(globalThis, key, { value: key === 'window' ? win : win[key], configurable: true, writable: true })
const server = await import('../../../api/database.js')
const { processSyncBatch } = await import('../../../api/sync.js')
const { applyStatePut } = await import('../../../api/data-put.js')

const USER = 'u-plan'
const clone = o => JSON.parse(JSON.stringify(o))
const save = (uid, st) => server.saveUserState(uid, st, { preserveExtras: false })
let online = true
let puts = 0
const serverApi = async (url, opts = {}) => {
  if (!online) throw new TypeError('offline')
  const method = opts.method || 'GET'
  const body = opts.body ? JSON.parse(opts.body) : {}
  const db = server.getDatabase()
  if (url === '/api/data/sync' && method === 'POST') return clone(processSyncBatch({ db, userId: USER, operations: body.operations, getUserState: server.getUserState, saveUserState: save }))
  if (url === '/api/data' && method === 'GET') return clone({ state: server.getUserState(USER) })
  if (url === '/api/data' && method === 'PUT') { puts++; return clone(applyStatePut({ db, userId: USER, state: body.state, getUserState: server.getUserState, saveUserState: save }).body) }
  if (url === '/api/nutrition/goals') return { goals: null }
  throw new Error(`unexpected ${method} ${url}`)
}
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: (...args) => serverApi(...args) }))

const openDevice = async () => {
  vi.resetModules()
  const { useStore } = await import('./useStore.js')
  useStore.setState({ user: { id: USER } })
  return useStore
}
const devices = {}
const onDevice = async (name, fn) => {
  localStorage.clear()
  for (const [k, v] of Object.entries(devices[name] || {})) localStorage.setItem(k, v)
  const out = await fn()
  devices[name] = Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))
  return out
}
const queued = () => new Promise(r => setTimeout(r, 20))
const { countSync } = await import('../lib/sync-queue.js')

const PUSH = { id: 'r-push', name: 'Push Day', emoji: 'dumbbell', ex: [{ id: '0025', sets: 3, mode: 'reps', reps: 8, weight: 60 }] }
const MONDAY = '2026-09-28'
const REST = { fecha: MONDAY, estado: 'descanso', rutinaId: null }

describe('weekly plan across devices', () => {
  beforeAll(() => {
    server.initDatabase()
    server.getDatabase().prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(USER, 'Ana')
    server.saveUserState(USER, { unit: 'kg', routines: [] })
  })
  beforeEach(async () => {
    for (const k of Object.keys(devices)) delete devices[k]
    online = true; puts = 0
    server.saveUserState(USER, { unit: 'kg', routines: [clone(PUSH)], week: { 1: 'r-push' }, dayPlan: {} })
  })

  const bootDevice = async () => {
    const store = await openDevice()
    await store.getState().syncPending()
    await store.getState().pullState()
    return store
  }

  it('a remote change reaches a device with nothing pending', async () => {
    await onDevice('phone', bootDevice)
    await onDevice('computer', async () => {
      const store = await bootDevice()
      store.getState().update(s => { s.dayPlan[MONDAY] = clone(REST) })
      await queued()
      await store.getState().syncPending()
    })
    const phone = await onDevice('phone', async () => (await bootDevice()).getState().S)
    expect(phone.dayPlan[MONDAY]).toEqual(REST)
  })

  it('a device whose clock is ahead does not push its stale copy over the other device', async () => {
    await onDevice('phone', async () => {
      await bootDevice()
      const s = JSON.parse(localStorage.getItem('gym_state_v1'))
      s._ts = Date.now() + 3600 * 1000   // clock one hour ahead: "newer" than anything the server has
      localStorage.setItem('gym_state_v1', JSON.stringify(s))
    })
    await onDevice('computer', async () => {
      const store = await bootDevice()
      store.getState().update(s => { s.dayPlan[MONDAY] = clone(REST) })
      await queued()
      await store.getState().syncPending()
    })
    puts = 0
    const phone = await onDevice('phone', async () => (await bootDevice()).getState().S)
    expect(puts).toBe(0)
    expect(phone.dayPlan[MONDAY]).toEqual(REST)
    expect(server.getUserState(USER).dayPlan[MONDAY]).toEqual(REST)
  })

  it('a pending local change is sent first and wins over the older server copy', async () => {
    await onDevice('phone', async () => {
      await bootDevice()
      online = false
      const store = await openDevice()
      store.getState().update(s => { s.dayPlan[MONDAY] = clone(REST) })
      await queued()
      online = true
    })
    const phone = await onDevice('phone', async () => (await bootDevice()).getState().S)
    expect(phone.dayPlan[MONDAY]).toEqual(REST)
    expect(server.getUserState(USER).dayPlan[MONDAY]).toEqual(REST)
    expect(await onDevice('phone', async () => countSync(USER))).toBe(0)
  })

  it('update() marks the device dirty synchronously, before anything reaches the queue', async () => {
    await onDevice('phone', async () => {
      const store = await openDevice()
      store.getState().update(s => { s.dayPlan[MONDAY] = clone(REST) })
      expect(localStorage.getItem('gym_dirty')).toBe('1')
      await queued()
    })
  })

  it('a change made while a sync is running keeps the device dirty', async () => {
    await onDevice('phone', async () => {
      const store = await bootDevice()
      store.getState().update(s => { s.dayPlan[MONDAY] = clone(REST) })
      await queued()
      const syncing = store.getState().syncPending()
      store.getState().update(s => { s.dayPlan['2026-09-29'] = { fecha: '2026-09-29', estado: 'descanso', rutinaId: null } })
      await syncing
      await queued()
      expect(localStorage.getItem('gym_dirty')).toBe('1')
      await store.getState().syncPending()
      expect(localStorage.getItem('gym_dirty')).toBeNull()
      expect(server.getUserState(USER).dayPlan['2026-09-29']).toBeTruthy()
    })
  })

  it('editing week keeps the active group in step in the same update', async () => {
    await onDevice('phone', async () => {
      const store = await bootDevice()
      store.getState().update(s => { s.routineGroups = [{ id: 'g1', name: 'Plan', routines: clone(s.routines), week: clone(s.week) }]; s.activeGroupId = 'g1' })
      store.getState().update(s => { delete s.week[1] })
      const S = store.getState().S
      expect(S.week[1]).toBeUndefined()
      expect(S.routineGroups[0].week[1]).toBeUndefined()
    })
  })
})
