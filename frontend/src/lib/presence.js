// Live presence for the admin dashboard ("training now"). It belongs to the session, not to the
// workout screen: it used to live in ActiveWorkout, so switching tabs mid-workout unmounted it,
// told the server the member had left, and the member flickered in and out of the list.
//
// The server forgets a member on its own after PRESENCE_TTL (70 s) without a ping, so a closed
// tab needs no goodbye; an explicit `active:false` is only sent when the session really ends.
import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { api } from './api.js'
import { supersetUnits, setsDoneActive } from './history.js'

export const PRESENCE_PING_MS = 20000

export function presencePayload(A) {
  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur, Math.max(0, A.entries.length - 1))
  return {
    active: true, name: A.name,
    exIdx: units.findIndex(u => u.includes(cur)) + 1, exTotal: units.length,
    setsDone: setsDoneActive(A), setsTotal: A.entries.reduce((n, e) => n + e.sets.length, 0),
    startedAt: A.start,
  }
}

const post = body => api('/api/activity', { method: 'POST', body: JSON.stringify(body) }).catch(() => {})

// Signed-in only — guests have no server session. Reads fresh state on every tick so the
// dashboard sees progress as it happens.
export function useWorkoutPresence(signedIn, activeId) {
  useEffect(() => {
    if (!signedIn || !activeId) return
    const ping = () => {
      const A = useStore.getState().S.active
      if (A) post(presencePayload(A))
    }
    // Closing the tab: sendBeacon is the only request that survives the page going away.
    const onPageHide = () => {
      try { navigator.sendBeacon?.('/api/activity', new Blob([JSON.stringify({ active: false })], { type: 'application/json' })) } catch { /* */ }
    }
    ping()
    const iv = setInterval(ping, PRESENCE_PING_MS)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      clearInterval(iv)
      window.removeEventListener('pagehide', onPageHide)
      // Finished, discarded or closed for inactivity. A new session (another id) or a sign-out
      // leaves the server to the next ping or the TTL.
      if (!useStore.getState().S.active) post({ active: false })
    }
  }, [signedIn, activeId])
}
