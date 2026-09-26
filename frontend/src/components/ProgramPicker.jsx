import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { DAYN } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { programStats, defsById } from '../lib/presetStats.js'
import { pickProgram, presetGroupOf, presetsOfGroup } from '../lib/starter.js'
import { MAX_ROUTINE_GROUPS } from '../lib/routineGroups.js'
import Icon from './Icon.jsx'

/**
 * The gym's programs, as GET /api/presets returns them: [{ id, name, days, stats }] in the gym's
 * order. A server from before programs existed has only groups: those come without an id.
 */
export function programsOf(data) {
  const presets = data?.presets || []
  const defs = defsById(data?.customExercises)
  const list = (data?.programs?.length ? data.programs : [...new Set(presets.map(presetGroupOf))].map(name => ({ id: null, name })))
  return list
    .map(p => {
      const days = p.id ? presets.filter(d => d.program_id === p.id) : presetsOfGroup(presets, p.name)
      return { id: p.id, name: p.name, days, stats: programStats(days, defs) }
    })
    .filter(p => p.days.length)
}

/**
 * A program's days and the gym's custom exercises they use, fresh from the server
 * (POST /api/presets/apply) — which refuses (403) a program the admin hid after this list was
 * loaded. Throws like api(). A program without an id (server from before programs) has no such
 * endpoint: the list's own data is used.
 */
export async function fetchProgramToApply(data, program) {
  if (!program.id) return { presets: program.days, customExercises: data?.customExercises }
  return api('/api/presets/apply', { method: 'POST', body: JSON.stringify({ id: program.id }) })
}

// Says why a program could not be loaded.
export const programUnavailableMessage = e => e?.status === 403 || e?.status === 404
  ? t('Este programa ya no está disponible.')
  : (e?.message || t('No se pudo cargar el programa.'))

// Loads one program as the member's plan (pickProgram) and says how it went. Resolves to true
// when it was loaded.
export async function chooseProgram(data, program) {
  const toast = useUI.getState().toast
  let fresh
  try { fresh = await fetchProgramToApply(data, program) }
  catch (e) { toast(programUnavailableMessage(e)); return false }
  if (!fresh?.presets?.length) { toast(t('Este programa ya no está disponible.')); return false }
  let result
  useStore.getState().update(s => {
    result = pickProgram(s, {
      name: program.name, presets: fresh.presets, customDefs: fresh.customExercises,
      source: program.id ? { kind: 'preset', programId: program.id, at: Date.now() } : null
    })
  })
  if (result.ok) toast(t('Plan “{0}” cargado', program.name))
  else if (result.error === 'limit') toast(t('Límite de {0} grupos alcanzado.', MAX_ROUTINE_GROUPS))
  else if (result.error === 'exists') toast(t('Ya existe un grupo con este nombre.'))
  else toast(t('La rutina “{0}” ya está planeada para el {1}.', result.conflict?.routine?.name || t('Routine'), t(DAYN[result.conflict?.day])))
  return result.ok
}

/**
 * The gym's programs to pick one as your plan: name, days and the muscles it works most — the
 * same numbers the admin sees in Rutinas. `data` is a GET /api/presets answer (fetched here when
 * not passed), which only holds the programs the admin made visible to members. Renders nothing
 * when there are none, so the caller keeps its own fallback.
 */
export default function ProgramPicker({ data: given, onPicked }) {
  const [fetched, setFetched] = useState(null)
  // One load at a time: a second tap while the first asks the server would load it twice.
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (given) return
    let alive = true
    api('/api/presets').then(d => { if (alive) setFetched(d) }).catch(() => { if (alive) setFetched({}) })
    return () => { alive = false }
  }, [given])
  const data = given || fetched
  const programs = programsOf(data)
  if (!programs.length) return null
  return <div className="list program-picker">
    {programs.map(p => <button key={p.id || p.name} type="button" className="item program-choice" disabled={busy}
      onClick={async () => {
        setBusy(true)
        const ok = await chooseProgram(data, p).finally(() => setBusy(false))
        if (ok) onPicked?.(p)
      }}>
      <span className="grow">
        <div className="tt">{p.name}</div>
        <div className="ss">
          {p.stats.days === 1 ? t('1 día') : t('{0} días', p.stats.days)}
        </div>
        {!!p.stats.top.length && <div className="mchips">{p.stats.top.slice(0, 4).map(m => <span key={m} className="mchip">{t(MUSCLE_NAME[m] || m)}</span>)}</div>}
      </span>
      <Icon name="chevronRight" className="chev" />
    </button>)}
  </div>
}
