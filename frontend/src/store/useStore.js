import { create } from 'zustand'
import { api } from '../lib/api.js'
import { localTZ } from '../lib/format.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { guestAllowed } from '../lib/guest.js'
import { MAX_ROUTINE_GROUPS, canAddGroup, validateGroupName, createRoutineGroup, syncActiveGroupInState, addGroupToState, removeGroupFromState } from '../lib/routineGroups.js'

const KEY = 'gym_state_v1'
export const DEF = {
  unit: 'kg', restSec: 90, restPauseSec: 15, sound: true, keepAwake: true, lang: 'es',
  theme: 'dark', accent: 'lime', body: 'male', genero: 'masculino', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose (loaded state is overlaid on DEF, on every path: local,
  // server pull, backup import) still falls back to the `showRir` boolean this replaced and
  // keeps the column it had. See effortOf.
  reminder: { on: false, time: '08:00', tz: null, feeOn: false, feeInterval: 'monthly', feeDate: '' }, effort: null, autoBackup: false,
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
  edad: null, altura: null, objetivo: null,
  configuracion: { pedirPesoAlEntrenar: true },
  estadoInicial: 'pendiente',
  onboardingCompletado: false,
  onboardingStatsCompletado: false,
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
  let pushTm = null
  let licenseExpired = false

  const persist = (S, push = true) => {
    S._ts = Date.now()
    registerCustom(S.customEx)
    localStorage.setItem(KEY, JSON.stringify(S))
    set({ S })
    if (push && get().user) {
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it). On mobile the
  // same applies to the file mirror — backgrounding is often the last thing before the OS
  // kills the app.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    if (pushTm) {
      clearTimeout(pushTm)
      pushTm = null
      get().pushState()
    }
  })

  // Everything a sign-out leaves behind on this device, whichever way it was triggered.
  const clearLocalSession = () => {
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

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    update(mut, push = true) {
      const S = clone(get().S)
      mut(S)
      persist(S, push)
    },
    replaceState(S, push = false) { persist(clone(S), push) },

    autoBackupNow() {},

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    setGuest(v) { if (v) localStorage.setItem('gym_guest', '1'); else localStorage.removeItem('gym_guest'); set({}) },

    // Public config from /api/config (invite_only, allow_guest). null until the first successful
    // fetch — the login screen and boot both read it, so it is fetched once and cached here
    // rather than by each screen that happens to need it.
    config: null,
    async loadConfig() {
      if (get().config) return get().config
      try { const c = await api('/api/config'); set({ config: c }); return c }
      catch { return null }
    },

    setUser(u) {
      if (u) { localStorage.setItem('gym_user', JSON.stringify(u)); localStorage.removeItem('gym_guest') }
      else localStorage.removeItem('gym_user')
      set({ user: u })
    },

    async pushState() {
      if (!get().user) return
      clearTimeout(pushTm)
      try { await api('/api/data', { method: 'PUT', body: JSON.stringify({ state: get().S }) }); localStorage.removeItem('gym_dirty') }
      catch (e) { localStorage.setItem('gym_dirty', '1') }
    },
    async pullState() {
      try {
        const { state } = await api('/api/data')
        const S = get().S
        const dirty = localStorage.getItem('gym_dirty') === '1'
        if (state && (!hasData(S) || ((state._ts || 0) >= (S._ts || 0) && !dirty))) {
          const active = S.active
          const next = Object.assign(clone(DEF), state)
          if (active) next.active = active
          persist(next, false)
        } else if (hasData(S)) { await get().pushState() }
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
      const S = get().S
      syncActiveGroupInState(S)
      S.activeGroupId = groupId
      const targetGroup = S.routineGroups.find(g => g.id === groupId)
      if (targetGroup) {
        S.routines = JSON.parse(JSON.stringify(targetGroup.routines || []))
        S.week = JSON.parse(JSON.stringify(targetGroup.week || {}))
      }
      set({ S })
    },
    addGroup: (name, routines, week, setAsActive) => {
      const S = get().S
      const newGroup = addGroupToState(S, name, routines || [], week || {}, setAsActive)
      set({ S: { ...S, routineGroups: S.routineGroups || [], ...newGroup } })
      return newGroup
    },
    removeGroup: (groupId) => {
      const S = get().S
      const newGroups = (S.routineGroups || []).filter(g => g.id !== groupId)
      set({ S: { ...S, routineGroups: newGroups } })
      // If we removed the active group, activate the first remaining
      if (S.activeGroupId === groupId && newGroups.length > 0) {
        const nextGroup = newGroups[0]
        setActiveGroupId(nextGroup.id)
      } else if (S.activeGroupId === groupId && newGroups.length === 0) {
        setActiveGroupId(null)
      }
    },
    renameGroup: (groupId, newName) => {
      const S = get().S
      const group = S.routineGroups.find(g => g.id === groupId)
      if (!group) return null
      const validated = validateGroupName(newName, S.routineGroups, groupId)
      if (!validated.valid) {
        throw new Error(validated.error || t('Nombre de grupo inválido'))
      }
      group.name = newName.trim()
      set({ S })
      return group
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
      const cfg = await get().loadConfig()
      if (!guestAllowed(cfg)) get().setGuest(false)
      try {
        const me = await api('/api/me')
        get().setUser(me.user)
        await get().pullState()
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(s => { s.reminder = { ...s.reminder, tz } })
        }
      } catch (e) {
        if (e.status === 401) get().setUser(null)
        if (e.data?.error === 'license_expired' || e.status === 403) {
          set({ licenseExpired: true })
        }
      }
      set({ ready: true })
    }
  }
})

export { hasData }
