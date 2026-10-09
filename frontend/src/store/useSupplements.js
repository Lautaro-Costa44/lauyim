// Suplementos del socio (docs/superpowers/specs/2026-10-09-suplementos-design.md): fuera de S (el servidor
// tiene tablas propias). Caché en el dispositivo para abrir Nutrición sin esperar, y las tomas sin
// conexión van a la cola de sync (supp-log-add / supp-log-delete) como las comidas.
import { create } from 'zustand'
import { api } from '../lib/api.js'
import { enqueueRequest, shouldQueueOffline } from '../lib/sync-queue.js'
import { useStore } from './useStore.js'

const KEY = 'lauyim_supps'
const EMPTY = { loaded: false, enabled: false, ackVersion: null, profile: { ackVersion: null, adult: null }, adult: 'unknown', today: null, items: [], logs: [] }
const userId = () => useStore.getState().user?.id || null
const DATA_KEYS = ['enabled', 'ackVersion', 'profile', 'adult', 'today', 'items', 'logs']
const pick = s => Object.fromEntries(DATA_KEYS.map(k => [k, s[k]]))
function readCache() {
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && c.userId === userId() ? { ...EMPTY, ...c.data, loaded: true } : EMPTY } catch { return EMPTY }
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ userId: userId(), data: pick(useSupplements.getState()) })) } catch { /* sin storage */ } }

export const useSupplements = create(() => readCache())
export const noticeAccepted = s => !!s.ackVersion && s.profile?.ackVersion === s.ackVersion
export const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 24)
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })

export async function loadSupplements() {
  try {
    const d = await api('/api/supplements')
    useSupplements.setState({ ...pick({ ...EMPTY, ...d }), loaded: true })
    save()
  } catch (e) {
    if (e?.data?.error === 'supplements_off' || e?.data?.error === 'health_consent_required') { useSupplements.setState({ ...EMPTY, loaded: true }); save() }
    else useSupplements.setState({ loaded: true })
  }
}

export async function acceptNotice({ adult } = {}) {
  const s = useSupplements.getState()
  await post('/api/supplements/ack', adult === undefined ? { version: s.ackVersion } : { version: s.ackVersion, adult })
  useSupplements.setState({ profile: { ...s.profile, ackVersion: s.ackVersion, adult: adult === undefined ? s.profile.adult : (adult ? 1 : 0) }, adult: s.adult === 'unknown' && adult !== undefined ? (adult ? 'adult' : 'minor') : s.adult })
  save()
}

export async function saveItem(item) {
  const { item: saved } = await post('/api/supplements/items', item)
  const items = useSupplements.getState().items.filter(i => i.id !== saved.id).concat(saved)
  useSupplements.setState({ items }); save()
  return saved
}
export async function archiveItem(id, archived) {
  const { item } = await post('/api/supplements/items/archive', { id, archived })
  useSupplements.setState(s => ({ items: s.items.map(i => i.id === id ? item : i) })); save()
}
export async function deleteItem(id) {
  await post('/api/supplements/items/delete', { id })
  useSupplements.setState(s => ({ items: s.items.filter(i => i.id !== id), logs: s.logs.filter(l => l.itemId !== id) })); save()
}

export async function addLog({ itemId = null, source = null, date, amount = 0 }) {
  const log = { id: newId(), itemId, source, date, amount, comidaId: null, createdAt: new Date().toISOString() }
  useSupplements.setState(s => ({ logs: [...s.logs, log] })); save()
  const payload = { id: log.id, itemId, source, date, amount }
  try {
    const { log: saved } = await post('/api/supplements/log', payload)
    useSupplements.setState(s => ({ logs: s.logs.map(l => l.id === log.id ? saved : l) })); save()
    return saved
  } catch (e) {
    if (shouldQueueOffline(e) && userId()) { await enqueueRequest(userId(), { kind: 'supp-log-add', payload }); return log }
    useSupplements.setState(s => ({ logs: s.logs.filter(l => l.id !== log.id) })); save()
    throw e
  }
}

export async function removeLog(id) {
  const before = useSupplements.getState().logs
  useSupplements.setState({ logs: before.filter(l => l.id !== id) }); save()
  try { await post('/api/supplements/log/delete', { id }) }
  catch (e) {
    if (shouldQueueOffline(e) && userId()) { await enqueueRequest(userId(), { kind: 'supp-log-delete', payload: { id } }); return }
    if (e?.status === 404) return
    useSupplements.setState({ logs: before }); save()
    throw e
  }
}
