import { useMemo, useState } from 'react'
import { t } from '../../lib/i18n.js'
import { glyphOf } from '../../lib/glyphs.js'
import { fmtDate, fmtNum, fmtDur, durPart, MONTHS_LONG } from '../../lib/format.js'
import { setsDone } from '../../lib/history.js'
import { filterWorkouts, groupByMonth } from '../../lib/workout-history.js'
import { useDesktop } from '../../views/admin/useDesktop.js'
import Icon from '../Icon.jsx'
import { SelectRow, TextField } from '../ui.jsx'
import { exerciseName } from './WorkoutDetailView.jsx'

// Historial agrupado por mes (con totales en la unidad del socio), filtros por rutina y por
// ejercicio, y "Ver más" de a PAGE entrenos. Lo usan "mis entrenos" y el detalle de un socio.
//
// data: { workouts, routines, unit, names? }
export const PAGE = 30

export function HistoryRow({ w, routines, unit, selected, onClick }) {
  const glyph = glyphOf((routines.find(r => r.id === w.routineId) || {}).emoji)
  return <button type="button" className={'item wh-row' + (selected ? ' on' : '')} onClick={onClick} aria-current={selected || undefined}>
    <span className="lrow-i wh-icon"><Icon name={glyph} /></span>
    <span className="grow"><span className="tt">{w.name}</span>
      <span className="ss">{[fmtDate(w.d, true), ...durPart((w.end || w.start) - w.start), t('{0} sets', setsDone(w)), fmtNum(w.vol || 0) + ' ' + unit].join(' · ')}</span></span>
    {w.prs && w.prs.length > 0 && <span className="pr"><Icon name="trophy" />{w.prs.length} PR</span>}
    <Icon name="chevronRight" className="chev" />
  </button>
}

export default function WorkoutHistoryList({ data, selectedId, onOpen, picker }) {
  const desktop = useDesktop()
  const [routineId, setRoutineId] = useState(null)
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const unit = data.unit || 'kg'
  const routines = data.routines || []
  // Solo las rutinas que aparecen en el historial (una borrada que dejó entrenos, también).
  const usedRoutines = useMemo(() => {
    const ids = new Set((data.workouts || []).map(w => w.routineId).filter(Boolean))
    const names = new Map((data.workouts || []).filter(w => w.routineId).map(w => [w.routineId, w.name]))
    return [...ids].map(id => ({ id, name: routines.find(r => r.id === id)?.name || names.get(id) }))
  }, [data.workouts, routines])
  const filtered = useMemo(() => filterWorkouts(data.workouts, { routineId, query, nameOf: e => exerciseName(e, data.names) }),
    [data.workouts, routineId, query, data.names])
  const groups = useMemo(() => groupByMonth(filtered.slice().sort((a, b) => (b.start || 0) - (a.start || 0)).slice(0, shown)), [filtered, shown])
  const pick = id => { setRoutineId(id); setShown(PAGE) }
  const monthLabel = key => { const [y, m] = key.split('-').map(Number); return `${t(MONTHS_LONG[m - 1])} ${y}` }

  if (!(data.workouts || []).length) return <div className="empty"><div className="ico"><Icon name="history" /></div>{t('No workouts yet.')}</div>
  return <div className="wh">
    <div className="wh-filters">
      <TextField value={query} onChange={e => { setQuery(e.target.value); setShown(PAGE) }} placeholder={t('Buscar ejercicio')} aria-label={t('Buscar ejercicio')} />
      {usedRoutines.length > 1 && (desktop
        ? <div className="sect-b wh-select"><SelectRow title={t('Rutina')} value={routineId || ''} sheetTitle={t('Rutina')} picker={picker}
          onChange={v => pick(v || null)} options={[{ value: '', label: t('Todas') }, ...usedRoutines.map(r => ({ value: r.id, label: r.name || t('Rutina') }))]} /></div>
        : <div className="chips wh-chips" role="group" aria-label={t('Rutina')}>
          <button type="button" className={'chip nocap' + (!routineId ? ' on' : '')} aria-pressed={!routineId} onClick={() => pick(null)}>{t('Todas')}</button>
          {usedRoutines.map(r => <button key={r.id} type="button" className={'chip nocap' + (routineId === r.id ? ' on' : '')} aria-pressed={routineId === r.id} onClick={() => pick(r.id)}>{r.name || t('Rutina')}</button>)}
        </div>)}
    </div>
    {!filtered.length ? <div className="empty small">{t('Ningún entreno coincide con el filtro.')}</div> : <>
      {groups.map(g => <section key={g.key} className="wh-month">
        <h4 className="wh-month-h">
          <span>{monthLabel(g.key)}</span>
          <span className="wh-month-s">{[t(g.count === 1 ? '{0} entreno' : '{0} entrenos', g.count), ...(g.ms >= 60000 ? [fmtDur(g.ms)] : []), fmtNum(Math.round(g.vol)) + ' ' + unit].join(' · ')}</span>
        </h4>
        <div className="list">{g.workouts.map(w => <HistoryRow key={w.id} w={w} routines={routines} unit={unit} selected={selectedId === w.id} onClick={() => onOpen(w)} />)}</div>
      </section>)}
      {filtered.length > shown && <button type="button" className="btn wh-more" onClick={() => setShown(n => n + PAGE)}>{t('Ver más ({0})', filtered.length - shown)}</button>}
    </>}
  </div>
}
