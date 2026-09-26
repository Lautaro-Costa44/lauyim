import { create } from 'zustand'
import { api } from '../lib/api.js'
import { localTZ, workoutTime } from '../lib/format.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { guestAllowed } from '../lib/guest.js'
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
const PENDING_KEY = 'gym_account_pending'
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
  let licenseExpired = false

  const persist = (S, push = true, stamp = true) => {
    if (stamp) S._ts = Date.now()
    registerCustom(S.customEx)
    localStorage.setItem(KEY, JSON.stringify(S))
    set({ S })
  }

  // Nunca para staff: admins y owner no se bloquean por cuota (el servidor tampoco los bloquea).
  const setMembershipBlocked = blocked => {
    const on = !!blocked && !get().user?.admin
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
    if (me?.user?.admin || !billingEnabled) setMembershipBlocked(false)
    else if (billing?.blocked === true) setMembershipBlocked(true)
    else if (billing?.blocked === false) setMembershipBlocked(false)
  }
  if (typeof window !== 'undefined') window.addEventListener('gym:membership_blocked', () => setMembershipBlocked(true))
  const setAccountPending = pending => {
    const on = !!pending && !get().user?.admin
    try { on ? localStorage.setItem(PENDING_KEY, '1') : localStorage.removeItem(PENDING_KEY) } catch { /* storage off */ }
    set({ accountPending: on })
  }
  if (typeof window !== 'undefined') window.addEventListener('gym:account_pending', () => setAccountPending(true))
  // /api/me: pendiente y formulario de datos de una sola vez (profilePrompt: { fields } | null).
  const applyMeAccount = me => {
    if (me && 'pending' in me) setAccountPending(me.pending)
    set({ profilePrompt: me?.profilePrompt || null })
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
    if (document.visibilityState !== 'hidden') return get().refreshNutritionGoals()
    scheduleSync(0)
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

  return {
    S: (() => { const s = loadState(); registerCustom(s.customEx); return s })(),
    user: (() => { try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null } })(),
    ready: false,
    membershipBlocked: (() => { try { return localStorage.getItem(BLOCK_KEY) === '1' } catch { return false } })(),
    accountPending: (() => { try { return localStorage.getItem(PENDING_KEY) === '1' } catch { return false } })(),
    profilePrompt: null,
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
      persist(S, false)
      if (push && get().user) enqueueSync(get().user.id, diffState(before, S), before._ts || null).then(() => scheduleSync())
    },
    replaceState(S, push = false) {
      const before = clone(get().S)
      const next = clone(S)
      markPlanStarted(next)
      persist(next, false)
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
        try { localStorage.removeItem(BLOCK_KEY); localStorage.removeItem(BILLING_KEY); localStorage.removeItem(BILLING_OFF_KEY); localStorage.removeItem(PENDING_KEY) } catch { /* storage off */ }
        set({ membershipBlocked: false, billing: null, billingEnabled: true, accountPending: false, profilePrompt: null })
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
      try {
        let rounds = 0
        while (rounds++ < 10) {
          const batch = await takeSyncBatch(get().user.id, 25)
          if (!batch.length) break
          const response = await api('/api/data/sync', { method: 'POST', body: JSON.stringify({ operations: batch }) })
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
        else localStorage.removeItem('gym_dirty')
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
        const S = get().S
        const dirty = localStorage.getItem('gym_dirty') === '1'
        const pending = await countSync(get().user.id)
        if (state && pending === 0 && (!hasData(S) || ((state._ts || 0) >= (S._ts || 0) && !dirty))) {
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
          persist(next, false, false)
          if (onboardingChanges.length) enqueueSync(get().user.id, onboardingChanges, state._ts || null).then(() => scheduleSync(0))
        } else if (hasData(S) && !dirty && pending === 0) {
          // A newer local timestamp can mean offline edits that are already queued.
          // Never promote that snapshot with the legacy full-state PUT: nutrition is
          // entity-synced, while the other modules need the incremental queue so that
          // another device's unrelated changes are not overwritten.
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
      try { await get().pushState(); await api('/api/logout', { method: 'POST', body: '{}' }) } catch (e) { /* */ }
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
      clearLocalSession()
    },

    // Demo build only: drop the seeded example profile back in (Settings → "Reset demo data").
    // Dynamic import so the generator never ships in a self-hosted bundle.
    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      localStorage.removeItem('gym_dirty')
      persist(Object.assign(clone(DEF), buildDemoState()), false)
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
        window.addEventListener('gym:license_expired', () => {
          set({ licenseExpired: true })
        })
      }
      // Demo build (GitHub Pages): no backend at all — seed once, stay in guest mode.
      if (DEMO) {
        if (!localStorage.getItem(DEMO_SEEDED)) {
          localStorage.setItem(DEMO_SEEDED, '1')
          await get().resetDemo()
        }
        get().setGuest(true)
        set({ ready: true })
        return
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
        get().setUser(me.user)
        applyMeBilling(me)
        applyMeAccount(me)
        if (!get().membershipBlocked && !get().accountPending) {
          // Apply any local operations that were recorded while the device was offline.
          await get().syncPending()
          // Pull after the queue is drained so a just-completed local change cannot be
          // replaced by the older full snapshot that was on the server before reload.
          await get().pullState()
        }
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(s => { s.reminder = { ...s.reminder, tz } })
        }
      } catch (e) {
        if (e.status === 401) get().setUser(null)
        if (e.data?.error === 'license_expired') {
          set({ licenseExpired: true })
        }
      }
      set({ ready: true })
    }
  }
})

export { hasData }
