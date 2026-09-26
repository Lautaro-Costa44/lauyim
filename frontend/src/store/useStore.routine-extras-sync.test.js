// @vitest-environment node
// Two devices of the same account against the real server code (api/sync.js, api/data-put.js and
// SQLite from api/database.js): the phone sets a drop-set and warm-ups on a routine exercise, the
// computer starts clean — or with its older copy — and must end up with both after a pull.
import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Window } from 'happy-dom'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-extras-sync-'))
// Node environment, so Vite leaves node:sqlite (used by the server modules) to Node; the store gets
// its browser globals from a happy-dom window instead.
const win = new Window({ url: 'http://localhost/' })
for (const key of ['window', 'document', 'localStorage', 'navigator', 'CustomEvent']) Object.defineProperty(globalThis, key, { value: key === 'window' ? win : win[key], configurable: true, writable: true })
const server = await import('../../../api/database.js')
const { processSyncBatch } = await import('../../../api/sync.js')
const { applyStatePut } = await import('../../../api/data-put.js')

const USER = 'u-extras'
// The account both devices are signed in to (the server routes and the store use it).
let currentUser = USER
const clone = o => JSON.parse(JSON.stringify(o))
// What server.js does per route, for a client that sends X-Lauyim-Client: routine-extras.
const save = (uid, st) => server.saveUserState(uid, st, { preserveExtras: false })
const serverApi = async (url, opts = {}) => {
  const method = opts.method || 'GET'
  const body = opts.body ? JSON.parse(opts.body) : {}
  const db = server.getDatabase()
  if (url === '/api/data/sync' && method === 'POST') return clone(processSyncBatch({ db, userId: currentUser, operations: body.operations, getUserState: server.getUserState, saveUserState: save }))
  if (url === '/api/data' && method === 'GET') return clone({ state: server.getUserState(currentUser) })
  if (url === '/api/data' && method === 'PUT') return clone(applyStatePut({ db, userId: currentUser, state: body.state, getUserState: server.getUserState, saveUserState: save }).body)
  throw new Error(`unexpected ${method} ${url}`)
}
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: (...args) => serverApi(...args) }))

// A fresh app on a device: its own module instance of the store, over whatever localStorage holds.
const openDevice = async () => {
  vi.resetModules()
  const { useStore } = await import('./useStore.js')
  useStore.setState({ user: { id: currentUser } })
  return useStore
}
// Each device has its own storage; the test swaps it in and out around every step.
const devices = {}
const onDevice = async (name, fn) => {
  localStorage.clear()
  for (const [k, v] of Object.entries(devices[name] || {})) localStorage.setItem(k, v)
  const out = await fn()
  devices[name] = Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))
  return out
}

// update() queues its patch asynchronously; let it land before syncing.
const queued = () => new Promise(r => setTimeout(r, 20))

const ROUTINE = { id: 'r-push', name: 'Push', emoji: 'dumbbell', ex: [{ id: '0025', sets: 3, mode: 'reps', reps: 8, weight: 60 }, { id: '0047', sets: 3, mode: 'reps', reps: 10, weight: 20 }] }
// The exact payload ExConfig (sheets.jsx) hands onSave for a drop-set with two warm-ups.
const CONFIGURED = { sets: 3, mode: 'reps', reps: 8, weight: 60, warmupSets: 2, intensifier: { type: 'dropset', count: 2, pct: 80, dropRestSec: 5 } }
// And what RoutineEditor's onSave does with it (RoutineEdit passes update(s => fn(s.routines))).
const editExercise = (useStore, routineId, i, cfg) => useStore.getState().update(s => {
  const x = s.routines.find(r => r.id === routineId).ex
  x[i] = { id: x[i].id, sg: x[i].sg, ...cfg }
})

describe('routine exercise extras sync between devices', () => {
  beforeAll(() => {
    server.initDatabase()
    server.getDatabase().prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(USER, 'Ana')
    // An account that has used the app already has its state row.
    server.saveUserState(USER, { unit: 'kg', routines: [] })
  })
  beforeEach(() => { for (const k of Object.keys(devices)) delete devices[k] })

  it('phone configures drop-set + warm-ups, computer starting clean gets them', async () => {
    await onDevice('phone', async () => {
      const store = await openDevice()
      store.getState().update(s => { s.routines = [clone(ROUTINE)] })
      await queued()
      await store.getState().syncPending()
      editExercise(store, 'r-push', 0, CONFIGURED)
      await queued()
      await store.getState().syncPending()
    })
    const stored = server.getUserState(USER).routines[0].ex[0]
    expect(stored.intensifier).toEqual(CONFIGURED.intensifier)
    expect(stored.warmupSets).toBe(2)

    const computer = await onDevice('computer', async () => {
      const store = await openDevice()
      await store.getState().syncPending()
      await store.getState().pullState()
      return store.getState().S
    })
    expect(computer.routines[0].ex[0]).toMatchObject({ id: '0025', warmupSets: 2, intensifier: CONFIGURED.intensifier })
    expect(computer.routines[0].ex[1].intensifier).toBeUndefined()
  })

  it('a computer holding the older copy takes the new config and does not push its old one back', async () => {
    // Both devices start from the same plan, without extras.
    await onDevice('phone', async () => {
      const store = await openDevice()
      store.getState().update(s => { s.routines = [clone(ROUTINE)] })
      await queued()
      await store.getState().syncPending()
    })
    await onDevice('computer', async () => {
      const store = await openDevice()
      await store.getState().pullState()
      expect(store.getState().S.routines[0].ex[0].intensifier).toBeUndefined()
    })
    // The phone configures the exercise later.
    await onDevice('phone', async () => {
      const store = await openDevice()
      editExercise(store, 'r-push', 0, CONFIGURED)
      await queued()
      await store.getState().syncPending()
    })
    // The computer reloads the page: boot drains its (empty) queue, then pulls.
    const computer = await onDevice('computer', async () => {
      const store = await openDevice()
      await store.getState().syncPending()
      await store.getState().pullState()
      return store.getState().S
    })
    expect(computer.routines[0].ex[0]).toMatchObject({ warmupSets: 2, intensifier: CONFIGURED.intensifier })
    const stored = server.getUserState(USER).routines[0].ex[0]
    expect(stored).toMatchObject({ warmupSets: 2, intensifier: CONFIGURED.intensifier })
  })

  it('the same exercise twice in a routine: only the configured copy gets the drop-set', async () => {
    const twice = { ...clone(ROUTINE), ex: [ROUTINE.ex[0], ROUTINE.ex[1], { ...ROUTINE.ex[0], reps: 12, weight: 40 }] }
    await onDevice('phone', async () => {
      const store = await openDevice()
      store.getState().update(s => { s.routines = [clone(twice)] })
      await queued()
      await store.getState().syncPending()
      editExercise(store, 'r-push', 2, { ...CONFIGURED, reps: 12, weight: 40 })
      await queued()
      await store.getState().syncPending()
    })
    const computer = await onDevice('computer', async () => {
      const store = await openDevice()
      await store.getState().pullState()
      return store.getState().S
    })
    const ex = computer.routines[0].ex
    expect(ex[0].intensifier).toBeUndefined()
    expect(ex[2]).toMatchObject({ id: '0025', reps: 12, warmupSets: 2, intensifier: CONFIGURED.intensifier })
  })

  it('turning the drop-set and warm-ups off on one device clears them on the other', async () => {
    await onDevice('phone', async () => {
      const store = await openDevice()
      store.getState().update(s => { s.routines = [{ ...clone(ROUTINE), ex: [{ ...ROUTINE.ex[0], ...CONFIGURED }, ROUTINE.ex[1]] }] })
      await queued()
      await store.getState().syncPending()
      editExercise(store, 'r-push', 0, { sets: 3, mode: 'reps', reps: 8, weight: 60 })
      await queued()
      await store.getState().syncPending()
    })
    const computer = await onDevice('computer', async () => {
      const store = await openDevice()
      await store.getState().pullState()
      return store.getState().S
    })
    expect(computer.routines[0].ex[0].intensifier).toBeUndefined()
    expect(computer.routines[0].ex[0].warmupSets).toBeUndefined()
  })
})

describe('a new member without any server state yet', () => {
  const NEW = 'u-new'
  beforeAll(() => {
    currentUser = NEW
    // Signed up, never synced: users row, no user_state row.
    server.getDatabase().prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(NEW, 'Nuevo')
  })
  beforeEach(() => { for (const k of Object.keys(devices)) delete devices[k] })

  it('builds a first routine by hand (no program): the sync applies and another device gets it', async () => {
    expect(server.getUserState(NEW)).toBeNull()
    const own = { id: 'r-own', name: 'Mi rutina', emoji: 'dumbbell', ex: [{ id: '0025', sets: 3, mode: 'reps', reps: 10, weight: 40 }] }
    const pending = await onDevice('phone', async () => {
      const store = await openDevice()
      await store.getState().pullState()
      store.getState().update(s => { s.routines.push(clone(own)); s.week = { 1: 'r-own' } })
      await queued()
      await store.getState().syncPending()
      const { countSync } = await import('../lib/sync-queue.js')
      return countSync(NEW)
    })
    expect(pending).toBe(0)
    const stored = server.getUserState(NEW)
    expect(Array.isArray(stored.routines)).toBe(true)
    expect(stored.routines.map(r => r.name)).toEqual(['Mi rutina'])

    const computer = await onDevice('computer', async () => {
      const store = await openDevice()
      await store.getState().syncPending()
      await store.getState().pullState()
      return store.getState().S
    })
    expect(computer.routines.map(r => r.id)).toEqual(['r-own'])
    expect(computer.routines[0].ex[0]).toMatchObject({ id: '0025', reps: 10, weight: 40 })
    expect(computer.week).toMatchObject({ 1: 'r-own' })
  })
})
