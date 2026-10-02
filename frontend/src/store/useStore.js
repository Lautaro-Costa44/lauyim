import { create } from 'zustand'
import { api } from '../lib/api.js'
import { localTZ, workoutTime } from '../lib/format.js'
import { registerCustom } from '../lib/exercises.js'
import { guestAllowed } from '../lib/guest.js'
import { deviceSubscription, isAccountEnded, wipeDeviceData } from '../lib/session-end.js'
import { enqueueSync, takeSyncBatch, removeSync, deferSync, countSync, diffState, applySyncMappings } from '../lib/sync-queue.js'
import { MAX_ROUTINE_GROUPS, canAddGroup, validateGroupName, createRoutineGroup, syncActiveGroupInState, addGroupToState, removeGroupFromState } from '../lib/routineGroups.js'

const KEY = 'gym_state_v1'
export const DEF = {
  unit: 'kg', restSec: 90, restPauseSec: 15, sound: true, keepAwake: true, vibrateOnRest: false, lang: 'es',
  theme: 'dark', accent: 'lime', body: 'male', genero: 'masculino', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose (loaded state is overlaid on DEF, on every path: local,
  // server pull, backup import) still falls back to the `showRir` boolean this replaced and
  // keeps the column it had. See effortOf.
  reminder: { on: false, time: '08:00', tz: null, feeOn: false, feeInterval: 'monthly', feeDate: '' }, effort: null, autoBackup: false,
  defaultIntensifier: { type: 'none' },
  defaultSets: 3,
  // Equipment profiles (issue: filter Library/picker/routines by what you actually own —
  // e.g. "Home" vs "Gym" — building on the session-only equipment filter from issue #6).
  equipProfiles: [], activeEquipId: null, equipFilterOn: false,
  // Standing per-exercise notes, keyed by exercise id: the gym-specific facts that are true
  // every time you do the movement ("seat 4, pin 7"). Distinct from a routine's `note`, which
  // belongs to one exercise in one plan, and from a session note, which belongs to one day.
  exNotes: {},
  // Onboarding survey + routine generation (spec: motor-rutinas).
  // estadoInicial: 'pendiente' until the user picks one of the three paths in the Welcome card.
  // Null fields until the user completes the survey.
  edad: null, altura: null, objetivo: null, grasaCorporal: null,
  configuracion: { pedirPesoAlEntrenar: true },
  estadoInicial: 'pendiente',
  onboardingCompletado: false,
  onboardingStatsCompletado: false,
  onboardingNutritionCompletado: false,
  // planIniciado: the member already started a plan (had a routine, picked a program or dismissed
  // the welcome card). Only ever goes true, here and on the server, so the welcome card never
  // comes back after deleting every routine.
  planIniciado: false,
  respuestasEncuesta: null,
  rutinaGenerada: null,
  fechaUltimaEncuesta: null,
  // Routine groups for organizing routines into blocks/folders
  routineGroups: [],
  activeGroupId: null,
}
const clone = o => JSON.parse(JSON.stringify(o))

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = Object.assign(clone(DEF), JSON.parse(raw))
      syncActiveGroupInState(s)
      return s
    }
  } catch (e) { /* ignore */ }
  const s = clone(DEF)
  syncActiveGroupInState(s)
  return s
}

// El plan semanal vive en S.week y, copiado, en el grupo activo. Si solo cambia S.week, el grupo
// guarda el plan viejo y vuelve a pisarlo al cambiar de grupo o al leer en otro dispositivo.
function mirrorWeekIntoActiveGroup(S, before) {
  if (!S.routineGroups?.length || JSON.stringify(S.week) === JSON.stringify(before.week)) return
  const i = S.routineGroups.findIndex(g => g.id === S.activeGroupId)
  if (i !== -1) S.routineGroups[i] = { ...S.routineGroups[i], week: clone(S.week || {}) }
}

const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length)

// Every reader of S.bodyweight treats it as oldest-first: lastBW takes the final element, Home
// reads the one before it as the previous weigh-in, and the chart plots the tail. The server now
// sends it ascending, but a response cached offline by an older build can still arrive newest-
// first, so the one place a server payload becomes S re-sorts it. Copy, never sort in place: the
// caller's payload stays untouched.
const bodyweightTime = entry => Number(entry?.t) || new Date(entry?.d).getTime() || 0
// Readers treat S.workouts as oldest-first too (the last one is the newest). Older servers sent
// them newest-first; re-sort by when each workout happened, stable for ties, without mutating
// the payload.
const chronologicalWorkouts = workouts => (Array.isArray(workouts)
  ? workouts.map((workout, index) => ({ workout, index, time: workoutTime(workout) }))
    .sort((a, b) => (a.time - b.time) || (a.index - b.index))
    .map(item => item.workout)
  : workouts)

// Conflicts the server will reject on every retry (a record over the meta size limit, or not an
// object at all). Retrying would park the operation in the queue forever, so it is dropped.
const TERMINAL_SYNC_REASONS = new Set(['set_meta_too_large', 'workout_meta_too_large', 'set_not_object', 'workout_not_object'])

// Cuotas v1. El bloqueo por cuota NO es un logout: el socio conserva la sesión y los datos
// locales, y la app muestra MembershipBlocked. El flag se guarda para que la pantalla siga ahí
// al recargar sin conexión; solo lo apaga un /api/me que diga blocked: false.
const BLOCK_KEY = 'gym_membership_blocked'
const BILLING_KEY = 'gym_billing'
// Interruptor de cuotas del gym (billingEnabled de /api/me). Solo se guarda el apagado: sin la
// clave, cuotas está encendido, como en el servidor.
const BILLING_OFF_KEY = 'gym_billing_off'
const readJSON = key => { try { return JSON.parse(localStorage.getItem(key)) || null } catch { return null } }
// Cuenta pendiente de aprobación (spec 12.3): mismo mecanismo que el bloqueo por cuota, otro
// motivo. Flag persistido; solo lo apaga un /api/me que diga pending: false.
// Motivo de una baja, guardado en el dispositivo: un arranque sin conexión (o sin sesión) muestra
// AccountEnded antes que el login. Solo se borra cuando el servidor confirma la cuenta (verifyAccountEnded)
// o quien usa el dispositivo elige entrar con otra cuenta.
const ENDED_KEY = 'gym_account_ended'
const readEnded = () => { try { const v = localStorage.getItem(ENDED_KEY); return isAccountEnded(v) ? v : null } catch { return null } }
const writeEnded = reason => { try { reason ? localStorage.setItem(ENDED_KEY, reason) : localStorage.removeItem(ENDED_KEY) } catch { /* storage off */ } }
const PENDING_KEY = 'gym_account_pending'
export const billingExempt = user => !!(user?.staff ?? user?.admin)
// Consentimiento de datos de salud (api/health.js): 'granted' | 'declined' | null (cuenta de antes,
// todavía no se le preguntó). Se guarda para que, offline, las secciones sigan ocultas.
const HEALTH_KEY = 'gym_health_consent'
const readHealth = () => { try { const v = localStorage.getItem(HEALTH_KEY); return v === 'granted' || v === 'declined' ? v : null } catch { return null } }
// Sin consentimiento: se ocultan nutrición, peso corporal, lesiones y la biometría de la encuesta.
export const healthOff = state => state.healthConsent === 'declined'
export const isMembershipBlockedError = e => e?.data?.error === 'membership_blocked' || e?.data?.error === 'account_pending'

const ascendingBodyweight = entries => (Array.isArray(entries)
  ? [...entries].sort((a, b) => bodyweightTime(a) - bodyweightTime(b))
  : entries)
const ONBOARDING_FLAGS = ['onboardingCompletado', 'onboardingStatsCompletado', 'onboardingNutritionCompletado', 'planIniciado']
// Having a routine is having started a plan: set here, on every write, whichever screen made it.
const markPlanStarted = S => { if (!S.planIniciado && (S.routines || []).length) S.planIniciado = true }

// Helper functions for routine groups management
function syncGroupInStore() {
  const S = get().S
  return syncActiveGroupInState(S)
}

function addNewGroup(state, name, routines, week, setAsActive) {
  return addGroupToState(state, name, routines, week, setAsActive)
}

function removeGroup(state, groupId) {
  return removeGroupFromState(get().S, groupId)
}

export const useStore = create((set, get) => {
  let syncTm = null
  let syncing = false
  // Counts local writes. A sync that started before the latest write cannot declare the device
  // clean: that write may not have been in its batch.
  let localWrites = 0
  let lastPull = 0
  let licenseExpired = false

  const persist = (S, push = true, stamp = true) => {
    if (stamp) S._ts = Date.now()
    registerCustom(S.customEx)
    localStorage.setItem(KEY, JSON.stringify(S))
    set({ S })
  }

  // Nunca para staff: admins y owner no se bloquean por cuota (el servidor tampoco los bloquea).
  // Exento: el staff (user.staff de /api/me: admin u owner); sin ese dato (sesión vieja) vale
  // admin, como antes.
  const setMembershipBlocked = blocked => {
    const on = !!blocked && !billingExempt(get().user)
    try { on ? localStorage.setItem(BLOCK_KEY, '1') : localStorage.removeItem(BLOCK_KEY) } catch { /* storage off */ }
    set({ membershipBlocked: on })
  }
  // /api/me trae el estado de cuota: se guarda para Settings (también offline) y decide el flag.
  const applyMeBilling = me => {
    const billing = me?.billing || null
    const billingEnabled = me?.billingEnabled !== false
    try {
      billing ? localStorage.setItem(BILLING_KEY, JSON.stringify(billing)) : localStorage.removeItem(BILLING_KEY)
      billingEnabled ? localStorage.removeItem(BILLING_OFF_KEY) : localStorage.setItem(BILLING_OFF_KEY, '1')
    } catch { /* storage off */ }
    set({ billing, billingEnabled })
    // Con cuotas apagado nadie queda bloqueado: se apaga el flag (y su localStorage).
    if (billingExempt(me?.user) || !billingEnabled) setMembershipBlocked(false)
    else if (billing?.blocked === true) setMembershipBlocked(true)
    else if (billing?.blocked === false) setMembershipBlocked(false)
  }
  if (typeof window !== 'undefined') window.addEventListener('gym:membership_blocked', () => setMembershipBlocked(true))
  const setAccountPending = pending => {
    const on = !!pending && !billingExempt(get().user)
    try { on ? localStorage.setItem(PENDING_KEY, '1') : localStorage.removeItem(PENDING_KEY) } catch { /* storage off */ }
    set({ accountPending: on })
  }
  if (typeof window !== 'undefined') window.addEventListener('gym:account_pending', () => setAccountPending(true))
  // Se registró con datos de invitado mientras la cuenta esperaba la aprobación (Login.jsx): se
  // suben la primera vez que /api/me dice que ya está habilitada.
  const pushAfterApproval = async () => {
    if (localStorage.getItem('gym_push_on_approval') !== '1') return
    localStorage.removeItem('gym_push_on_approval')
    await get().pushState()
  }
  // /api/me: pendiente y formulario de datos de una sola vez (profilePrompt: { fields } | null).
  const applyMeAccount = me => {
    if (me && 'pending' in me) setAccountPending(me.pending)
    set({ profilePrompt: me?.profilePrompt || null })
    if (me && 'healthConsent' in me) get().setHealthConsent(me.healthConsent, { ask: me.healthConsent === null })
    // Términos y aviso: sin la versión vigente aceptada, la pantalla de una sola vez los pide.
    if (me?.legal) set({ legalVersion: me.legal.version, legalAsk: !me.legal.accepted })
    // Abono de lauyim (solo staff): por vencer o en mora → el aviso de arriba.
    if (me && 'license' in me) set({ license: me.license })
  }

  const scheduleSync = (delay = 2000) => {
    clearTimeout(syncTm)
    syncTm = setTimeout(() => get().syncPending(), delay + Math.random() * 1500)
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it). On mobile the
  // same applies to the file mirror — backgrounding is often the last thing before the OS
  // kills the app.
  document.addEventListener('visibilitychange', () => {
    // Volver a primer plano: traer las metas que un admin pudo cambiar mientras tanto. Son el
    // único dato que el socio nunca escribe y que no bumpea _ts, así que ningún otro camino
    // de sync las refresca en una sesión ya abierta (ver refreshNutritionGoals).
    if (document.visibilityState !== 'hidden') {
      get().refreshNutritionGoals()
      // Otra pantalla del mismo socio pudo cambiar el plan mientras esta estaba en segundo plano:
      // se sube lo pendiente y se baja lo del servidor (a lo sumo una vez cada 20 s).
      if (get().user && Date.now() - lastPull > 20000) { lastPull = Date.now(); get().syncPending().then(() => get().pullState()) }
      return
    }
    // Sin la espera al azar de scheduleSync: la app puede congelarse en cualquier momento.
    get().syncPending()
  })
  window.addEventListener('online', () => scheduleSync(0))

  // Everything a sign-out leaves behind on this device, whichever way it was triggered.
  const clearLocalSession = () => {
    setMembershipBlocked(false)
    try { localStorage.removeItem(BILLING_KEY) } catch { /* storage off */ }
    set({ billing: null })
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    localStorage.removeItem('gym_dirty')
    localStorage.removeItem(KEY)
    persist(clone(DEF), false)
  }

  // Fin de sesión forzado. Baja de la cuenta (desactivada / rechazada / eliminada): se borra todo
  // lo del dispositivo y se muestra el motivo. Sesión vencida: al login, conservando los datos y
  // la cola offline (se suben cuando la misma persona vuelva a entrar).
  const endSession = async reason => {
    if (!isAccountEnded(reason)) {
      // Sesión vencida: si el dispositivo estaba en la pantalla de baja, ya no se sabe nada de la
      // cuenta desde acá. Al login, con un aviso claro.
      if (get().accountEnded) { writeEnded(null); set({ accountEnded: null, loginNotice: 'relogin' }) }
      get().setUser(null); return
    }
    // Nada más del socio en este dispositivo: ni alarma de descanso ni timers en curso.
    import('./useUI.js').then(({ useUI }) => { useUI.getState().stopRest?.(); useUI.getState().stopWork?.() }).catch(() => {})
    await wipeDeviceData()
    writeEnded(reason)   // después del borrado: localStorage.clear() se lo llevaría
    set({
      user: null, membershipBlocked: false, accountPending: false, billing: null, billingEnabled: true,
      profilePrompt: null, healthConsent: null, healthAsk: false, legalAsk: false, accountEnded: reason
    })
    persist(clone(DEF), false)
  }
  // ¿Sigue valiendo la sesión? /api/me dice el motivo si no. Sin red (o cualquier otro error) no
  // se toca nada: offline nunca es "sin sesión". Un solo chequeo a la vez.
  let verifying = null
  const verifySession = () => {
    if (!get().user || verifying) return verifying || Promise.resolve()
    verifying = api('/api/me')
      // El rol y los permisos al día: un cambio del owner llega sin volver a entrar.
      .then(me => { if (me?.user?.id === get().user?.id && JSON.stringify(me.user) !== JSON.stringify(get().user)) get().setUser(me.user) })
      .catch(e => { if (e?.status === 401) return endSession(e.data?.reason || 'session_expired') })
      .finally(() => { verifying = null })
    return verifying
  }
  if (typeof window !== 'undefined') window.addEventListener('gym:unauthorized', () => { if (get().user) verifySession() })
  if (typeof window !== 'undefined') window.addEventListener('gym:account_ended', e => get().showAccountEnded(e.detail?.error))

  return {
    S: (() => { const s = loadState(); registerCustom(s.customEx); return s })(),
    // Motivo de una baja (account_disabled | account_rejected | account_deleted): AccountEnded.
    accountEnded: readEnded(),
    loginNotice: null,      // 'relogin': la sesión de una cuenta dada de baja ya no sirve
    dismissLoginNotice() { set({ loginNotice: null }) },
    // Quien usa el dispositivo elige otra cuenta: se sale de la pantalla sin esperar al servidor.
    dismissAccountEnded() { writeEnded(null); set({ accountEnded: null }) },
    // Un ingreso (passkey, código del gym, pareo) que el servidor rechazó por baja, después de
    // validar la credencial. No hay datos de esa cuenta en el dispositivo que borrar.
    showAccountEnded(reason) {
      if (!isAccountEnded(reason) || get().user) return
      writeEnded(reason)
      // Los sheets del login (crear perfil, código, pareo) no quedan tapando la pantalla.
      import('./useUI.js').then(({ useUI }) => useUI.getState().closeAll()).catch(() => {})
      set({ accountEnded: reason })
    },
    // "Verificar de nuevo" (y volver a primer plano en la pantalla de baja): pregunta a /api/me.
    // → 'active' (cuenta activa: se restaura la sesión) | 'ended' | 'relogin' | 'offline'
    async verifyAccountEnded() {
      try {
        const me = await api('/api/me')
        writeEnded(null)
        set({ accountEnded: null, loginNotice: null })
        get().setUser(me.user)
        applyMeBilling(me)
        applyMeAccount(me)
        if (!get().membershipBlocked && !get().accountPending) { await get().syncPending(); await get().pullState() }
        return 'active'
      } catch (e) {
        if (e?.status === 401) {
          if (isAccountEnded(e.data?.reason)) { writeEnded(e.data.reason); set({ accountEnded: e.data.reason }); return 'ended' }
          writeEnded(null); set({ accountEnded: null, loginNotice: 'relogin' })
          return 'relogin'
        }
        return 'offline'
      }
    },
    verifySession,
    user: (() => { try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null } })(),
    ready: false,
    // true cuando terminó el primer pull del servidor: lo que se suma solo al estado (las clases a las
    // que fue) espera a esto, para que el pull no lo pise.
    pulled: false,
    membershipBlocked: (() => { try { return localStorage.getItem(BLOCK_KEY) === '1' } catch { return false } })(),
    accountPending: (() => { try { return localStorage.getItem(PENDING_KEY) === '1' } catch { return false } })(),
    profilePrompt: null,
    healthConsent: readHealth(),
    healthAsk: false,       // cuenta de antes sin respuesta: se le pregunta una vez al entrar
    // Términos y aviso de privacidad: versión vigente (de /api/me) y si hay que pedir aceptarla.
    legalVersion: null,
    legalAsk: false,
    // Abono de lauyim para el staff (de /api/me): { status, reason, month, dueDate, suspendDate }.
    license: null,
    licenseReason: null,
    setLegalAccepted() { set({ legalAsk: false }) },
    setHealthConsent(value, { ask = false } = {}) {
      const v = value === 'granted' || value === 'declined' ? value : null
      try { v ? localStorage.setItem(HEALTH_KEY, v) : localStorage.removeItem(HEALTH_KEY) } catch { /* storage off */ }
      set({ healthConsent: v, healthAsk: !!ask && v === null })
    },
    // "Borrar mis datos de salud": lo que quedó en este dispositivo también se borra.
    clearLocalHealthData() {
      get().update(s => {
        for (const k of ['edad', 'altura', 'grasaCorporal', 'pesoKg', 'targetW']) s[k] = null
        s.bodyweight = []
        if (s.respuestasEncuesta) for (const k of ['edad', 'pesoKg', 'altura', 'sexoBiologico', 'lesiones', 'tieneLesion']) delete s.respuestasEncuesta[k]
      })
    },
    // El socio completó o salteó el formulario de una sola vez: se cierra sin esperar a /api/me.
    dismissProfilePrompt() { set({ profilePrompt: null }) },
    billing: readJSON(BILLING_KEY),        // { hasPlan, status, dueDate, planName, blocked } de /api/me
    billingEnabled: (() => { try { return localStorage.getItem(BILLING_OFF_KEY) !== '1' } catch { return true } })(),

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    update(mut, push = true) {
      const S = clone(get().S)
      const before = clone(S)
      mut(S)
      markPlanStarted(S)
      mirrorWeekIntoActiveGroup(S, before)
      persist(S, false)
      // Cambio local sin subir: marcado antes de que llegue a la cola (IndexedDB es asíncrono), para
      // que ningún pull lo tome por un dispositivo al día.
      if (push && get().user) { localWrites++; try { localStorage.setItem('gym_dirty', '1') } catch { /* storage off */ } }
      if (push && get().user) enqueueSync(get().user.id, diffState(before, S), before._ts || null).then(() => scheduleSync())
    },
    replaceState(S, push = false) {
      const before = clone(get().S)
      const next = clone(S)
      markPlanStarted(next)
      persist(next, false)
      if (push && get().user) { localWrites++; try { localStorage.setItem('gym_dirty', '1') } catch { /* storage off */ } }
      if (push && get().user) enqueueSync(get().user.id, diffState(before, next), before._ts || null).then(() => scheduleSync())
    },

    autoBackupNow() {},

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    setGuest(v) { if (v) localStorage.setItem('gym_guest', '1'); else localStorage.removeItem('gym_guest'); set({}) },

    // Public config from /api/config (invite_only, allow_guest). null until the first successful
    // fetch — the login screen and boot both read it, so it is fetched once and cached here
    // rather than by each screen that happens to need it.
    config: null,
    async loadConfig() {
      if (get().config) return get().config
      try { const c = await api('/api/config', { timeoutMs: 2500 }); localStorage.setItem('gym_config', JSON.stringify(c)); set({ config: c }); return c }
      catch { try { return JSON.parse(localStorage.getItem('gym_config') || 'null') } catch { return null } }
    },

    setUser(u) {
      // El bloqueo por cuota y el estado de cuota guardados son de quien estaba: otra cuenta (o
      // ninguna) en este dispositivo no los hereda hasta que su propio /api/me diga lo suyo.
      if (!u || u.id !== get().user?.id) {
        try { localStorage.removeItem(BLOCK_KEY); localStorage.removeItem(BILLING_KEY); localStorage.removeItem(BILLING_OFF_KEY); localStorage.removeItem(PENDING_KEY); localStorage.removeItem(HEALTH_KEY) } catch { /* storage off */ }
        set({ membershipBlocked: false, billing: null, billingEnabled: true, accountPending: false, profilePrompt: null, healthConsent: null, healthAsk: false, legalAsk: false })
      }
      if (u) { localStorage.setItem('gym_user', JSON.stringify(u)); localStorage.removeItem('gym_guest') }
      else localStorage.removeItem('gym_user')
      set({ user: u })
    },

    async pushState() {
      if (!get().user) return
      try {
        const response = await api('/api/data', { method: 'PUT', body: JSON.stringify({ state: get().S }) })
        if (response.ts) {
          const confirmedState = clone(get().S)
          confirmedState._ts = Number(response.ts)
          persist(confirmedState, false, false)
        }
        localStorage.removeItem('gym_dirty')
      }
      catch (e) { localStorage.setItem('gym_dirty', '1') }
    },
    async syncPending() {
      // Bloqueado por cuota: la cola queda intacta hasta que /api/me diga lo contrario.
      if (!get().user || syncing || (navigator.onLine === false) || get().membershipBlocked || get().accountPending) return
      syncing = true
      const writesAtStart = localWrites
      try {
        let rounds = 0
        while (rounds++ < 10) {
          const batch = await takeSyncBatch(get().user.id, 25)
          if (!batch.length) break
          const body = JSON.stringify({ operations: batch })
          // Al pasar a segundo plano iOS congela la página: keepalive deja que la request termine
          // igual (el navegador lo limita a 64 KB, por eso el tope).
          const keepalive = document.visibilityState === 'hidden' && body.length < 60000
          const response = await api('/api/data/sync', { method: 'POST', body, keepalive })
          applySyncMappings(response.results || [])
          const confirmedTs = (response.results || []).reduce((latest, item) => Math.max(latest, Number(item.result?.ts || 0)), 0)
          if (confirmedTs) {
            const confirmedState = clone(get().S)
            confirmedState._ts = confirmedTs
            persist(confirmedState, false, false)
          }
          await removeSync(response.appliedIds || [])
          const terminal = (response.conflicts || []).filter(item => TERMINAL_SYNC_REASONS.has(item.reason))
          if (terminal.length) {
            console.warn('sync: dropping operations the server will never accept', terminal)
            await removeSync(terminal.map(item => item.id))
          }
          const conflicted = new Set((response.conflicts || []).filter(item => !TERMINAL_SYNC_REASONS.has(item.reason)).map(item => item.id))
          await deferSync(batch.filter(row => conflicted.has(row.id)))
          if (!response.appliedIds?.length && !conflicted.size && !terminal.length) break
        }
        if (await countSync(get().user.id)) localStorage.setItem('gym_dirty', '1')
        else if (writesAtStart === localWrites) localStorage.removeItem('gym_dirty')
      } catch (e) {
        localStorage.setItem('gym_dirty', '1')
        // Bloqueo por cuota: se corta el ciclo sin deferSync (sin subir attempts ni nextAttemptAt)
        // y sin descartar nada, para que al desbloquear el sync salga en el acto.
        if (isMembershipBlockedError(e)) return
        const batch = await takeSyncBatch(get().user.id, 25)
        await deferSync(batch)
      } finally { syncing = false }
    },
    // "Reintentar" de MembershipBlocked: pregunta de nuevo a /api/me y, si ya no está
    // bloqueado, sincroniza en el acto. Devuelve true si quedó desbloqueado. Sin conexión tira.
    async retryMembership() {
      const me = await api('/api/me')
      get().setUser(me.user)
      applyMeBilling(me)
      applyMeAccount(me)
      if (get().membershipBlocked || get().accountPending) return false
      await pushAfterApproval()
      await get().syncPending()
      await get().pullState()
      return true
    },
    // Metas nutricionales: las escribe únicamente un admin, por endpoints propios que no
    // bumpean user_state._ts. Se refrescan solas al volver la app a primer plano, para que la
    // prioridad del admin llegue al socio sin que tenga que cerrar y abrir la PWA.
    async refreshNutritionGoals() {
      if (!get().user) return
      try {
        const { goals } = await api('/api/nutrition/goals')
        const fresh = get().S
        if (JSON.stringify(fresh.nutritionGoals || null) === JSON.stringify(goals || null)) return
        persist({ ...fresh, nutritionGoals: goals }, false, false)
      } catch { /* offline — se mantiene lo local */ }
    },
    async pullState() {
      try {
        const { state } = await api('/api/data')
        let dirty = localStorage.getItem('gym_dirty') === '1'
        let pending = await countSync(get().user.id)
        // Lo local pendiente sale primero: jamás se pisa con lo que el servidor tenía antes.
        if (dirty || pending > 0) {
          await get().syncPending()
          dirty = localStorage.getItem('gym_dirty') === '1'
          pending = await countSync(get().user.id)
        }
        const S = get().S
        if (state && !dirty && pending === 0) {
          // Nada pendiente en este dispositivo: el servidor es la verdad. El orden de los _ts no
          // decide nada (cada dispositivo pone el suyo con su propio reloj: uno adelantado subía su
          // copia entera y borraba lo que el otro acababa de guardar).
          const active = S.active
          const next = Object.assign(clone(DEF), state)
          next.bodyweight = ascendingBodyweight(next.bodyweight)
          next.workouts = chronologicalWorkouts(next.workouts)
          const onboardingChanges = []
          for (const flag of ONBOARDING_FLAGS) {
            if (S[flag] === true && state[flag] !== true) {
              next[flag] = true
              onboardingChanges.push({ path: [flag], op: state[flag] === undefined ? 'add' : 'replace', value: true })
            }
          }
          if (active) next.active = active
          if (JSON.stringify(next) !== JSON.stringify(S)) persist(next, false, false)
          if (onboardingChanges.length) enqueueSync(get().user.id, onboardingChanges, state._ts || null).then(() => scheduleSync(0))
        } else if (!state && hasData(S) && !dirty && pending === 0) {
          // Cuenta sin estado en el servidor todavía: primera subida completa.
          await get().pushState()
        } else if (state && dirty && pending === 0 && hasData(S)) {
          // Marcado como con cambios pero sin nada en la cola (la escritura a IndexedDB no llegó a
          // completarse): es la única forma de no perderlos.
          await get().pushState()
        }
        // nutritionGoals lo administra únicamente el admin (endpoints propios, nunca el
        // cliente) y su escritura no bumpea user_state._ts — el gate de arriba puede fallar
        // (socio con cambios locales pendientes) y la prioridad del admin nunca llegaba al
        // socio aunque el guardado en la DB fuera correcto. Se sincroniza siempre, aparte.
        if (state) {
          const fresh = get().S
          if (JSON.stringify(state.nutritionGoals || null) !== JSON.stringify(fresh.nutritionGoals || null)) {
            persist({ ...fresh, nutritionGoals: state.nutritionGoals }, false, false)
          }
        }
      } catch (e) { /* offline — keep local */ }
    },

    async signOut() {
      // La suscripción push de este navegador deja de ser de esta cuenta (servidor y navegador):
      // si no, sus avisos le llegan a quien entre después en el mismo dispositivo.
      const sub = await deviceSubscription()
      try { await get().pushState(); await api('/api/logout', { method: 'POST', body: JSON.stringify({ endpoint: sub?.endpoint }) }) } catch (e) { /* */ }
      try { await sub?.unsubscribe() } catch { /* */ }
      clearLocalSession()
    },


    // "Sign out everywhere": the server bumps this profile's session version, which kills every
    // session it has on any device — this browser included, so the app has to end up exactly
    // where a normal signOut leaves it. Unlike signOut the request is NOT swallowed: if it fails
    // the sessions elsewhere are all still valid, and wiping this device's copy of the data
    // would sign the user out of the one place the bump didn't reach. Caller reports the error.
    async signOutAll() {
      await get().pushState()   // never throws — stores gym_dirty and moves on when offline
      await api('/api/logout/all', { method: 'POST', body: '{}' })
      try { await (await deviceSubscription())?.unsubscribe() } catch { /* */ }
      clearLocalSession()
    },

    // Routine groups management
    getRoutineGroups: () => {
      const S = get().S
      return S.routineGroups || []
    },
    getActiveGroupId: () => get().S.activeGroupId,
    setActiveGroupId: (groupId) => {
      get().update(S => {
        syncActiveGroupInState(S)
        S.activeGroupId = groupId
        const targetGroup = S.routineGroups.find(g => g.id === groupId)
        if (targetGroup) {
          S.routines = JSON.parse(JSON.stringify(targetGroup.routines || []))
          S.week = JSON.parse(JSON.stringify(targetGroup.week || {}))
        }
      })
    },
    addGroup: (name, routines, week, setAsActive, opts) => {
      let newGroup = null
      get().update(S => {
        newGroup = addGroupToState(S, name, routines || [], week || {}, setAsActive, opts)
      })
      return newGroup
    },
    removeGroup: (groupId) => {
      get().update(S => removeGroupFromState(S, groupId))
    },
    renameGroup: (groupId, newName) => {
      const S = get().S
      const group = (S.routineGroups || []).find(g => g.id === groupId)
      if (!group) return null
      const validated = validateGroupName(newName, S.routineGroups || [], groupId)
      if (!validated.valid) {
        throw new Error(validated.error || t('Nombre de grupo inválido'))
      }
      let renamed = null
      get().update(next => {
        renamed = next.routineGroups.find(g => g.id === groupId)
        if (renamed) renamed.name = newName.trim()
      })
      return renamed
    },

    // Boot: ask the server who we are, then pull.
    async boot() {
      if (typeof window !== 'undefined') {
        // reason: 'unpaid' (abono impago) o 'expired' (corte fijo): cambia el texto para el staff.
        window.addEventListener('gym:license_expired', e => {
          set({ licenseExpired: true, licenseReason: e.detail?.reason || null })
        })
      }
      // Guests never authenticate, so an instance that turned guest mode off has no request to
      // refuse — the only way the switch reaches someone already inside is here, on their next
      // boot. Ending the session needs a positive `allow_guest: false`; see lib/guest.js for why
      // an unreachable server must not be allowed to lock anyone out (#42).
      // Render the local session immediately. Network checks continue in the background;
      // this is what makes a previously opened PWA usable in airplane mode.
      set({ ready: true })
      const cfg = await get().loadConfig()
      if (!guestAllowed(cfg)) get().setGuest(false)
      try {
        const me = await api('/api/me')
        // La cuenta volvió a estar activa (con el dispositivo en la pantalla de baja).
        if (get().accountEnded) { writeEnded(null); set({ accountEnded: null }) }
        get().setUser(me.user)
        applyMeBilling(me)
        applyMeAccount(me)
        if (!get().membershipBlocked && !get().accountPending) {
          await pushAfterApproval()
          // Apply any local operations that were recorded while the device was offline.
          await get().syncPending()
          // Pull after the queue is drained so a just-completed local change cannot be
          // replaced by the older full snapshot that was on the server before reload.
          await get().pullState()
          set({ pulled: true })
        }
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(s => { s.reminder = { ...s.reminder, tz } })
        }
      } catch (e) {
        if (e.status === 401) await endSession(e.data?.reason || 'session_expired')
        if (e.data?.error === 'license_expired') {
          set({ licenseExpired: true, licenseReason: e.data?.reason || null })
        }
      }
      set({ ready: true })
    }
  }
})

export { hasData }
