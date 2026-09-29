// Política de actualización de la app (Entrega 2.4).
//
// El Service Worker nuevo queda en `waiting` (public/sw.js ya no hace skipWaiting al instalarse)
// y se aplica solo en un momento seguro:
//   - al abrir la app, o al volver a primer plano después de ≥ 2 min en segundo plano;
//   - y solo si no hay un entrenamiento en curso, la cola de sync está vacía (se intenta vaciar
//     primero) y no hay ningún sheet abierto (proxy conservador de "formulario sin guardar").
// Aplicar = vaciar la cola, postMessage SKIP_WAITING y recargar UNA vez en controllerchange.
// Si pasan 4 h con la versión esperando, un aviso discreto ("Nueva versión disponible").
// Versión crítica: /api/config trae min_client_version; si esta build es más vieja, un modal
// bloqueante (UpdateGate) que ignora las condiciones de arriba.
// Red de seguridad: un chunk que ya no existe (vite:preloadError, import() fallido) recarga una vez.
import { create } from 'zustand'

export const HIDDEN_MIN_MS = 2 * 60 * 1000
export const CHECK_EVERY_MS = 10 * 60 * 1000
export const STALE_AFTER_MS = 4 * 60 * 60 * 1000
const RELOAD_GUARD_MS = 30 * 1000
const RELOAD_KEY = 'lauyim_update_reload_at'
const FORCED_KEY = 'lauyim_forced_update'

export const useUpdate = create(() => ({
  waiting: false,        // hay un SW nuevo esperando
  stale: false,          // esperando hace más de STALE_AFTER_MS: aviso discreto
  critical: null,        // min_client_version cuando esta build es más vieja
  criticalFailed: false, // ya se intentó actualizar a esa versión y seguimos en la vieja
}))

/** Las tres condiciones de un momento seguro. */
export function canApplyUpdate({ active, pending, sheetsOpen }) {
  return !active && !pending && !sheetsOpen
}

/** ¿`version` es anterior a `min`? Semver numérico (x.y.z); lo que no se entiende no bloquea. */
export function isOlderVersion(version, min) {
  const parse = v => (typeof v === 'string' && /^\d+(\.\d+){0,2}$/.test(v.trim()) ? v.trim().split('.').map(Number) : null)
  const a = parse(version), b = parse(min)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0, y = b[i] || 0
    if (x !== y) return x < y
  }
  return false
}

const readSession = key => { try { return sessionStorage.getItem(key) } catch { return null } }
const writeSession = (key, value) => { try { value == null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value) } catch { /* storage off */ } }

// Recarga como mucho una vez cada RELOAD_GUARD_MS: si la versión nueva también falla, no hay loop.
export function reloadOnce(reload = () => location.reload(), now = Date.now()) {
  const last = Number(readSession(RELOAD_KEY)) || 0
  if (last && now - last < RELOAD_GUARD_MS) return false
  writeSession(RELOAD_KEY, String(now))
  reload()
  return true
}

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i
export const isChunkLoadError = error => CHUNK_ERROR.test(String(error?.message || error || ''))

/**
 * @param {object} deps
 * @param {() => boolean} deps.isActive      entrenamiento en curso
 * @param {() => Promise<number>} deps.countPending  operaciones en la cola de sync
 * @param {() => Promise<void>} deps.syncPending
 * @param {() => boolean} deps.sheetsOpen
 * @param {() => Promise<object>} deps.fetchConfig   /api/config
 * @param {string} deps.version              versión de esta build (__APP_VERSION__)
 */
export function createUpdater(deps) {
  const {
    isActive, countPending, syncPending, sheetsOpen, fetchConfig, version,
    sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
    reload = () => location.reload(), now = () => Date.now(), doc = typeof document !== 'undefined' ? document : undefined,
  } = deps
  let registration = null
  let waitingWorker = null
  let waitingSince = 0
  let applying = false
  let lastCheck = 0
  let hiddenAt = 0

  const markWaiting = worker => {
    if (!worker) return
    waitingWorker = worker
    if (!waitingSince) waitingSince = now()
    useUpdate.setState({ waiting: true })
  }
  const watch = reg => {
    registration = reg
    if (reg.waiting && sw.controller) markWaiting(reg.waiting)
    reg.addEventListener?.('updatefound', () => {
      const worker = reg.installing
      worker?.addEventListener?.('statechange', () => {
        // Sin controller es la primera instalación: no hay nada que actualizar.
        if (worker.state === 'installed' && sw.controller) markWaiting(worker)
      })
    })
  }

  async function checkCritical() {
    try {
      const cfg = await fetchConfig()
      const min = cfg?.min_client_version || null
      if (min && isOlderVersion(version, min)) {
        useUpdate.setState({ critical: min, criticalFailed: readSession(FORCED_KEY) === min })
      } else {
        writeSession(FORCED_KEY, null)
        useUpdate.setState({ critical: null, criticalFailed: false })
      }
    } catch { /* sin red: se decide en el próximo chequeo */ }
  }

  async function check({ force = false } = {}) {
    if (!force && now() - lastCheck < CHECK_EVERY_MS) return
    lastCheck = now()
    try { await registration?.update() } catch { /* sin red */ }
    if (registration?.waiting && sw?.controller) markWaiting(registration.waiting)
    await checkCritical()
  }

  function apply() {
    if (!waitingWorker) return false
    applying = true
    waitingWorker.postMessage({ type: 'SKIP_WAITING' })
    // Si el navegador no avisa el cambio de controller, igual se recarga (una vez).
    setTimeout(() => { if (applying) reloadOnce(reload, now()) }, 5000)
    return true
  }

  /** Aplica si es un momento seguro. → 'applied' | 'none' | 'active' | 'pending' | 'form' */
  async function trySafeApply() {
    if (!waitingWorker) return 'none'
    if (isActive()) return 'active'
    if (sheetsOpen()) return 'form'
    if (await countPending()) {
      try { await syncPending() } catch { /* sigue pendiente */ }
      if (await countPending()) return 'pending'
    }
    return apply() ? 'applied' : 'none'
  }

  /** Botón del modal crítico: no mira las condiciones (solo intenta subir la cola antes). */
  async function forceUpdate() {
    writeSession(FORCED_KEY, useUpdate.getState().critical || '1')
    try { await syncPending() } catch { /* se intenta igual */ }
    try { await registration?.update() } catch { /* sin red */ }
    if (registration?.waiting) { markWaiting(registration.waiting); apply(); return }
    applying = true
    reload()
  }

  function tickStale() {
    if (waitingWorker && waitingSince && now() - waitingSince >= STALE_AFTER_MS) useUpdate.setState({ stale: true })
  }

  async function start() {
    if (sw) {
      sw.addEventListener('controllerchange', () => { if (applying) { applying = false; reloadOnce(reload, now()) } })
      try { watch(await sw.register('sw.js')) } catch { /* sin SW: solo el chequeo de versión crítica */ }
    }
    doc?.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'hidden') { hiddenAt = now(); return }
      const wasAwayLong = hiddenAt && now() - hiddenAt >= HIDDEN_MIN_MS
      hiddenAt = 0
      check().then(() => { tickStale(); if (wasAwayLong) trySafeApply() })
    })
    setInterval(tickStale, 5 * 60 * 1000)
  }

  /** Al abrir la app (después del boot): chequeo inmediato y, si hay versión esperando, aplicarla. */
  async function opened() {
    await check({ force: true })
    await trySafeApply()
  }

  return { start, opened, check, trySafeApply, forceUpdate, tickStale, _state: () => ({ waitingWorker, waitingSince, applying, registration }) }
}

// Red de seguridad para chunks que ya no están (deploy nuevo con la página abierta).
export function installChunkErrorReload(win = typeof window !== 'undefined' ? window : undefined, reload) {
  if (!win) return
  win.addEventListener('vite:preloadError', event => { event.preventDefault?.(); reloadOnce(reload) })
  win.addEventListener('unhandledrejection', event => { if (isChunkLoadError(event.reason)) reloadOnce(reload) })
}

let updater = null
export const setUpdater = u => { updater = u }
export const getUpdater = () => updater
