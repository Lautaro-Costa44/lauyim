import { useMemo, useState } from 'react'
import { t } from '../../lib/i18n.js'
import { glyphOf } from '../../lib/glyphs.js'
import { fmtDate, fmtNum, fmtDur, durPart, MONTHS_LONG } from '../../lib/format.js'
import { setsDone } from '../../lib/history.js'
import { filterWorkouts, groupByMonth, isClassWorkout } from '../../lib/workout-history.js'
import { useDesktop } from '../../views/admin/useDesktop.js'
import Icon from '../Icon.jsx'
import { Segmented, SelectRow, TextField } from '../ui.jsx'
import { exerciseName } from './WorkoutDetailView.jsx'

// Historial agrupado por mes (con totales en la unidad del socio), filtros por rutina y por
// ejercicio, y "Ver más" de a PAGE entrenos. Lo usan "mis entrenos" y el detalle de un socio.
//
// data: { workouts, routines, unit, names? }
export const PAGE = 30

export function HistoryRow({ w, routines, unit, selected, onClick }) {
  if (isClassWorkout(w)) return <button type="button" className={'item wh-row' + (selected ? ' on' : '')} onClick={onClick} aria-current={selected || undefined}>
    <span className="lrow-i wh-icon"><Icon name="calendar" /></span>
    <span className="grow"><span className="tt">{w.name} <span className="tag nocap">{t('Clase')}</span></span>
      <span className="ss">{[fmtDate(w.d, true), ...durPart((w.end || w.start) - w.start), w.teacher ? t('con {0}', w.teacher) : null].filter(Boolean).join(' · ')}</span></span>
    <Icon name="chevronRight" className="chev" />
  </button>
  const glyph = glyphOf((routines.find(r => r.id === w.routineId) || {}).emoji)
  return <button type="button" className={'item wh-row' + (selected ? ' on' : '')} onClick={onClick} aria-current={selected || undefined}>
    <span className="lrow-i wh-icon"><Icon name={glyph} /></span>
    <span className="grow"><span className="tt">{w.name}</span>
      <span className="ss">{[fmtDate(w.d, true), ...durPart((w.end || w.start) - w.start), t('{0} sets', setsDone(w)), fmtNum(w.vol || 0) + ' ' + unit].join(' · ')}</span></span>
    {w.prs && w.prs.length > 0 && <span className="pr"><Icon name="trophy" />{w.prs.length} PR</span>}
    <Icon name="chevronRight" className="chev" />
  </button>
}

// data.live: clases en curso del socio (renglón "Ahora", arriba); onOpenLive abre su hoja.
export default function WorkoutHistoryList({ data, selectedId, onOpen, onOpenLive, picker }) {
  const desktop = useDesktop()
  const [routineId, setRoutineId] = useState(null)
  const [kind, setKind] = useState('all')
  // Todo / Entrenamientos / Clases: si hay clases en el gimnasio o en su historial.
  const showKinds = !!data.classesOn || (data.workouts || []).some(isClassWorkout)
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
  const filtered = useMemo(() => filterWorkouts(data.workouts, { routineId, query, kind, nameOf: e => exerciseName(e, data.names) }),
    [data.workouts, routineId, query, kind, data.names])
  const groups = useMemo(() => groupByMonth(filtered.slice().sort((a, b) => (b.start || 0) - (a.start || 0)).slice(0, shown)), [filtered, shown])
  const pick = id => { setRoutineId(id); setShown(PAGE) }
  const monthLabel = key => { const [y, m] = key.split('-').map(Number); return `${t(MONTHS_LONG[m - 1])} ${y}` }

  const live = kind === 'workouts' ? [] : (data.live || [])
  const liveSection = live.length > 0 && <section className="wh-month wh-live">
    <h4 className="wh-month-h"><span>{t('Ahora')}</span></h4>
    <div className="list">{live.map(o => <button key={o.key} type="button" className="item wh-row" onClick={() => onOpenLive && onOpenLive(o)}>
      <span className="class-bar" style={{ background: o.color }} aria-hidden="true" />
      <span className="grow"><span className="tt">{o.name} <span className="tag nocap class-tag-live">{t('En curso')}</span></span>
        <span className="ss">{[`${o.start}–${o.end}`, o.teacherName && t('con {0}', o.teacherName), o.room].filter(Boolean).join(' · ')}</span></span>
      <Icon name="chevronRight" className="chev" />
    </button>)}</div>
  </section>
  if (!(data.workouts || []).length) return live.length ? <div className="wh">{liveSection}<div className="empty small">{t('Cuando termine, se suma acá.')}</div></div>
    : <div className="empty"><div className="ico"><Icon name="history" /></div>{t('No workouts yet.')}</div>
  return <div className="wh">
    <div className="wh-filters">
      {showKinds && <Segmented options={[{ value: 'all', label: t('Todo') }, { value: 'workouts', label: t('Entrenamientos') }, { value: 'classes', label: t('Clases') }]}
        value={kind} onChange={v => { setKind(v); setShown(PAGE) }} />}
      <TextField value={query} onChange={e => { setQuery(e.target.value); setShown(PAGE) }} placeholder={t('Buscar ejercicio')} aria-label={t('Buscar ejercicio')} />
      {usedRoutines.length > 1 && (desktop
        ? <div className="sect-b wh-select"><SelectRow title={t('Rutina')} value={routineId || ''} sheetTitle={t('Rutina')} picker={picker}
          onChange={v => pick(v || null)} options={[{ value: '', label: t('Todas') }, ...usedRoutines.map(r => ({ value: r.id, label: r.name || t('Rutina') }))]} /></div>
        : <div className="chips wh-chips" role="group" aria-label={t('Rutina')}>
          <button type="button" className={'chip nocap' + (!routineId ? ' on' : '')} aria-pressed={!routineId} onClick={() => pick(null)}>{t('Todas')}</button>
          {usedRoutines.map(r => <button key={r.id} type="button" className={'chip nocap' + (routineId === r.id ? ' on' : '')} aria-pressed={routineId === r.id} onClick={() => pick(r.id)}>{r.name || t('Rutina')}</button>)}
        </div>)}
    </div>
    {liveSection}
    {!filtered.length ? !live.length && <div className="empty small">{t('Ningún entreno coincide con el filtro.')}</div> : <>
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
