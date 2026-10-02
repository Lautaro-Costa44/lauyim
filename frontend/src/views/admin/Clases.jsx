// Admin → Clases: el calendario (la semana en PC, un día por vez en el celular), los números de la
// semana y, con "Clases y horarios", crear clases, clases sueltas y la lista para editar o
// archivar. El owner tiene además los ajustes. Quien solo toma lista ve sus clases.
import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { capacityText, timeRange, addDays, weekdayOf, shortDay, classesApi } from '../../lib/classes.js'
import { useAdmin } from './context.js'
import { useDesktop } from './useDesktop.js'
import { Button } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { classEditorSheet } from './clases/ClassEditor.jsx'
import { sessionSheet, looseClassSheet, classSettingsSheet } from './clases/SessionSheet.jsx'

const ui = () => useUI.getState()
const toMin = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
// Lunes de la semana de una fecha.
export const mondayOf = date => addDays(date, -((weekdayOf(date) + 6) % 7))
const PX_PER_MIN = 0.9

// Horas que muestra la grilla: de la clase más temprana a la más tarde (al menos 8 a 21).
export function gridHours(occurrences) {
  let from = 8 * 60, to = 21 * 60
  for (const o of occurrences) { from = Math.min(from, toMin(o.start)); to = Math.max(to, toMin(o.start) + Math.max(30, toMin(o.end) - toMin(o.start))) }
  return { from: Math.floor(from / 60) * 60, to: Math.ceil(to / 60) * 60 }
}

export default function AdminClases() {
  const user = useStore(s => s.user)
  const { users } = useAdmin() || {}
  const desktop = useDesktop()
  const [week, setWeek] = useState(null)        // lunes de la semana visible
  const [day, setDay] = useState(null)          // día visible en el celular
  const [data, setData] = useState(null)
  const [types, setTypes] = useState(null)

  const load = (from = week) => classesApi.calendar(from || '', 7).then(d => {
    setData(d)
    if (!from) { const monday = mondayOf(d.today); setWeek(monday); setDay(d.today); if (monday !== d.from) return classesApi.calendar(monday, 7).then(setData) }
  }).catch(e => ui().toast(errorText(e, t('Failed to load'))))
  const loadTypes = () => classesApi.types().then(setTypes).catch(() => {})
  useEffect(() => { load(null); loadTypes() }, [])

  if (!data || !week) return <div className="page-loading" aria-busy="true" />
  const canManage = data.canManage
  const canCreate = canManage || data.canOwn
  const reload = () => { load(week); loadTypes() }
  const goWeek = n => { const w = addDays(week, 7 * n); setWeek(w); setDay(addDays(day, 7 * n)); load(w) }
  const goToday = () => { const w = mondayOf(data.today); setWeek(w); setDay(data.today); load(w) }
  const goDay = n => {
    const next = addDays(day, n)
    setDay(next)
    if (next < week || next >= addDays(week, 7)) { const w = mondayOf(next); setWeek(w); load(w) }
  }
  const teachers = types?.teachers || []
  const openOcc = occ => sessionSheet(occ, { canManage, users, teachers, onChange: reload })
  const editType = type => classEditorSheet({ type, slots: (types?.slots || []).filter(s => s.classId === type?.id), teachers, canManage, me: types?.me, allowOverlap: types?.settings?.allowOverlap, onSaved: reload })
  const editable = (types?.types || []).filter(tp => tp.editable)
  const listTypes = () => ui().openSheet(close => <TypeList types={types?.types || []} onEdit={tp => { close(); editType(tp) }} onArchived={() => { close(); reload() }} close={close} />, { kind: 'panel' })

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const s = data.summary
  return <div className="admin-classes">
    <div className="card">
      <div className="class-admin-head">
        <h2>{t('Clases')}</h2>
        <div className="class-admin-actions">
          {canCreate && <Button size="sm" variant="primary" icon="plus" onClick={() => editType(null)}>{t('Nueva clase')}</Button>}
          {canCreate && editable.length > 0 && <Button size="sm" icon="calendar" onClick={() => looseClassSheet({ types: editable, today: data.today, onChange: reload })}>{t('Clase suelta')}</Button>}
          {editable.length > 0 && <Button size="sm" icon="list" onClick={listTypes}>{canManage ? t('Clases') : t('Mis clases')}</Button>}
          <Button size="sm" icon="chart" onClick={classStatsSheet}>{t('Estadísticas')}</Button>
          {user?.owner && <Button size="sm" icon="gear" onClick={() => classSettingsSheet({ onChange: reload })}>{t('Ajustes')}</Button>}
        </div>
      </div>
      {!data.settings?.enabled && <div className="access-warn small" role="note" style={{ marginTop: 10 }}>{t('Las clases están apagadas: los socios no las ven. Prendelas en Ajustes.')}</div>}
      <div className="class-stats">
        <div><b>{s.classes}</b><span>{t('clases')}</span></div>
        <div><b>{s.occupancy}%</b><span>{t('ocupación')}</span></div>
        <div><b>{s.lateCancels}</b><span>{t('cancelaciones tardías')}</span></div>
        <div><b>{s.waitlist}</b><span>{t('en lista de espera')}</span></div>
      </div>
    </div>

    <div className="row between class-weeknav">
      <button className="iconbtn" onClick={() => desktop ? goWeek(-1) : goDay(-1)} aria-label={desktop ? t('Semana anterior') : t('Día anterior')}><Icon name="chevronLeft" /></button>
      <div className="row" style={{ gap: 8 }}>
        <b>{desktop ? `${shortDay(days[0])} – ${shortDay(days[6])}` : (day === data.today ? t('Hoy') : shortDay(day))}</b>
        {(desktop ? week !== mondayOf(data.today) : day !== data.today) && <Button size="sm" variant="plain" onClick={goToday}>{t('Hoy')}</Button>}
      </div>
      <button className="iconbtn" onClick={() => desktop ? goWeek(1) : goDay(1)} aria-label={desktop ? t('Semana siguiente') : t('Día siguiente')}><Icon name="chevronRight" /></button>
    </div>

    {data.occurrences.length === 0 && !types?.types?.length
      ? <div className="empty">{canCreate ? t('Todavía no hay clases. Creá la primera con "Nueva clase".') : t('No tenés clases asignadas.')}</div>
      : desktop ? <WeekGrid days={days} today={data.today} occurrences={data.occurrences} onOpen={openOcc} />
      : <DayList occurrences={data.occurrences.filter(o => o.date === day)} onOpen={openOcc} />}
  </div>
}

function Block({ occ, onOpen, style }) {
  return <button type="button" className={'class-block' + (occ.cancelled ? ' cancelled' : '')} style={{ '--c': occ.color, ...style }} onClick={() => onOpen(occ)}
    aria-label={`${occ.name} ${timeRange(occ)}`}>
    <span className="class-block-time">{occ.start} <span className="class-block-cap">· {capacityText(occ.booked, occ.capacity)}{occ.waitlist ? ` +${occ.waitlist}` : ''}</span></span>
    <span className="class-block-name">{occ.name}</span>
  </button>
}

function WeekGrid({ days, today, occurrences, onOpen }) {
  const { from, to } = gridHours(occurrences)
  const hours = Array.from({ length: (to - from) / 60 }, (_, i) => from + i * 60)
  const height = (to - from) * PX_PER_MIN
  return <div className="class-week card">
    <div className="class-week-head"><span />{days.map(d => <span key={d} className={d === today ? 'today' : ''}>{shortDay(d)}</span>)}</div>
    <div className="class-week-body" style={{ height }}>
      <div className="class-week-hours">{hours.map(h => <span key={h} style={{ top: (h - from) * PX_PER_MIN }}>{String(h / 60).padStart(2, '0')}:00</span>)}</div>
      {days.map(d => <div key={d} className={'class-week-col' + (d === today ? ' today' : '')}>
        {hours.map(h => <span key={h} className="class-week-line" style={{ top: (h - from) * PX_PER_MIN }} />)}
        {occurrences.filter(o => o.date === d).map(o => {
          const top = (toMin(o.start) - from) * PX_PER_MIN
          const len = Math.max(30, toMin(o.end) - toMin(o.start))
          return <Block key={o.key} occ={o} onOpen={onOpen} style={{ top, height: len * PX_PER_MIN - 2 }} />
        })}
      </div>)}
    </div>
  </div>
}

function DayList({ occurrences, onOpen }) {
  if (!occurrences.length) return <div className="empty">{t('No hay clases este día.')}</div>
  return <div className="list">
    {occurrences.map(o => <button key={o.key} type="button" className={'item class-item' + (o.cancelled ? ' cancelled' : '')} onClick={() => onOpen(o)}>
      <span className="class-bar" style={{ background: o.color }} aria-hidden="true" />
      <div className="grow">
        <div className="class-time">{timeRange(o)}</div>
        <div className="tt">{o.name}</div>
        <div className="ss">{[o.teacherName, o.room].filter(Boolean).join(' · ')}</div>
      </div>
      <span className="tag">{capacityText(o.booked, o.capacity)}{o.waitlist ? ` +${o.waitlist}` : ''}</span>
    </button>)}
  </div>
}

function TypeList({ types, onEdit, onArchived, close }) {
  const archive = tp => import('../../sheets.jsx').then(({ confirmSheet }) => confirmSheet({
    title: t('¿Archivar {0}?', tp.name),
    message: t('Deja de tener horario y reservas. Las próximas fechas con anotados se suspenden con aviso. Quien ya fue la sigue viendo en su historial.'),
    confirmText: t('Archivar'), danger: true,
    onConfirm: async () => {
      try { await classesApi.archiveType(tp.id); ui().toast(t('Clase archivada')); onArchived() } catch (e) { ui().toast(errorText(e, t('No se pudo archivar'))) }
    }
  }))
  return <div>
    <h3>{t('Clases')}</h3>
    {types.length === 0 ? <div className="dim small">{t('Todavía no hay clases.')}</div>
      : <div className="list">{types.map(tp => <div key={tp.id} className="item">
          <span className="class-dot" style={{ background: tp.color }} aria-hidden="true" />
          <div className="grow"><div className="tt">{tp.name}</div><div className="ss">{[tp.teacherName, tp.room, `${tp.durationMin} min`, tp.capacity == null ? t('sin cupo') : t('cupo {0}', tp.capacity)].filter(Boolean).join(' · ')}</div></div>
          {tp.editable && <button type="button" className="iconbtn" aria-label={t('Editar {0}', tp.name)} onClick={() => onEdit(tp)}><Icon name="pencil" /></button>}
          {tp.editable && <button type="button" className="iconbtn" aria-label={t('Archivar {0}', tp.name)} onClick={() => archive(tp)}><Icon name="trash" /></button>}
        </div>)}</div>}
    <div style={{ height: 10 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cerrar')}</Button>
  </div>
}

// Estadísticas de clases: por clase, por profe y por bloque (4 o 12 semanas). Las calificaciones
// son promedios de quienes calificaron.
const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
function StatsView({ close }) {
  const [weeks, setWeeks] = useState(4)
  const [data, setData] = useState(null)
  useEffect(() => { setData(null); classesApi.stats(weeks).then(setData).catch(e => ui().toast(errorText(e, t('Failed to load')))) }, [weeks])
  const rating = r => r.rating == null ? t('Sin calificaciones') : `★ ${r.rating} (${r.ratings})`
  return <div className="class-stats-view">
    <h3>{t('Estadísticas de clases')}</h3>
    <div className="chips" role="group">{[4, 12].map(w => <button key={w} type="button" className={'chip nocap' + (weeks === w ? ' on' : '')} onClick={() => setWeeks(w)}>{t('{0} semanas', w)}</button>)}</div>
    {!data ? <div className="dim small">{t('Loading…')}</div> : <>
      <h4 className="sec">{t('Por clase')}</h4>
      {data.classes.length === 0 ? <div className="dim small">{t('Todavía no hay clases dadas en este período.')}</div>
        : <div className="list">{data.classes.map(c => <div key={c.classId} className="item">
            <span className="class-dot" style={{ background: c.color }} aria-hidden="true" />
            <div className="grow"><div className="tt">{c.name}</div>
              <div className="ss">{[t('{0} fechas', c.sessions), t('{0}% ocupación', c.occupancy), t('{0} presentes', c.present), t('{0} ausentes', c.absent), t('{0} tardías', c.lateCancels)].join(' · ')}</div></div>
            <span className="tag nocap">{rating(c)}</span>
          </div>)}</div>}
      {data.teachers.length > 0 && <>
        <h4 className="sec">{t('Por profe')}</h4>
        <div className="list">{data.teachers.map(p => <div key={p.name} className="item">
          <div className="grow"><div className="tt">{p.name}</div><div className="ss">{[t('{0} clases', p.sessions), t('{0}% ocupación', p.occupancy)].join(' · ')}</div></div>
          <span className="tag nocap">{rating(p)}</span>
        </div>)}</div>
      </>}
      {data.slots.length > 0 && <>
        <h4 className="sec">{t('Por día y hora')}</h4>
        <div className="class-slot-stats">{data.slots.map(s => <div key={s.weekday + s.start} className="class-slot-stat" style={{ '--occ': s.occupancy / 100 }}>
          <b>{WEEKDAY_SHORT[s.weekday]} {s.start}</b><span>{s.occupancy}%{s.withWaitlist ? ' · ' + t('lista de espera {0}', s.withWaitlist) : ''}</span>
        </div>)}</div>
      </>}
    </>}
    <div style={{ height: 10 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cerrar')}</Button>
  </div>
}
export const classStatsSheet = () => ui().openSheet(close => <StatsView close={close} />, { kind: 'panel' })
