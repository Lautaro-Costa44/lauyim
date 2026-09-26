import { useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { api } from '../../../lib/api.js'
import { DAYN } from '../../../lib/format.js'
import { exercisePicker, exConfigSheet, glyphPicker } from '../../../sheets.jsx'
import { exOr } from '../../../lib/exercises.js'
import { exLine } from '../../../lib/history.js'
import { glyphOf } from '../../../lib/glyphs.js'
import { MUSCLE_NAME } from '../../../lib/muscles.js'
import { presetStats } from '../../../lib/presetStats.js'
import { t, exerciseNameFor } from '../../../lib/i18n.js'
import Icon from '../../../components/Icon.jsx'
import { useDragReorder } from '../../../components/useDragReorder.js'
import { Button, TextField, SelectRow, usePickerStep, useSheetBack } from '../../../components/ui.jsx'

const INTENSIFIER_LABEL = { dropset: 'Drop-set', topback: 'Top-set + Backoff', restpause: 'Rest-pause' }

let rowKey = 0
const keyed = item => ({ ...item, _k: ++rowKey })
const unkeyed = ({ _k, ...item }) => item

// Un día (preset) de un programa. En el teléfono vive en un sheet; en escritorio, en el panel
// lateral de Rutinas (sin setOnBack). El día planeado se elige en un paso interno; el back
// cierra primero esa lista.
export default function PresetEditor({ existing, defaultGroup = '', programs = [], close, setOnBack, reload }) {
  const [name, setName] = useState(existing?.name || '')
  const [groupName, setGroupName] = useState(existing ? (existing.group_name || existing.groupName || 'General') : defaultGroup)
  const [plannedDay, setPlannedDay] = useState(existing?.planned_day ?? null)
  const [emoji, setEmoji] = useState(existing?.emoji || 'dumbbell')
  const [ex, setEx] = useState(() => (existing?.ex || []).map(keyed))
  const [saving, setSaving] = useState(false)
  const toast = useUI(s => s.toast)
  const picker = usePickerStep()
  useSheetBack(setOnBack, () => picker.isOpen ? picker.close() : close())
  const plain = ex.map(unkeyed)
  const drag = useDragReorder(ex.map(item => item._k), keys => setEx(current => keys.map(k => current.find(item => item._k === k))))
  const stats = presetStats({ ex: plain })

  const add = exercise => exConfigSheet(exercise, null, cfg => setEx(current => [...current, keyed({ id: exercise.id, ...cfg })]), null, { ex: plain })
  const edit = item => exConfigSheet(exOr(item.id), unkeyed(item),
    cfg => setEx(current => current.map(x => x._k === item._k ? { ...keyed({ id: item.id, ...cfg }), _k: item._k } : x)),
    () => setEx(current => current.filter(x => x._k !== item._k)), { ex: plain })

  const save = () => {
    if (!name.trim()) return toast(t('Give the routine a name'))
    setSaving(true)
    const body = JSON.stringify({ id: existing?.id, name: name.trim(), groupName: groupName.trim() || 'General', plannedDay, emoji: emoji.trim() || 'dumbbell', ex: plain })
    api('/api/admin/presets', { method: existing ? 'PUT' : 'POST', body })
      .then(() => { toast(existing ? t('Preset updated') : t('Preset created')); close(); reload() })
      .catch(e => {
        console.error('[Presets] Failed to save preset/day', e)
        if (e.data?.error === 'ROUTINE_DAY_CONFLICT') {
          toast(t('La rutina “{0}” ya está planeada para el {1}.', e.data.routineName, t(DAYN[e.data.plannedDay])))
        } else toast(e.message)
      })
      .finally(() => setSaving(false))
  }

  const otherPrograms = programs.filter(p => p.name.toLowerCase() !== groupName.trim().toLowerCase())
  return <>
    {picker.view}
    <div hidden={picker.isOpen} className="preset-editor">
      <div className="row between">
        <h3 style={{ margin: 0 }}>{existing ? t('Editar día') : defaultGroup ? t('Nuevo día en {0}', defaultGroup) : t('Nuevo programa')}</h3>
        {!setOnBack && <button type="button" className="iconbtn" onClick={close} aria-label={t('Close')}><Icon name="xmark" /></button>}
      </div>
      <div style={{ height: 12 }} />
      <TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('Nombre del día (ej. Push Day)')} aria-label={t('Routine name')} maxLength={80} />
      <div style={{ height: 8 }} />
      <TextField value={groupName} onChange={e => setGroupName(e.target.value)} placeholder={t('Programa (ej. Push / Pull / Legs)')} aria-label={t('Grupo de rutinas')} maxLength={80} />
      {!!otherPrograms.length && <div className="chips preset-editor-groups" role="group" aria-label={t('Programas existentes')}>
        {otherPrograms.map(p => <button key={p.id || p.name} type="button" className="chip nocap" onClick={() => setGroupName(p.name)}>{p.name}</button>)}
      </div>}
      <div style={{ height: 8 }} />
      <SelectRow icon="calendar" title={t('Día planeado para hacer esta rutina')} value={plannedDay}
        options={[{ value: null, label: t('Sin día asignado') }, ...[1, 2, 3, 4, 5, 6, 0].map(day => ({ value: day, label: t(DAYN[day]) }))]}
        onChange={setPlannedDay} sheetTitle={t('Día planeado para hacer esta rutina')} picker={picker.open} />
      <div className="row" style={{ gap: 8, alignItems: 'center', margin: '10px 0' }}>
        <button className="glyph-cell on" title={t('Pick an icon')}
          onClick={() => glyphPicker(emoji, setEmoji)} aria-label={t('Pick an icon')}>
          <Icon name={glyphOf(emoji)} />
        </button>
        <span className="small muted">{t('Ícono de la rutina')}</span>
      </div>

      {!!ex.length && <div className="preset-editor-stats small muted">
        {t('{0} ejercicios · {1} series', stats.exercises, stats.sets)}
      </div>}
      {!!stats.top.length && <div className="mchips">{stats.top.slice(0, 6).map(m => <span key={m} className="mchip">{t(MUSCLE_NAME[m] || m)}</span>)}</div>}

      <div className="preset-ex-list">
        {drag.order.map(k => {
          const item = ex.find(x => x._k === k)
          if (!item) return null
          return <div key={k} ref={drag.rowRef(k)} className={'preset-ex' + (drag.draggingId === k ? ' dragging' : '')}>
            <span className="drag-handle" role="button" tabIndex={0} aria-label={t('Mover {0}', exerciseNameFor(exOr(item.id)))} {...drag.handleProps(k)}><Icon name="grip" /></span>
            <button type="button" className="grow preset-ex-main" onClick={() => edit(item)}>
              <div className="tt">{exerciseNameFor(exOr(item.id))}</div>
              <div className="ss">{exLine(item, 'kg')}{INTENSIFIER_LABEL[item.intensifier?.type] ? ' · ' + t(INTENSIFIER_LABEL[item.intensifier.type]) : ''}</div>
            </button>
            <button className="iconbtn" aria-label={t('Remove exercise')} onClick={() => setEx(current => current.filter(x => x._k !== k))}><Icon name="trash" /></button>
          </div>
        })}
        {!ex.length && <div className="dim small" style={{ padding: '8px 2px' }}>{t('Todavía sin ejercicios.')}</div>}
      </div>
      <Button icon="plus" onClick={() => exercisePicker(add)}>{t('Add exercise')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="primary" disabled={saving} onClick={save}>{t('Save preset')}</Button>
    </div>
  </>
}
