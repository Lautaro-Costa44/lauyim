// Fin de sesión forzado (cuenta desactivada, rechazada o eliminada, o sesión vencida).
// Solo una baja borra el dispositivo; una sesión vencida conserva la cola offline para que se
// suba cuando la misma persona vuelva a entrar. Un error de red nunca cuenta como "sin sesión".
import { SYNC_DB_NAME } from './sync-queue.js'

export const ACCOUNT_ENDED_REASONS = ['account_disabled', 'account_rejected', 'account_deleted']
export const isAccountEnded = reason => ACCOUNT_ENDED_REASONS.includes(reason)

// Caches del Service Worker que NO son el app shell (opengym-release-*, sin datos del socio: sin
// él la app no abre offline). Hoy el SW no cachea la API (network-only); si algún día lo hace,
// esa cache se va con esto.
const APP_SHELL_CACHE = 'opengym-release-'

// La suscripción push de ESTE navegador (o null). Se usa para desvincularla al cerrar sesión.
export async function deviceSubscription() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.()
    return (await reg?.pushManager?.getSubscription?.()) || null
  } catch { return null }
}

// Borra todo lo que el dispositivo guarda del socio: localStorage, sessionStorage, la cola offline
// (IndexedDB), las caches del SW que no son el app shell y la suscripción push del navegador.
export async function wipeDeviceData() {
  try { localStorage.clear() } catch { /* storage off */ }
  try { sessionStorage.clear() } catch { /* storage off */ }
  await new Promise(resolve => {
    try {
      const req = indexedDB.deleteDatabase(SYNC_DB_NAME)
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    } catch { resolve() }
  })
  try {
    const keys = await caches.keys()
    await Promise.all(keys.filter(k => !k.startsWith(APP_SHELL_CACHE)).map(k => caches.delete(k)))
  } catch { /* sin Cache API */ }
  try { await (await deviceSubscription())?.unsubscribe() } catch { /* ya no estaba */ }
}
