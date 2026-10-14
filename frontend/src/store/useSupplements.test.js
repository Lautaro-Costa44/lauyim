// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
const enqueueMock = vi.hoisted(() => vi.fn(async () => ({ id: 'q', opId: 'o' })))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
vi.mock('../lib/sync-queue.js', async importOriginal => ({ ...(await importOriginal()), enqueueRequest: enqueueMock }))

const { useStore } = await import('./useStore.js')
const { useSupplements, loadSupplements, addLog, removeLog, acceptNotice, noticeAccepted } = await import('./useSupplements.js')

const server = { enabled: true, ackVersion: '2026-10-09', profile: { ackVersion: null, adult: null }, adult: 'unknown', today: '2026-10-09', items: [], logs: [] }
beforeEach(() => {
  apiMock.mockReset(); enqueueMock.mockClear(); localStorage.clear()
  useStore.setState({ user: { id: 'ana' } })
  useSupplements.setState({ loaded: false, enabled: false, ackVersion: null, profile: { ackVersion: null, adult: null }, adult: 'unknown', today: null, items: [], logs: [] })
})
afterEach(() => vi.useRealTimers())

describe('useSupplements', () => {
  it('carga del servidor y guarda en caché por usuario', async () => {
    apiMock.mockResolvedValue(server)
    await loadSupplements()
    expect(useSupplements.getState()).toMatchObject({ loaded: true, enabled: true, today: '2026-10-09' })
    expect(JSON.parse(localStorage.getItem('lauyim_supps')).userId).toBe('ana')
  })
  it('apagado: 404 supplements_off deja enabled en false', async () => {
    apiMock.mockRejectedValue(Object.assign(new Error('supplements_off'), { status: 404, data: { error: 'supplements_off' } }))
    await loadSupplements()
    expect(useSupplements.getState()).toMatchObject({ loaded: true, enabled: false })
  })
  it('aceptar el aviso lo marca como aceptado', async () => {
    useSupplements.setState({ ...server, loaded: true })
    apiMock.mockResolvedValue({ ok: true })
    await acceptNotice({ adult: true })
    expect(apiMock).toHaveBeenCalledWith('/api/supplements/ack', { method: 'POST', body: JSON.stringify({ version: '2026-10-09', adult: true }) })
    expect(noticeAccepted(useSupplements.getState())).toBe(true)
  })
  it('toma: optimista y, sin conexión, a la cola', async () => {
    useSupplements.setState({ ...server, loaded: true })
    apiMock.mockRejectedValue(Object.assign(new Error('Sin conexión'), { code: 'network_error' }))
    const log = await addLog({ source: 'mate', date: '2026-10-09', amount: 80 })
    expect(useSupplements.getState().logs.map(l => l.id)).toEqual([log.id])
    expect(enqueueMock).toHaveBeenCalledWith('ana', { kind: 'supp-log-add', payload: expect.objectContaining({ id: log.id, source: 'mate', amount: 80 }) })
    await removeLog(log.id)
    expect(useSupplements.getState().logs).toEqual([])
    expect(enqueueMock).toHaveBeenLastCalledWith('ana', { kind: 'supp-log-delete', payload: { id: log.id } })
  })
  it('otra cuenta sin recargar: no muestra los datos de la anterior mientras carga', async () => {
    useSupplements.setState({ ...server, uid: 'ana', loaded: true, items: [{ id: 'x', catalogId: 'creatina' }] })
    useStore.setState({ user: { id: 'beto' } })
    let resolve; apiMock.mockReturnValue(new Promise(r => { resolve = r }))
    const p = loadSupplements()
    expect(useSupplements.getState().items).toEqual([])
    resolve({ ...server, items: [] }); await p
    expect(useSupplements.getState().uid).toBe('beto')
  })
  it('una toma de proteína avisa a Nutrición que cambiaron las comidas', async () => {
    useSupplements.setState({ ...server, loaded: true, items: [{ id: 'prot0001', catalogId: 'proteina', dose: 30, doses: 1 }] })
    apiMock.mockImplementation((url, o) => Promise.resolve({ log: { ...JSON.parse(o.body), comidaId: 7 } }))
    const heard = vi.fn(); window.addEventListener('lauyim:meals-changed', heard)
    await addLog({ itemId: 'prot0001', date: '2026-10-09', amount: 30 })
    expect(heard).toHaveBeenCalledTimes(1)
    await addLog({ source: 'mate', date: '2026-10-09', amount: 130 })
    expect(heard).toHaveBeenCalledTimes(1)
    window.removeEventListener('lauyim:meals-changed', heard)
  })
  it('toma con error definitivo del servidor: se deshace y se avisa', async () => {
    useSupplements.setState({ ...server, loaded: true })
    apiMock.mockRejectedValue(Object.assign(new Error('Solo hoy y hasta 7 días atrás'), { status: 400, data: { error: 'Solo hoy y hasta 7 días atrás' } }))
    await expect(addLog({ itemId: 'x', date: '2026-09-01', amount: 5 })).rejects.toThrow()
    expect(useSupplements.getState().logs).toEqual([])
  })
})
