// @vitest-environment node
// La racha de punta a punta: el store sella el objetivo de la semana en cada entreno nuevo y ese
// objetivo viaja por la sincronización (api/sync.js, SQLite de api/database.js) al otro dispositivo,
// así cambiar el plan en uno no cambia lo que pide una semana ya empezada.
import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Window } from 'happy-dom'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-streak-sync-'))
const win = new Window({ url: 'http://localhost/' })
for (const key of ['window', 'document', 'localStorage', 'navigator', 'CustomEvent']) Object.defineProperty(globalThis, key, { value: key === 'window' ? win : win[key], configurable: true, writable: true })
const server = await import('../../../api/database.js')
const { processSyncBatch } = await import('../../../api/sync.js')
const { applyStatePut } = await import('../../../api/data-put.js')
const { evalWeek, streakWeeks } = await import('../lib/history.js')

const USER = 'u-streak'
const clone = o => JSON.parse(JSON.stringify(o))
const save = (uid, st) => server.saveUserState(uid, st, { preserveExtras: false })
const serverApi = async (url, opts = {}) => {
  const method = opts.method || 'GET'
  const body = opts.body ? JSON.parse(opts.body) : {}
  const db = server.getDatabase()
  if (url === '/api/data/sync' && method === 'POST') return clone(processSyncBatch({ db, userId: USER, operations: body.operations, getUserState: server.getUserState, saveUserState: save }))
  if (url === '/api/data' && method === 'GET') return clone({ state: server.getUserState(USER) })
  if (url === '/api/data' && method === 'PUT') return clone(applyStatePut({ db, userId: USER, state: body.state, getUserState: server.getUserState, saveUserState: save }).body)
  if (url === '/api/nutrition/goals') return { goals: null }
  throw new Error(`unexpected ${method} ${url}`)
}
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: (...args) => serverApi(...args) }))

const devices = {}
const onDevice = async (name, fn) => {
  localStorage.clear()
  for (const [k, v] of Object.entries(devices[name] || {})) localStorage.setItem(k, v)
  const out = await fn()
  devices[name] = Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))
  return out
}
const queued = () => new Promise(r => setTimeout(r, 20))
const bootDevice = async () => {
  vi.resetModules()
  const { useStore } = await import('./useStore.js')
  useStore.setState({ user: { id: USER } })
  await useStore.getState().syncPending()
  await useStore.getState().pullState()
  return useStore
}
const logWorkout = async (store, id, d) => {
  store.getState().update(s => { s.workouts.push({ id, d, start: Date.parse(d + 'T18:00:00'), end: Date.parse(d + 'T19:00:00'), name: 'Piernas', routineId: 'a', entries: [] }) })
  await queued()
  await store.getState().syncPending()
}

const ROUTINES = [{ id: 'a', name: 'Piernas', ex: [] }]
const PLAN3 = { 1: 'a', 3: 'a', 5: 'a' }
const PLAN5 = { 1: 'a', 2: 'a', 3: 'a', 4: 'a', 5: 'a' }
const MONDAY = new Date('2026-10-05T12:00:00')

describe('racha entre dispositivos', () => {
  beforeAll(() => {
    server.initDatabase()
    server.getDatabase().prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(USER, 'Ana')
  })
  beforeEach(() => {
    for (const k of Object.keys(devices)) delete devices[k]
    server.saveUserState(USER, { unit: 'kg', routines: clone(ROUTINES), week: clone(PLAN3), dayPlan: {}, workouts: [] })
  })

  it('cuenta nueva sin rutinas ni entrenos: racha 0', async () => {
    server.saveUserState(USER, { unit: 'kg', routines: [], week: {}, dayPlan: {}, workouts: [] })
    const S = await onDevice('phone', async () => (await bootDevice()).getState().S)
    expect(S.workouts).toEqual([])
    expect(streakWeeks(S, new Date('2026-10-07T12:00:00'))).toBe(0)
  })

  it('el objetivo sellado viaja al otro dispositivo y no cambia con el plan nuevo', async () => {
    await onDevice('phone', async () => logWorkout(await bootDevice(), 'w1', '2026-10-05'))
    expect(server.getUserState(USER).workouts.find(w => w.id === 'w1').weekTarget).toBe(3)

    // En la compu cambia el plan a 5 días y entrena el miércoles y el viernes de esa misma semana.
    await onDevice('computer', async () => {
      const store = await bootDevice()
      expect(store.getState().S.workouts.find(w => w.id === 'w1').weekTarget).toBe(3)
      store.getState().update(s => { s.week = clone(PLAN5) })
      await logWorkout(store, 'w2', '2026-10-07')
      await logWorkout(store, 'w3', '2026-10-09')
    })

    const S = await onDevice('phone', async () => (await bootDevice()).getState().S)
    expect(S.week).toEqual(PLAN5)
    expect(S.workouts.map(w => [w.id, w.weekTarget])).toEqual([['w1', 3], ['w2', 3], ['w3', 3]])
    expect(evalWeek(S, MONDAY)).toMatchObject({ rutinasCompletadas: 3, objetivoSemanal: 3, completa: true })
    expect(streakWeeks(S, new Date('2026-10-09T20:00:00'))).toBe(1)
  })
})
