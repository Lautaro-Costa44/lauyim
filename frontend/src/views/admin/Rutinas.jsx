import { useEffect, useState } from 'react'
import { useAdmin } from './context.js'
import { useDesktop } from './useDesktop.js'
import { useUI } from '../../store/useUI.js'
import { useStore } from '../../store/useStore.js'
import { api } from '../../lib/api.js'
import { confirmSheet, inputSheet } from '../../sheets.jsx'
import { exOr, normalizeStr } from '../../lib/exercises.js'
import { presetGroupOf } from '../../lib/starter.js'
import { t, exerciseNameFor } from '../../lib/i18n.js'
import { Button, TextField } from '../../components/ui.jsx'
import PresetEditor from './rutinas/PresetEditor.jsx'
import ProgramCard from './rutinas/ProgramCard.jsx'
import AssignSheet from './rutinas/AssignSheet.jsx'

// Programas (grupos de presets) del server; uno sin id si el server es anterior a los programas.
function programsOf(programs, presets) {
  if (programs?.length) return programs
  return [...new Set((presets || []).map(presetGroupOf))].map(name => ({ id: null, name }))
}
const daysOf = (program, presets) => (presets || []).filter(p => program.id ? p.program_id === program.id : presetGroupOf(p) === program.name)

const matches = (text, q) => normalizeStr(text).includes(q)
const dayMatches = (day, q) => matches(day.name, q) || (day.ex || []).some(item => matches(exerciseNameFor(exOr(item.id)), q))

export default function Rutinas() {
  const openSheet = useUI(s => s.openSheet)
  const toast = useUI(s => s.toast)
  const body = useStore(s => s.S?.body) || 'male'
  const { presets, programs, users, loadPresets } = useAdmin()
  const desktop = useDesktop()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState(null)       // program name, or null = todos
  const [editing, setEditing] = useState(null)     // desktop: { preset } | { group } en el panel
  const [usage, setUsage] = useState({})

  const loadUsage = () => api('/api/admin/programs/usage').then(d => setUsage(d.usage || {})).catch(() => {})
  useEffect(() => { loadUsage() }, [])
  // Pasar a teléfono con el panel abierto: el panel no existe ahí.
  useEffect(() => { if (!desktop) setEditing(null) }, [desktop])

  const list = programsOf(programs, presets)
  const reload = () => loadPresets()
  const openEditor = (target) => {
    const props = { existing: target.preset, defaultGroup: target.group || '', programs: list, reload }
    if (desktop) return setEditing({ ...target, key: (target.preset?.id || 'new') + ':' + Date.now() })
    openSheet((close, { setOnBack }) => <PresetEditor {...props} close={close} setOnBack={setOnBack} />)
  }

  const removeDay = day => confirmSheet({
    title: t('Delete {0}?', day.name), message: t('This removes it from the preset catalog. Existing user routines are unchanged.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => api('/api/admin/presets/delete', { method: 'POST', body: JSON.stringify({ id: day.id }) })
      .then(() => { toast(t('Preset deleted')); if (editing?.preset?.id === day.id) setEditing(null); reload() }).catch(e => toast(e.message))
  })
  const duplicateDay = day => api('/api/admin/presets/duplicate', { method: 'POST', body: JSON.stringify({ id: day.id }) })
    .then(d => { toast(t('Día duplicado: {0}', d.preset.name)); reload() }).catch(e => toast(e.message))
  const duplicateProgram = program => api('/api/admin/programs/duplicate', { method: 'POST', body: JSON.stringify({ id: program.id }) })
    .then(d => { toast(t('Programa duplicado: {0}', d.program.name)); reload() }).catch(e => toast(e.message))
  const renameProgram = program => inputSheet({
    title: t('Renombrar programa'), placeholder: t('Nombre del programa'), defaultValue: program.name, confirmText: t('Guardar'),
    onConfirm: name => api('/api/admin/programs', { method: 'PUT', body: JSON.stringify({ id: program.id, name }) })
      .then(() => { toast(t('Programa renombrado')); if (filter === program.name) setFilter(name); reload() })
      .catch(e => toast(e.data?.code === 'PROGRAM_NAME_TAKEN' ? t('Ya existe un programa con ese nombre.') : e.message))
  })
  const reorder = (program, ids) => api('/api/admin/presets/reorder', { method: 'POST', body: JSON.stringify({ programId: program.id, ids }) })
    .then(reload)
    .catch(e => { toast(e.data?.code === 'PROGRAM_CHANGED' ? t('El programa cambió; se recargó la lista.') : e.message); reload(); throw e })
  const assign = program => openSheet(close => <AssignSheet program={program} days={daysOf(program, presets)} users={users} close={close} onAssigned={loadUsage} />)

  // Buscador: un programa aparece si su nombre coincide (con todos sus días) o si alguno de sus
  // días coincide por nombre o ejercicio (solo esos días).
  const q = normalizeStr(search.trim())
  const cards = list
    .filter(program => !filter || program.name === filter)
    .map(program => {
      const days = daysOf(program, presets)
      if (!q || matches(program.name, q)) return { program, days, filtered: false }
      return { program, days: days.filter(day => dayMatches(day, q)), filtered: true }
    })
    .filter(card => !q || card.days.length)

  const panel = desktop && editing
  return <div className={'admin-presets' + (panel ? ' editing' : '')}>
    <div className="admin-presets-main">
      <div className="card preset-toolbar">
        <div className="row between">
          <h2 style={{ margin: 0 }}>{t('Preset routines')}</h2>
          <Button variant="primary" size="sm" icon="plus" onClick={() => openEditor({ group: '' })}>{t('Nuevo programa')}</Button>
        </div>
        <p className="small muted admin-prose">{t('Programas que los socios cargan desde la app (plan inicial y "Cargar planes prearmados") o que les asignás desde acá. Cada socio recibe una copia: editar un programa no cambia lo que ya tienen.')}</p>
        <TextField value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Buscar programa, día o ejercicio')} aria-label={t('Buscar programa, día o ejercicio')} />
        {list.length > 1 && <div className="chips preset-filter" role="group" aria-label={t('Programas')}>
          <button type="button" className={'chip nocap' + (!filter ? ' on' : '')} aria-pressed={!filter} onClick={() => setFilter(null)}>{t('Todas')}</button>
          {list.map(p => <button key={p.id || p.name} type="button" className={'chip nocap' + (filter === p.name ? ' on' : '')}
            aria-pressed={filter === p.name} onClick={() => setFilter(filter === p.name ? null : p.name)}>{p.name}</button>)}
        </div>}
      </div>

      {presets === null ? <div className="dim small">{t('Loading…')}</div>
        : !list.length ? <div className="card dim small">{t('No presets yet.')}</div>
          : !cards.length ? <div className="card dim small">{t('Ningún programa coincide con la búsqueda.')}</div>
            : <div className="preset-grid">
              {cards.map(({ program, days }) => <ProgramCard key={program.id || program.name} program={program} days={days}
                usage={program.id ? usage[program.id] : null} body={body} editingId={panel ? editing.preset?.id : null}
                onEdit={day => openEditor({ preset: day })} onAddDay={p => openEditor({ group: p.name })}
                onDuplicateDay={duplicateDay} onDeleteDay={removeDay} onRename={renameProgram}
                onDuplicate={duplicateProgram} onAssign={assign} onReorder={ids => reorder(program, ids)} />)}
            </div>}
    </div>
    {panel && <div className="card admin-user-panel preset-panel">
      <PresetEditor key={editing.key} existing={editing.preset} defaultGroup={editing.group || ''} programs={list}
        reload={reload} close={() => setEditing(null)} />
    </div>}
  </div>
}
