// Paso de notificaciones del primer ingreso (spec 12.6): qué ofrecer en este dispositivo y la
// marca de "ya se mostró" (por dispositivo y cuenta: las suscripciones push también lo son).
import { pushPermission, pushSupported } from './push.js'

// iPhone/iPod/iPad; iPadOS se presenta como Mac, pero con pantalla táctil.
export const isIOS = (nav = navigator) => /iPhone|iPad|iPod/.test(nav.userAgent || '')
  || (/Macintosh/.test(nav.userAgent || '') && (nav.maxTouchPoints || 0) > 1)

export const isStandalone = (win = window) => win.navigator?.standalone === true
  || !!win.matchMedia?.('(display-mode: standalone)').matches

// 'ios-install': en iOS el push web solo existe con la app en la pantalla de inicio.
// 'enable': se puede pedir el permiso. null: no hay nada que ofrecer (sin soporte, o el permiso
// ya se concedió o se negó antes).
export function notifStepKind({ ios = isIOS(), standalone = isStandalone(), supported = pushSupported(), permission = pushPermission() } = {}) {
  if (ios && !standalone) return 'ios-install'
  if (!supported || permission !== 'default') return null
  return 'enable'
}

const key = uid => 'gym_notif_step:' + uid
export function notifStepDone(uid) {
  try { return localStorage.getItem(key(uid)) === '1' } catch { return true }
}
export function markNotifStepDone(uid) {
  try { localStorage.setItem(key(uid), '1') } catch { /* storage off: igual se cierra en memoria */ }
}
