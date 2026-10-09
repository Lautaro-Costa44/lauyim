// Cuándo volver a ofrecer los avisos después del primer ingreso: en contexto (al reservar una
// clase, al quedar en espera, en el descanso) y con el cartel de Inicio. Un solo contador por
// cuenta y dispositivo para todo: cada "Ahora no" (o la ✕ del cartel) pausa 14 días y después
// de 3 no se ofrece más; queda Ajustes. El permiso del sistema sale solo desde el toque en
// "Activar": el navegador lo exige y, si se niega ahí, no hay vuelta desde la página.
import { t } from './i18n.js'
import { isIOS, isStandalone, notifStepDoneAt } from './notif-step.js'
import { pushSupported } from './push.js'

export const ASK_SNOOZE_MS = 14 * 86400000
export const ASK_MAX = 3
export const BANNER_WAIT_MS = 3 * 86400000

const askKey = uid => 'gym_notif_ask:' + uid
// Para probar el cartel sin esperar: localStorage.setItem('gym_notif_force', '1') en la consola.
const FORCE_KEY = 'gym_notif_force'

const read = uid => {
  try {
    const v = JSON.parse(localStorage.getItem(askKey(uid)) || 'null')
    return { n: Number(v?.n) || 0, until: Number(v?.until) || 0 }
  } catch { return { n: 0, until: 0 } }
}
const forced = () => { try { return localStorage.getItem(FORCE_KEY) === '1' } catch { return false } }

export function canAsk(uid, now = Date.now()) {
  const s = read(uid)
  return s.n < ASK_MAX && now >= s.until
}

export function snoozeAsk(uid, now = Date.now()) {
  const s = read(uid)
  try { localStorage.setItem(askKey(uid), JSON.stringify({ n: s.n + 1, until: now + ASK_SNOOZE_MS })) } catch { /* sin storage */ }
}

// Estado de los avisos en este dispositivo:
// 'ios-install' iPhone/iPad sin la app instalada (Safari no tiene push web) · 'unsupported' ·
// 'denied' bloqueados (la página no puede volver a pedirlos) · 'off' sin decidir, o con permiso
// pero sin suscripción · 'on' activos.
export async function pushStatus({
  ios = isIOS(), standalone = isStandalone(), supported = pushSupported(),
  permission = supported ? Notification.permission : 'default', subscription = deviceSubscription,
} = {}) {
  if (ios && !standalone) return 'ios-install'
  if (!supported) return 'unsupported'
  if (permission === 'denied') return 'denied'
  if (permission !== 'granted') return 'off'
  return (await subscription()) ? 'on' : 'off'
}

// getRegistration y no .ready: sin service worker (dev) .ready no termina nunca.
async function deviceSubscription() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.()
    return (await reg?.pushManager?.getSubscription?.()) || null
  } catch { return null }
}

// Ofrecer en contexto (hoja al reservar, línea en el descanso): solo con el permiso sin decidir.
export function askInContext(uid, status, now = Date.now()) {
  return !!uid && status === 'off' && canAsk(uid, now)
}

// Cartel de Inicio: 'enable' | 'ios-install' | null. busy: hay otro cartel o un entreno en curso.
export function bannerKind({ uid, status, now = Date.now(), busy = false }) {
  if (!uid || busy) return null
  const kind = status === 'off' ? 'enable' : status === 'ios-install' ? 'ios-install' : null
  if (!kind) return null
  if (forced()) return kind
  if (!canAsk(uid, now)) return null
  const stepAt = notifStepDoneAt(uid)
  if (stepAt && now - stepAt < BANNER_WAIT_MS) return null
  return kind
}

// Avisos bloqueados: la página no puede volver a pedirlos; solo explicar dónde se desbloquean.
export function unblockSteps({ ua = navigator.userAgent || '', ios = isIOS(), standalone = isStandalone() } = {}) {
  if (ios) return [
    t('Abrí la app Ajustes del iPhone.'),
    t('Entrá a Notificaciones y buscá esta app.'),
    t('Activá "Permitir notificaciones" y volvé acá.'),
  ]
  if (/Android/i.test(ua)) return standalone ? [
    t('Mantené apretado el ícono de la app y tocá "Información de la app".'),
    t('Entrá a Notificaciones y activalas.'),
    t('Volvé a la app: los avisos se activan solos.'),
  ] : [
    t('Tocá el ícono que está a la izquierda de la dirección de la página.'),
    t('Entrá a Permisos → Notificaciones y elegí Permitir.'),
    t('Volvé a la app: los avisos se activan solos.'),
  ]
  if (/Firefox/i.test(ua)) return [
    t('Hacé clic en el candado a la izquierda de la dirección.'),
    t('Quitá el bloqueo de "Enviar notificaciones".'),
    t('Recargá la página.'),
  ]
  if (/Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua)) return [
    t('En Safari, abrí Ajustes → Sitios web → Notificaciones.'),
    t('Buscá esta página y elegí Permitir.'),
    t('Recargá la página.'),
  ]
  return [
    t('Hacé clic en el ícono que está a la izquierda de la dirección.'),
    t('En Notificaciones, elegí Permitir.'),
    t('Recargá la página.'),
  ]
}

// Para qué sirven, según lo que este gym y este socio usan.
export function notifReasons({ classes = false, billing = false, routine = false } = {}) {
  const out = []
  if (classes) out.push(t('recordatorios de tus clases y cambios de horario'))
  if (billing) out.push(t('antes de que venza tu cuota'))
  if (routine) out.push(t('los días que tenés entrenamiento'))
  return out.length ? out : [t('cuando termina el descanso entre series')]
}
