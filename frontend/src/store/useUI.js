import { create } from 'zustand'
import { uid } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { useStore } from './useStore.js'

// Fire-and-forget: lets the server push a "rest over" alert if this tab gets suspended
// before the local timer completes. No-ops for guests / offline.
const pushRestTimer = sec => { if (useStore.getState().user) api('/api/push/rest-timer', { method: 'POST', body: JSON.stringify({ seconds: sec }) }).catch(() => {}) }
const cancelPushRestTimer = () => { if (useStore.getState().user) api('/api/push/rest-timer/cancel', { method: 'POST', body: '{}' }).catch(() => {}) }

const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window
let requestRestNotificationPermissionP = null

const requestRestNotificationPermission = async () => {
  if (!notificationsSupported()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  if (!requestRestNotificationPermissionP) {
    requestRestNotificationPermissionP = Notification.requestPermission()
      .then(perm => perm === 'granted')
      .catch(() => false)
      .finally(() => {
        requestRestNotificationPermissionP = null
      })
  }
  return requestRestNotificationPermissionP
}

const maybeRestNotification = async () => {
  if (!notificationsSupported()) return
  if (!document.hidden && document.visibilityState !== 'hidden') return
  if (Notification.permission !== 'granted' && !(await requestRestNotificationPermission())) return
  try {
    // Android Chrome forbids the Notification constructor (Illegal constructor) - the
    // service-worker registration path is the one that actually pops there.
    const reg = await navigator.serviceWorker?.getRegistration?.()
    if (reg?.showNotification) {
      reg.showNotification(t('Rest over — next set!'), { body: t('Rest over — next set!') })
      return
    }
    new Notification(t('Rest over — next set!'), { body: t('Rest over — next set!') })
  } catch {
    // Intentionally ignore: notification APIs vary by browser and policy in edge cases.
  }
}

let toastTm = null
let timerInt = null
let timerTick = null
let workInt = null
let workTick = null
let workDone = null

export const useUI = create((set, get) => ({
  sheets: [],          // { id, render:(close,{setOnBack})=>JSX, kind:'sheet'|'center', locked, backGesture, onBack }
  toastMsg: '',
  timer: null,         // rest countdown between sets — { left, total, endsAt }
  work: null,          // work countdown DURING a timed set (issue #16) — { left, total, endsAt, label }

  // backGesture: opt-in para que un sheet locked igual cierre con el gesto nativo de atrás
  // (Android back / iOS swipe) — locked por sí solo sigue bloqueando swipe-to-dismiss,
  // backdrop-click y Escape, que son gestos distintos del back del sistema.
  openSheet(render, { kind = 'sheet', locked = false, fullScreen = false, backGesture = false } = {}) {
    const id = uid()
    set(s => ({ sheets: [...s.sheets, { id, render, kind, locked, fullScreen, backGesture, onBack: null }] }))
    const close = () => get().closeSheet(id)
    return { id, close, lock: v => set(s => ({ sheets: s.sheets.map(x => x.id === id ? { ...x, locked: v } : x) })) }
  },
  // Deja que un sheet intercepte el back del sistema para navegar un paso interno propio
  // (ej. un wizard de varios pasos dentro de un único sheet real) en vez de cerrarse. Evita
  // apilar un sheet real por paso — un wizard de N pasos nunca debería necesitar N entradas
  // de historial real ni un rewind de varios niveles (riesgo de exceder la profundidad real
  // de la sesión en PWA standalone y dejar la pantalla en negro sin forma de salir).
  // Re-registrar el MISMO handler no emite estado nuevo: un array nuevo despertaría a Modals,
  // que re-renderiza el sheet, que vuelve a registrar… (bucle infinito visto en producción).
  setSheetOnBack(id, fn) {
    const cur = get().sheets.find(x => x.id === id)
    if (!cur || cur.onBack === fn) return
    set(s => ({ sheets: s.sheets.map(x => x.id === id ? { ...x, onBack: fn } : x) }))
  },
  closeSheet(id) { set(s => ({ sheets: s.sheets.filter(x => x.id !== id) })) },
  // Cierra un sheet y todo lo apilado arriba de él — usado para salir completo de un flujo de
  // varios pasos (ej. wizard de asignar sugerencia) al terminar con éxito. Cierra de a UNO por
  // frame (nunca trunca el array entero de un salto): Modals.jsx hace un history.go(-1) por
  // cada cierre individual, el mismo camino ya probado por el gesto de atrás paso a paso. Un
  // solo history.go(-N) con N alto puede exceder la profundidad real de la sesión en PWA
  // standalone y dejar la pantalla en negro sin forma de salir (bug visto en producción).
  closeSheetsFrom(id) {
    const closeNext = () => {
      const sheets = get().sheets
      const idx = sheets.findIndex(x => x.id === id)
      if (idx === -1 || !sheets.length) return
      const topId = sheets[sheets.length - 1].id
      get().closeSheet(topId)
      if (topId !== id) requestAnimationFrame(closeNext)
    }
    closeNext()
  },
  closeAll() { set({ sheets: [] }) },

  toast(msg) {
    set({ toastMsg: msg })
    clearTimeout(toastTm)
    toastTm = setTimeout(() => set({ toastMsg: '' }), 2200)
  },

  startRest(sec) {
    get().stopRest()
    // Rest timer set to Off. Stopping and returning rather than starting a zero-length timer
    // keeps every caller honest: the four places that start a rest do not each need to know.
    if (!(sec > 0)) return
    const endsAt = Date.now() + sec * 1000
    set({ timer: { left: sec, total: sec, endsAt } })
    requestRestNotificationPermission()
    pushRestTimer(sec)
    timerTick = () => {
      const tm = get().timer
      if (!tm) return
      const left = Math.max(0, Math.round((tm.endsAt - Date.now()) / 1000))
      if (left === tm.left) return
      const snd = useStore.getState().S.sound
      if (left <= 0) {
        beep(snd, 880, 0.15); beep(snd, 880, 0.15, 0.25); beep(snd, 1320, 0.4, 0.5)
        if (useStore.getState().S.vibrateOnRest === true) vibrate([200]);
        maybeRestNotification(); get().toast(t('Rest over — next set!')); get().stopRest(); return
      }
      if (left <= 3) beep(snd, 660, 0.1)
      set({ timer: { ...tm, left } })
    }
    timerInt = setInterval(timerTick, 1000)
    document.addEventListener('visibilitychange', timerTick)
  },
  addRest(sec) {
    const tm = get().timer
    if (!tm) return
    const left = tm.left + sec
    // taking off more than is left means "I'm ready now" — same as skipping, and it keeps a
    // negative duration out of both the progress bar and the server-side push schedule
    if (left <= 0) { get().stopRest(); return }
    set({ timer: { ...tm, left, total: tm.total + sec, endsAt: tm.endsAt + sec * 1000 } })
    pushRestTimer(left)
  },
  stopRest() {
    if (timerInt) clearInterval(timerInt); timerInt = null
    if (timerTick) document.removeEventListener('visibilitychange', timerTick); timerTick = null
    if (get().timer) cancelPushRestTimer()
    set({ timer: null })
  },

  /* ---- work timer (issue #16) ----
     Times the set itself, not the recovery after it. Kept separate from the rest timer on
     purpose: the two mean opposite things, they must never run together, and a work set is
     something you are watching — so it gets no server push (that endpoint says "rest over",
     and a plank does not need a notification you are staring at anyway).
     `onDone(elapsedSec)` is called both when the countdown reaches zero and on an early
     finish; the elapsed time is what actually gets logged, so stopping at 0:38 of a 0:45
     hold records 0:38 rather than crediting the full target. */
  startWork(sec, label, onDone) {
    get().stopWork()
    get().stopRest()
    const total = Math.max(1, Math.round(sec) || 1)
    const endsAt = Date.now() + total * 1000
    workDone = onDone
    set({ work: { left: total, total, endsAt, label } })
    workTick = () => {
      const wk = get().work
      if (!wk) return
      const left = Math.max(0, Math.round((wk.endsAt - Date.now()) / 1000))
      if (left === wk.left) return
      const snd = useStore.getState().S.sound
      if (left <= 0) {
        beep(snd, 880, 0.15); beep(snd, 880, 0.15, 0.25); beep(snd, 1320, 0.4, 0.5)
        vibrate([200, 100, 200])
        const done = workDone
        get().stopWork()
        if (done) done(wk.total)
        return
      }
      if (left <= 3) beep(snd, 660, 0.1)
      set({ work: { ...wk, left } })
    }
    workInt = setInterval(workTick, 1000)
    document.addEventListener('visibilitychange', workTick)
  },
  // Ended the hold early — log what was actually held.
  finishWorkEarly() {
    const wk = get().work
    if (!wk) return
    const elapsed = Math.max(1, wk.total - wk.left)
    const done = workDone
    vibrate(30)
    get().stopWork()
    if (done) done(elapsed)
  },
  // Abandon without logging anything.
  stopWork() {
    if (workInt) clearInterval(workInt); workInt = null
    if (workTick) document.removeEventListener('visibilitychange', workTick); workTick = null
    workDone = null
    set({ work: null })
  }
}))
