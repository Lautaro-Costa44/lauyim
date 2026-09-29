// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canApplyUpdate, createUpdater, isOlderVersion, reloadOnce, isChunkLoadError, installChunkErrorReload, useUpdate, HIDDEN_MIN_MS, STALE_AFTER_MS } from './update.js'
import { buildIdFrom } from './build-id.js'

describe('canApplyUpdate', () => {
  it('solo sin entrenamiento, sin cola y sin sheets abiertos', () => {
    expect(canApplyUpdate({ active: null, pending: 0, sheetsOpen: false })).toBe(true)
    expect(canApplyUpdate({ active: { id: 'w' }, pending: 0, sheetsOpen: false })).toBe(false)
    expect(canApplyUpdate({ active: null, pending: 2, sheetsOpen: false })).toBe(false)
    expect(canApplyUpdate({ active: null, pending: 0, sheetsOpen: true })).toBe(false)
  })
})

describe('isOlderVersion', () => {
  it.each([
    ['2.0.0', '2.0.1', true], ['2.0.0', '2.1', true], ['1.9.9', '2.0.0', true],
    ['2.0.0', '2.0.0', false], ['2.1.0', '2.0.9', false], ['2.0.0', null, false], ['2.0.0', 'x', false],
  ])('%s < %s → %s', (a, b, out) => expect(isOlderVersion(a, b)).toBe(out))
})

describe('reloadOnce', () => {
  beforeEach(() => sessionStorage.clear())
  it('recarga una vez y no vuelve a recargar dentro de la guarda', () => {
    const reload = vi.fn()
    expect(reloadOnce(reload, 1000)).toBe(true)
    expect(reloadOnce(reload, 5000)).toBe(false)
    expect(reloadOnce(reload, 1000 + 31000)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})

describe('chunks faltantes', () => {
  beforeEach(() => sessionStorage.clear())
  it('reconoce los errores de import() de cada navegador', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('otra cosa'))).toBe(false)
  })
  it('vite:preloadError recarga una sola vez', () => {
    const reload = vi.fn()
    const target = new EventTarget()
    installChunkErrorReload(target, reload)
    target.dispatchEvent(new Event('vite:preloadError'))
    target.dispatchEvent(new Event('vite:preloadError'))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

// Service Worker falso: registration con waiting/installing y controllerchange a mano.
function fakeSW({ waiting = false } = {}) {
  const swListeners = {}, regListeners = {}
  const worker = state => { const l = {}; return { state, postMessage: vi.fn(), addEventListener: (t, f) => { l[t] = f }, fire: (t) => l[t]?.() } }
  const reg = {
    waiting: waiting ? worker('installed') : null,
    installing: null,
    update: vi.fn(async () => {}),
    addEventListener: (t, f) => { regListeners[t] = f },
  }
  const sw = {
    controller: {},
    register: vi.fn(async () => reg),
    addEventListener: (t, f) => { swListeners[t] = f },
  }
  const newVersion = () => { reg.installing = worker('installing'); regListeners.updatefound(); reg.installing.state = 'installed'; reg.installing.fire('statechange'); reg.waiting = reg.installing; reg.installing = null }
  return { sw, reg, newVersion, controllerChange: () => swListeners.controllerchange?.() }
}

describe('createUpdater', () => {
  let clock, deps, fake, reload, doc, visibility
  beforeEach(() => {
    sessionStorage.clear()
    useUpdate.setState({ waiting: false, stale: false, critical: null, criticalFailed: false })
    clock = 1_000_000
    visibility = 'visible'
    const docListeners = {}
    doc = { get visibilityState() { return visibility }, addEventListener: (t, f) => { docListeners[t] = f }, fire: t => docListeners[t]?.() }
    reload = vi.fn()
    let pending = 0
    deps = {
      active: null,
      pending: () => pending,
      setPending: n => { pending = n },
      isActive: () => !!deps.active,
      countPending: async () => pending,
      syncPending: vi.fn(async () => { if (deps.syncClears) pending = 0 }),
      sheetsOpen: () => !!deps.sheets,
      fetchConfig: vi.fn(async () => ({ min_client_version: deps.min || null })),
      version: '2.0.0',
    }
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())
  const make = (opts = {}) => {
    fake = fakeSW(opts)
    return createUpdater({ ...deps, sw: fake.sw, reload, now: () => clock, doc })
  }

  it('al abrir con una versión esperando y nada pendiente: SKIP_WAITING y una recarga en controllerchange', async () => {
    const u = make({ waiting: true })
    await u.start()
    await u.opened()
    expect(fake.reg.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    fake.controllerChange()
    fake.controllerChange()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('con un entrenamiento activo no aplica; al terminar y volver tras ≥ 2 min, sí', async () => {
    deps.active = { id: 'w' }
    const u = make({ waiting: true })
    await u.start()
    await u.opened()
    expect(fake.reg.waiting.postMessage).not.toHaveBeenCalled()
    deps.active = null
    visibility = 'hidden'; doc.fire('visibilitychange')
    clock += HIDDEN_MIN_MS - 1000
    visibility = 'visible'; doc.fire('visibilitychange')
    await vi.runAllTicks(); await Promise.resolve(); await Promise.resolve()
    expect(fake.reg.waiting.postMessage).not.toHaveBeenCalled()   // menos de 2 min
    visibility = 'hidden'; doc.fire('visibilitychange')
    clock += HIDDEN_MIN_MS + 1000
    visibility = 'visible'; doc.fire('visibilitychange')
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(fake.reg.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })

  it('cola con cambios: primero intenta sincronizar; si no se vacía, posterga', async () => {
    deps.setPending(3)
    const u = make({ waiting: true })
    await u.start()
    expect(await u.trySafeApply()).toBe('pending')
    expect(deps.syncPending).toHaveBeenCalled()
    deps.syncClears = true
    expect(await u.trySafeApply()).toBe('applied')
  })

  it('un sheet abierto posterga', async () => {
    deps.sheets = true
    const u = make({ waiting: true })
    await u.start()
    expect(await u.trySafeApply()).toBe('form')
  })

  it('detecta una versión nueva instalada mientras la app está abierta (updatefound → installed)', async () => {
    const u = make()
    await u.start()
    expect(useUpdate.getState().waiting).toBe(false)
    fake.newVersion()
    expect(useUpdate.getState().waiting).toBe(true)
    expect(await u.trySafeApply()).toBe('applied')
  })

  it('primera instalación (sin controller) no cuenta como actualización', async () => {
    const u = make()
    fake.sw.controller = null
    await u.start()
    fake.newVersion()
    expect(useUpdate.getState().waiting).toBe(false)
    fake.controllerChange()
    expect(reload).not.toHaveBeenCalled()
  })

  it('registration.update() con throttle de 10 min', async () => {
    const u = make()
    await u.start()
    await u.check({ force: true })
    await u.check()
    expect(fake.reg.update).toHaveBeenCalledTimes(1)
    clock += 10 * 60 * 1000
    await u.check()
    expect(fake.reg.update).toHaveBeenCalledTimes(2)
  })

  it('aviso discreto después de 4 h esperando', async () => {
    deps.active = { id: 'w' }
    const u = make({ waiting: true })
    await u.start()
    await u.opened()
    u.tickStale()
    expect(useUpdate.getState().stale).toBe(false)
    clock += STALE_AFTER_MS
    u.tickStale()
    expect(useUpdate.getState().stale).toBe(true)
  })

  describe('versión crítica', () => {
    it('cliente más viejo que min_client_version: modal; el botón aplica aunque haya un entrenamiento', async () => {
      deps.min = '2.1.0'
      deps.active = { id: 'w' }
      const u = make({ waiting: true })
      await u.start()
      await u.opened()
      expect(useUpdate.getState().critical).toBe('2.1.0')
      await u.forceUpdate()
      expect(deps.syncPending).toHaveBeenCalled()
      expect(fake.reg.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    })

    it('sin SW esperando: recarga igual; si al volver sigue vieja, "no se pudo" en vez de loop', async () => {
      deps.min = '2.1.0'
      const u = make()
      await u.start()
      await u.opened()
      await u.forceUpdate()
      expect(reload).toHaveBeenCalledTimes(1)
      // La recarga trajo la misma build vieja.
      const again = make()
      await again.start()
      await again.opened()
      expect(useUpdate.getState()).toMatchObject({ critical: '2.1.0', criticalFailed: true })
    })

    it('versión al día o sin mínimo: nada', async () => {
      deps.min = '2.0.0'
      const u = make()
      await u.start()
      await u.opened()
      expect(useUpdate.getState().critical).toBeNull()
    })
  })
})

describe('buildIdFrom', () => {
  it('hash corto del release', () => {
    expect(buildIdFrom({ release: '2.0.0-9b6e2a8fad74' })).toBe('9b6e2a8')
    expect(buildIdFrom(null)).toBeNull()
  })
})
