// @vitest-environment happy-dom
// Bloqueo por cuota (Cuotas v1) en el store: el flag, su persistencia y el corte del sync
// sin deferSync. Cola real (fallback de localStorage en este entorno), servidor mockeado.
import { describe, expect, it, beforeEach, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
const deferSpy = vi.hoisted(() => vi.fn())
vi.mock('../lib/sync-queue.js', async importOriginal => {
  const real = await importOriginal()
  return { ...real, deferSync: rows => { deferSpy(rows); return real.deferSync(rows) } }
})

const { enqueueSync, countSync, takeSyncBatch } = await import('../lib/sync-queue.js')
const { useStore } = await import('./useStore.js')

const MEMBER = { id: 'm1', name: 'Socio', admin: false, owner: false }
const blockedError = () => Object.assign(new Error('membership_blocked'), { status: 403, data: { error: 'membership_blocked' } })
const patch = id => [{ path: ['workouts', id], op: 'add', value: { id, d: '2026-09-10', entries: [] } }]
const block = () => window.dispatchEvent(new CustomEvent('gym:membership_blocked'))

beforeEach(() => {
  localStorage.clear()
  apiMock.mockReset()
  deferSpy.mockClear()
  useStore.setState({ user: MEMBER, membershipBlocked: false, billing: null })
})

describe('flag membershipBlocked', () => {
  it('se prende con el evento y queda guardado para la próxima carga', async () => {
    block()
    expect(useStore.getState().membershipBlocked).toBe(true)
    expect(localStorage.getItem('gym_membership_blocked')).toBe('1')
  })

  it('nunca se prende para staff', () => {
    useStore.setState({ user: { ...MEMBER, admin: true } })
    block()
    expect(useStore.getState().membershipBlocked).toBe(false)
    expect(localStorage.getItem('gym_membership_blocked')).toBeNull()
  })

  it('solo lo apaga un /api/me con blocked: false, y ahí sincroniza en el acto', async () => {
    block()
    const opId = await enqueueSync(MEMBER.id, patch('w-offline'))
    apiMock.mockImplementation(url => {
      if (url === '/api/me') return Promise.resolve({ user: MEMBER, billing: { hasPlan: true, status: 'al_dia', dueDate: '2026-10-24', planName: 'Mensual', blocked: false } })
      if (url === '/api/data/sync') return Promise.resolve({ results: [], appliedIds: [opId], conflicts: [] })
      return Promise.resolve({})
    })

    expect(await useStore.getState().retryMembership()).toBe(true)
    expect(useStore.getState().membershipBlocked).toBe(false)
    expect(localStorage.getItem('gym_membership_blocked')).toBeNull()
    expect(useStore.getState().billing.planName).toBe('Mensual')
    expect(apiMock.mock.calls.some(([url]) => url === '/api/data/sync')).toBe(true)
    expect(await countSync(MEMBER.id)).toBe(0)
  })

  it('un /api/me que sigue bloqueado deja el flag y no sincroniza', async () => {
    apiMock.mockResolvedValue({ user: MEMBER, billing: { hasPlan: true, status: 'bloqueado', dueDate: '2026-09-01', planName: 'Mensual', blocked: true } })
    expect(await useStore.getState().retryMembership()).toBe(false)
    expect(useStore.getState().membershipBlocked).toBe(true)
    expect(apiMock.mock.calls.map(([url]) => url)).toEqual(['/api/me'])
  })
})

describe('sync bloqueado por cuota', () => {
  it('corta el ciclo sin deferSync y sin tocar la cola', async () => {
    await enqueueSync(MEMBER.id, patch('w-1'))
    apiMock.mockImplementation(url => {
      if (url === '/api/data/sync') { block(); return Promise.reject(blockedError()) }   // api.js dispara el evento y tira
      return Promise.resolve({})
    })

    await useStore.getState().syncPending()

    expect(deferSpy).not.toHaveBeenCalled()
    const [row] = await takeSyncBatch(MEMBER.id)
    expect(row.attempts).toBe(0)
    expect(row.nextAttemptAt).toBe(0)
    expect(await countSync(MEMBER.id)).toBe(1)
    expect(localStorage.getItem('gym_dirty')).toBe('1')
    expect(useStore.getState().membershipBlocked).toBe(true)

    // Mientras sigue bloqueado ni siquiera se intenta.
    apiMock.mockClear()
    await useStore.getState().syncPending()
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('cualquier otro error sigue usando deferSync (control)', async () => {
    await enqueueSync(MEMBER.id, patch('w-2'))
    apiMock.mockRejectedValue(Object.assign(new Error('HTTP 500'), { status: 500, data: {} }))
    await useStore.getState().syncPending()
    expect(deferSpy).toHaveBeenCalledTimes(1)
  })
})

// Último a propósito: el store recargado también escucha el evento en window y ensuciaría
// a los tests que vinieran después.
describe('persistencia', () => {
  it('un store nuevo ("recargar") arranca con el flag guardado', async () => {
    block()
    vi.resetModules()
    const fresh = await import('./useStore.js')
    expect(fresh.useStore.getState().membershipBlocked).toBe(true)
  })
})

describe('cambio de cuenta', () => {
  it('otra cuenta (o ninguna) no hereda el bloqueo guardado', () => {
    useStore.setState({ user: MEMBER, membershipBlocked: true })
    localStorage.setItem('gym_membership_blocked', '1')
    useStore.getState().setUser({ id: 'otra', name: 'Otra', admin: false })
    expect(useStore.getState().membershipBlocked).toBe(false)
    expect(localStorage.getItem('gym_membership_blocked')).toBeNull()
  })
})
