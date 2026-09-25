import { useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { api } from '../../../lib/api.js'
import { DAYN } from '../../../lib/format.js'
import { addProgramToState } from '../../../lib/starter.js'
import { MAX_ROUTINE_GROUPS } from '../../../lib/routineGroups.js'
import { normalizeStr } from '../../../lib/exercises.js'
import { t } from '../../../lib/i18n.js'
import { Row, Switch, TextField } from '../../../components/ui.jsx'

/**
 * Carga un programa en un socio como un grupo de rutinas nuevo, igual que "Cargar planes
 * prearmados" en Ajustes: una copia (no una referencia; editar el programa después no cambia
 * lo del socio) y sus otros grupos quedan como estaban. El grupo guarda de qué programa salió.
 */
export async function assignProgram(userId, program, days, { activate = true } = {}) {
  const base = `/api/admin/users/${encodeURIComponent(userId)}/routines`
  const data = await api(base)
  const state = JSON.parse(JSON.stringify(data))
  const result = addProgramToState(state, {
    name: program.name, presets: days, activate,
    source: { kind: 'preset', programId: program.id, at: Date.now() }
  })
  if (!result.ok) return result
  await api(base, {
    method: 'PUT',
    body: JSON.stringify({ routines: state.routines, week: state.week, dayPlan: state.dayPlan, routineGroups: state.routineGroups, activeGroupId: state.activeGroupId })
  })
  return result
}

export default function AssignSheet({ program, days, users, close, onAssigned }) {
  const toast = useUI(s => s.toast)
  const [search, setSearch] = useState('')
  const [activate, setActivate] = useState(true)
  const [busy, setBusy] = useState(null)
  // Solo socios activos con la app: una ficha sin app no tiene dónde ver la rutina.
  const q = normalizeStr(search.trim())
  const members = (users || [])
    .filter(u => !u.disabled && u.hasApp !== false && (!q || normalizeStr(u.name).includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name))

  const assign = async u => {
    setBusy(u.id)
    try {
      const result = await assignProgram(u.id, program, days, { activate })
      if (!result.ok) {
        toast(result.error === 'limit' ? t('{0} ya tiene {1} grupos de rutinas (el máximo).', u.name, MAX_ROUTINE_GROUPS)
          : result.error === 'exists' ? t('{0} ya tiene un grupo llamado “{1}”.', u.name, program.name)
            : t('La rutina “{0}” ya está planeada para el {1}.', result.conflict?.routine?.name || '', t(DAYN[result.conflict?.day])))
        return
      }
      toast(t('“{0}” asignado a {1}', program.name, u.name))
      onAssigned?.()
      close()
    } catch (e) {
      toast(e.message)
    } finally {
      setBusy(null)
    }
  }

  return <div className="assign-sheet">
    <h3 style={{ marginBottom: 4 }}>{t('Asignar “{0}”', program.name)}</h3>
    <div className="small muted" style={{ marginBottom: 12 }}>{t('Se carga como un grupo de rutinas nuevo del socio. Sus otros grupos no cambian.')}</div>
    <div className="row between" style={{ gap: 12 }}>
      <span className="small">{t('Activarlo ahora (pasa a ser su plan de la semana)')}</span>
      <Switch label={t('Activarlo ahora (pasa a ser su plan de la semana)')} checked={activate} onChange={setActivate} />
    </div>
    <div style={{ height: 10 }} />
    <TextField value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Buscar socio')} aria-label={t('Buscar socio')} />
    <div className="sect-b assign-list" style={{ marginTop: 10 }}>
      {members.slice(0, 50).map(u => <Row key={u.id} title={u.name} accessory="chevron"
        subtitle={busy === u.id ? t('Asignando…') : null} onClick={busy ? undefined : () => assign(u)} />)}
      {!members.length && <div className="empty">{t('No users match that name.')}</div>}
    </div>
  </div>
}
