const DB_NAME = 'lauyim-sync-v1'
const STORE = 'operations'
const FALLBACK_KEY = 'gym_sync_queue_v1'

const openDb = () => new Promise((resolve, reject) => {
  if (!('indexedDB' in window)) return reject(new Error('indexeddb unavailable'))
  const req = indexedDB.open(DB_NAME, 1)
  req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error || new Error('indexeddb unavailable'))
})

const fallbackRead = () => { try { return JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]') } catch { return [] } }
const fallbackWrite = rows => localStorage.setItem(FALLBACK_KEY, JSON.stringify(rows))

export async function enqueueSync(userId, changes, baseTs = null) {
  if (!changes.length) return null
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const row = { id, userId: String(userId), changes, baseTs: baseTs == null ? null : Number(baseTs), createdAt: Date.now(), attempts: 0, nextAttemptAt: 0 }
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(row); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
  } catch { const rows = fallbackRead(); rows.push(row); fallbackWrite(rows) }
  return id
}

export async function enqueueRequest(userId, request) {
  const opId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const id = await enqueueSync(userId, [{ request: { ...request, opId } }])
  return { id, opId }
}

const matchesRequest = (row, predicate) => {
  const request = row?.changes?.find(change => change?.request)?.request
  return Boolean(request && predicate(request, row))
}

export async function updatePendingRequest(userId, predicate, update) {
  const mutate = row => {
    if (!matchesRequest(row, predicate)) return row
    const changes = row.changes.map(change => change?.request ? { request: update(change.request, row) } : change)
    return { ...row, changes }
  }
  try {
    const db = await openDb()
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly'); const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error)
    })
    const matches = rows.filter(row => row.userId === String(userId) && matchesRequest(row, predicate))
    if (!matches.length) return false
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'); const store = tx.objectStore(STORE)
      matches.map(mutate).forEach(row => store.put(row))
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
    })
    return true
  } catch {
    const rows = fallbackRead(); let changed = false
    const next = rows.map(row => {
      if (row.userId !== String(userId) || !matchesRequest(row, predicate)) return row
      changed = true; return mutate(row)
    })
    if (changed) fallbackWrite(next)
    return changed
  }
}

export async function cancelPendingRequest(userId, predicate) {
  try {
    const db = await openDb()
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly'); const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error)
    })
    const matches = rows.filter(row => row.userId === String(userId) && matchesRequest(row, predicate))
    if (!matches.length) return false
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'); const store = tx.objectStore(STORE)
      matches.forEach(row => store.delete(row.id))
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
    })
    return true
  } catch {
    const rows = fallbackRead(); const next = rows.filter(row => row.userId !== String(userId) || !matchesRequest(row, predicate))
    const changed = next.length !== rows.length
    if (changed) fallbackWrite(next)
    return changed
  }
}

export async function takeSyncBatch(userId, limit = 25) {
  const now = Date.now()
  try {
    const db = await openDb()
    const rows = await new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readonly'); const req = tx.objectStore(STORE).getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
    return rows.filter(r => r.userId === String(userId) && (r.nextAttemptAt || 0) <= now).sort((a, b) => a.createdAt - b.createdAt).slice(0, limit)
  } catch { return fallbackRead().filter(r => r.userId === String(userId) && (r.nextAttemptAt || 0) <= now).sort((a, b) => a.createdAt - b.createdAt).slice(0, limit) }
}

export async function countSync(userId) {
  try {
    const db = await openDb()
    const rows = await new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readonly'); const req = tx.objectStore(STORE).getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
    return rows.filter(row => row.userId === String(userId)).length
  } catch { return fallbackRead().filter(row => row.userId === String(userId)).length }
}

export async function removeSync(ids) {
  if (!ids.length) return
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); const s = tx.objectStore(STORE); ids.forEach(id => s.delete(id)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
  } catch { const gone = new Set(ids); fallbackWrite(fallbackRead().filter(r => !gone.has(r.id))) }
}

export async function deferSync(rows) {
  if (!rows.length) return
  const updated = rows.map(row => ({ ...row, attempts: (row.attempts || 0) + 1, nextAttemptAt: Date.now() + Math.min(15 * 60 * 1000, 1000 * 2 ** Math.min(row.attempts || 0, 9)) + Math.random() * 1000 }))
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); const s = tx.objectStore(STORE); updated.forEach(row => s.put(row)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
  } catch { const byId = new Map(updated.map(row => [row.id, row])); fallbackWrite(fallbackRead().map(row => byId.get(row.id) || row)) }
}

export function applySyncMappings(results = []) {
  const mappings = results.flatMap(item => {
    const pairs = []
    if (item.result?.tempId && item.result?.id) pairs.push([item.result.tempId, item.result.id])
    if (item.result?.tempGroupId && item.result?.grupo_id) pairs.push([item.result.tempGroupId, item.result.grupo_id])
    return pairs
  })
  if (!mappings.length) return
  const replace = value => {
    if (typeof value === 'string') return mappings.reduce((v, [from, to]) => v === from ? String(to) : v, value)
    if (Array.isArray(value)) return value.map(replace)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)]))
    return value
  }
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !/^gym_(nutrition|food|state|config)/.test(key)) continue
    try { const raw = localStorage.getItem(key); if (raw) localStorage.setItem(key, JSON.stringify(replace(JSON.parse(raw)))) } catch {}
  }
}

export function diffState(before, after) {
  const changes = []
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  keys.forEach(key => {
    if (key === 'active' || key === '_ts') return
    const oldValue = before?.[key]
    const newValue = after?.[key]
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push(newValue === undefined ? { path: [key], op: 'remove' } : { path: [key], op: 'replace', value: newValue })
    }
  })
  return changes
}
