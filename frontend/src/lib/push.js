// Web Push subscribe/unsubscribe — requires a signed-in profile (subscriptions are stored
// server-side per user, same as everything else under /api).
import { api } from './api.js'

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const pushPermission = () => (pushSupported() ? Notification.permission : 'unsupported')

// Los avisos cambiaron (se activaron, se apagaron, se resuscribió): quien muestra el estado
// (usePushStatus) lo vuelve a leer.
export const PUSH_CHANGED = 'lauyim:push-changed'
const changed = () => { try { window.dispatchEvent(new Event(PUSH_CHANGED)) } catch { /* sin window */ } }

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribe(reg) {
  const { key } = await api('/api/push/public-key')
  const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
  await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) })
}

// Desde un toque del usuario: el navegador solo muestra el permiso así. Los errores son frases
// para el toast (errorText las pasa tal cual).
export async function enablePush() {
  if (!pushSupported()) throw new Error('Este navegador no permite avisos.')
  const perm = await Notification.requestPermission()
  if (perm === 'denied') throw Object.assign(new Error('Bloqueaste los avisos en este navegador.'), { denied: true })
  if (perm !== 'granted') throw new Error('No se activaron los avisos.')
  await subscribe(await navigator.serviceWorker.ready)
  changed()
}

export async function disablePush() {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await sub.unsubscribe()
  await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {})
  changed()
}

export const sendTestPush = () => api('/api/push/test', { method: 'POST', body: '{}' })

// Al abrir la app con sesión y el permiso ya dado: si el navegador perdió la suscripción (la
// borró, se reinstaló el service worker) se vuelve a crear sola, sin preguntar nada; si está, se
// le vuelve a mandar al servidor una vez por día (por si allá se borró). Sin esto los avisos
// dejaban de llegar y nadie se enteraba. Nunca pide el permiso ni lanza.
const syncKey = uid => 'gym_push_sync:' + uid
export async function syncPush(uid, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!uid || !pushSupported() || Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg?.pushManager) return
    const sub = await reg.pushManager.getSubscription()
    if (!sub) { await subscribe(reg); changed() }
    else {
      if (localStorage.getItem(syncKey(uid)) === today) return
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) })
    }
    localStorage.setItem(syncKey(uid), today)
  } catch { /* sin conexión o sin storage: se reintenta la próxima vez */ }
}
