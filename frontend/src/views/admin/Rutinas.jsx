import { useState } from 'react'
import { useAdmin } from './context.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { DAYN } from '../../lib/format.js'
import { confirmSheet, exercisePicker, exConfigSheet, glyphPicker } from '../../sheets.jsx'
import { exOr } from '../../lib/exercises.js'
import { exLine } from '../../lib/history.js'
import { glyphOf } from '../../lib/glyphs.js'
import { t, exerciseNameFor } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button, TextField, SelectRow, Segmented } from '../../components/ui.jsx'

function PresetEditor({ existing, close, reload }) {
  const [name, setName] = useState(existing?.name || '')
  const [groupName, setGroupName] = useState(existing ? (existing.group_name || existing.groupName || 'General') : '')
  const [plannedDay, setPlannedDay] = useState(existing?.planned_day ?? null)
  const [emoji, setEmoji] = useState(existing?.emoji || 'dumbbell')
  const [ex, setEx] = useState(() => (existing?.ex || []).map(item => ({ ...item })))
  const toast = useUI(s => s.toast)
  const add = exercise => exConfigSheet(exercise, null, cfg => setEx(current => [...current, { id: exercise.id, ...cfg }]), null, { ex })
  const save = () => {
    if (!name.trim()) return toast(t('Give the routine a name'))
    const body = JSON.stringify({ id: existing?.id, name: name.trim(), groupName: groupName.trim() || 'General', plannedDay, emoji: emoji.trim() || 'dumbbell', ex })
    api(existing ? '/api/admin/presets' : '/api/admin/presets', { method: existing ? 'PUT' : 'POST', body })
      .then(() => { toast(existing ? t('Preset updated') : t('Preset created')); close(); reload() })
      .catch(e => {
        console.error('[Presets] Failed to save preset/day', e)
        if (e.data?.error === 'ROUTINE_DAY_CONFLICT') {
          toast(t('La rutina “{0}” ya está planeada para el {1}.', e.data.routineName, t(DAYN[e.data.plannedDay])))
        } else toast(e.message)
      })
  }
  return <>
    <h3>{existing ? t('Edit preset') : t('New preset')}</h3>
    <TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('Routine name')} maxLength={80} />
    <div style={{ height: 8 }} />
    <TextField value={groupName} onChange={e => setGroupName(e.target.value)} placeholder={t('Grupo de rutinas')} maxLength={80} />
    <div style={{ height: 8 }} />
    <SelectRow icon="calendar" title={t('Día planeado para hacer esta rutina')} value={plannedDay}
      options={[{ value: null, label: t('Sin día asignado') }, ...[1, 2, 3, 4, 5, 6, 0].map(day => ({ value: day, label: t(DAYN[day]) }))]}
      onChange={setPlannedDay} sheetTitle={t('Día planeado para hacer esta rutina')} />
    <div className="row" style={{ gap: 8, alignItems: 'center', margin: '10px 0' }}>
      <button className="glyph-cell on" title={t('Pick an icon')}
        onClick={() => glyphPicker(emoji, setEmoji)} aria-label={t('Pick an icon')}>
        <Icon name={glyphOf(emoji)} />
      </button>
      <span className="small muted">{t('Ícono de la rutina')}</span>
    </div>
    <div className="list" style={{ margin: '12px 0' }}>
      {ex.map((item, index) => <div className="item" key={index}>
        <div className="grow"><div className="tt">{exerciseNameFor(exOr(item.id))}</div><div className="ss">{exLine(item, 'kg')}</div></div>
        <button className="iconbtn" aria-label={t('Remove exercise')} onClick={() => setEx(current => current.filter((_, i) => i !== index))}><Icon name="trash" /></button>
      </div>)}
    </div>
    <Button icon="plus" onClick={() => exercisePicker(add)}>{t('Add exercise')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="primary" onClick={save}>{t('Save preset')}</Button>
  </>
}

function PresetsCard({ presets, openSheet, reload }) {
  const toast = useUI(s => s.toast)
  const [groupFilter, setGroupFilter] = useState('all')
  const remove = preset => confirmSheet({
    title: t('Delete {0}?', preset.name), message: t('This removes it from the preset catalog. Existing user routines are unchanged.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => api('/api/admin/presets/delete', { method: 'POST', body: JSON.stringify({ id: preset.id }) })
      .then(() => { toast(t('Preset deleted')); reload() }).catch(e => toast(e.message))
  })
  const groups = [...new Set((presets || []).map(p => String(p.group_name || 'General').trim() || 'General'))].sort((a, b) => a.localeCompare(b))
  const visiblePresets = (presets || []).filter(p => groupFilter === 'all' || (String(p.group_name || 'General').trim() || 'General') === groupFilter)
  const grouped = visiblePresets.reduce((acc, preset) => {
    const group = String(preset.group_name || 'General').trim() || 'General'
    if (!acc[group]) acc[group] = []
    acc[group].push(preset)
    return acc
  }, {})
  const groupEntries = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))
  const groupOptions = [{ value: 'all', label: t('Todas') }, ...groups.map(group => ({ value: group, label: group }))]
  const selectGroup = value => {
    try { setGroupFilter(value) }
    catch (e) { console.error('[Presets] Failed to filter by group', e) }
  }
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Preset routines')}</h2>
      <Button variant="primary" size="sm" icon="plus" onClick={() => openSheet(close => <PresetEditor close={close} reload={reload} />)}>{t('New')}</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{t('Templates available from the starter plan action.')}</div>
    {!!groups.length && <div style={{ overflowX: 'auto', margin: '0 -2px 10px', paddingBottom: 2 }}>
      <Segmented options={groupOptions} value={groupFilter} onChange={selectGroup} />
    </div>}
    {groupEntries.map(([group, items], groupIndex) => <div key={group} style={{ borderTop: groupIndex ? '1px solid var(--sep)' : undefined, paddingTop: groupIndex ? 12 : 0, marginTop: groupIndex ? 10 : 0 }}>
      <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>{group}:</div>
      {items.map(preset => <div key={preset.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{preset.name}</div><div className="dim" style={{ fontSize: '.72rem' }}>{preset.ex.length} {t('exercises')}</div></div>
        <div className="row" style={{ gap: 4 }}>
          <button className="iconbtn" aria-label={t('Edit preset')} onClick={() => openSheet(close => <PresetEditor existing={preset} close={close} reload={reload} />)}><Icon name="pencil" /></button>
          <button className="iconbtn" aria-label={t('Delete')} style={{ color: 'var(--red)' }} onClick={() => remove(preset)}><Icon name="trash" /></button>
        </div>
      </div>)}
    </div>)}
    {!presets?.length && <div className="dim small">{t('No presets yet.')}</div>}
    {presets?.length && !groupEntries.length && <div className="dim small">{t('No presets in this group.')}</div>}
  </div>
}

export default function Rutinas() {
  const openSheet = useUI(s => s.openSheet)
  const { presets, loadPresets } = useAdmin()
  return <div className="admin-single"><PresetsCard presets={presets} openSheet={openSheet} reload={loadPresets} /></div>
}
