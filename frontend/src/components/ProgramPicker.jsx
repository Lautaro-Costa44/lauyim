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

// Loads one program as the member's plan (pickProgram) and says how it went.
export function chooseProgram(data, program) {
  let result
  useStore.getState().update(s => {
    result = pickProgram(s, {
      name: program.name, presets: program.days, customDefs: data?.customExercises,
      source: program.id ? { kind: 'preset', programId: program.id, at: Date.now() } : null
    })
  })
  const toast = useUI.getState().toast
  if (result.ok) toast(t('Plan “{0}” cargado', program.name))
  else if (result.error === 'limit') toast(t('Límite de {0} grupos alcanzado.', MAX_ROUTINE_GROUPS))
  else if (result.error === 'exists') toast(t('Ya existe un grupo con este nombre.'))
  else toast(t('La rutina “{0}” ya está planeada para el {1}.', result.conflict?.routine?.name || t('Routine'), t(DAYN[result.conflict?.day])))
  return result.ok
}

/**
 * The gym's programs to pick one as your plan: name, days and the muscles it works most — the
 * same numbers the admin sees in Rutinas. `data` is a GET
 * /api/presets answer (fetched here when not passed). Renders nothing when the gym has no
 * programs, so the caller keeps its own fallback.
 */
export default function ProgramPicker({ data: given, onPicked }) {
  const [fetched, setFetched] = useState(null)
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
    {programs.map(p => <button key={p.id || p.name} type="button" className="item program-choice"
      onClick={() => { if (chooseProgram(data, p)) onPicked?.(p) }}>
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
