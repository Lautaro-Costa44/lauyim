// La hoja de un día (semana de Inicio y calendario). Pasado: registrar lo que se hizo, sin borrar
// nunca nada (para borrar, el detalle del entreno, que confirma). Hoy: registrar y planificar.
// Futuro: solo planificar. Planificar (rutina, descanso, volver al plan) solo cambia dayPlan.
import { useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { fmtDate, fmtVol, durPart, todayISO, uid, exCount } from '../../lib/format.js'
import { effectiveRoutineId, setsDone } from '../../lib/history.js'
import { isClassWorkout } from '../../lib/workout-history.js'
import { buildMarkedWorkout, dayMode, putWorkout } from '../../lib/marked-workout.js'
import { useMyClasses } from '../useMyClasses.js'
import { classesByDate } from '../../lib/classes.js'
import { classSheet } from '../ClassSheet.jsx'
import { glyphOf } from '../../lib/glyphs.js'
import { Button } from '../ui.jsx'
import Icon from '../Icon.jsx'
import { markedEditorSheet } from './MarkedWorkoutEditor.jsx'

const update = (...a) => useStore.getState().update(...a)
const toast = m => useUI.getState().toast(m)
// sheets.jsx importa este archivo: el detalle de un entreno se trae al usarlo, sin ciclo.
export const openWorkout = w => import('../../sheets.jsx').then(({ workoutDetailSheet }) => workoutDetailSheet(w))

// Las clases de ese día (hechas o reservadas): tocar una abre su detalle.
export function DayClasses({ classes, myClasses, close }) {
  if (!classes.length) return null
  const open = c => {
    close()
    if (c.workout) openWorkout(c.workout)
    else classSheet(c.occ, { today: myClasses?.today, tz: myClasses?.tz, cancelHours: myClasses?.settings?.cancelHours ?? 2 })
  }
  return <div className="list day-classes">{classes.map(c => <div key={c.key} className="item" role="button" tabIndex={0} onClick={() => open(c)}>
    <span className="class-bar" style={{ background: c.color || 'var(--acc)' }} aria-hidden="true" />
    <div className="grow"><div className="tt">{c.name}</div>
      <div className="ss">{[c.start, c.done ? t('Hecha') : c.waitlist ? t('En espera') : t('Anotado')].filter(Boolean).join(' · ')}</div></div>
    {c.done && <Icon name="checkCircle" className="accent" />}
    <Icon name="chevronRight" className="chev" />
  </div>)}</div>
}

// Qué rutina toca ese día. Elegir rutina, descanso o volver al plan solo cambia dayPlan.
export function DayPlanSection({ iso, close, heading = null }) {
  const st = useStore(s => s.S)
  const wd = new Date(iso + 'T12:00:00').getDay()
  const weeklyR = st.routines.find(r => r.id === st.week[wd])
  const ovVal = st.dayPlan[iso]
  const ovr = ovVal !== undefined
  const effId = effectiveRoutineId(st, iso)
  const currentStatus = typeof ovVal === 'object' && ovVal ? ovVal.estado : (ovVal === 'rest' ? 'descanso' : (typeof ovVal === 'string' && ovVal ? 'rutina' : null))
  const currentRoutineId = typeof ovVal === 'object' && ovVal ? ovVal.rutinaId : (typeof ovVal === 'string' && ovVal !== 'rest' ? ovVal : effId)

  const setEstado = (nuevoEstado, rutinaId = null) => {
    update(s => {
      if (!nuevoEstado) delete s.dayPlan[iso]
      else s.dayPlan[iso] = { fecha: iso, estado: nuevoEstado, rutinaId: nuevoEstado === 'rutina' ? rutinaId : null }
    })
    close()
    if (!nuevoEstado) toast(t('Back to weekly plan'))
    else if (nuevoEstado === 'descanso') toast(t('{0} set to rest', fmtDate(iso)))
    else if (nuevoEstado === 'rutina') toast(t('{0} planned for {1}', (st.routines.find(r => r.id === rutinaId) || {}).name, fmtDate(iso)))
  }

  return <div className="day-plan">
    {heading && <h4 className="sec">{heading}</h4>}
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Weekly plan:')} {weeklyR ? weeklyR.name : t('Rest')}{ovr && <span style={{ color: 'var(--orange)' }}> · {t('changed for this day')}</span>}<br />{t('Sick, missed a day or want a different session? Pick what to train instead.')}</div>
    <div className="list">
      {st.routines.map(r => <div key={r.id} className="item" onClick={() => setEstado('rutina', r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {currentStatus === 'rutina' && currentRoutineId === r.id && <Icon name="check" className="accent" />}</div>)}
      <div className="item" onClick={() => setEstado('descanso')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest / skip this day')}</div></div>{currentStatus === 'descanso' && <Icon name="check" className="accent" />}</div>
      {ovr && <div className="item" onClick={() => setEstado(null)}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="reset" /></span><div className="grow"><div className="tt">{t('Back to weekly plan')}</div></div></div>}
    </div>
  </div>
}

const FREE = '__free'
// Lo que tocaba ese día según el plan. Un "completado" viejo (antes el marcado lo escribía en
// dayPlan) no dice qué tocaba: se mira la semana.
function plannedRoutine(S, iso) {
  const ov = S.dayPlan[iso]
  const id = ov && typeof ov === 'object' && ov.estado === 'completado'
    ? S.week[new Date(iso + 'T12:00:00').getDay()]
    : effectiveRoutineId(S, iso)
  return S.routines.find(r => r.id === id) || null
}

// "¿Entrenaste?": marcar el día (sin series) o pasar a cargarlas. "No entrené" no escribe nada.
// onCancel: el día ya tiene entrenos y esto es "agregar otro": en vez de "No entrené", Cancelar.
function MarkStep({ iso, planned, close, onCancel = null }) {
  const st = useStore(s => s.S)
  const [did, setDid] = useState(false)
  const [pick, setPick] = useState(planned ? planned.id : null)   // id de rutina | FREE | null
  const routine = pick && pick !== FREE ? st.routines.find(r => r.id === pick) || null : null
  const mark = () => {
    const w = buildMarkedWorkout(iso, { routine, name: routine ? routine.name : t('Freestyle') }, { id: uid() })
    update(s => { putWorkout(s.workouts, w) })
    close()
    toast(t('Marcado como entrenado'))
  }
  const loadSets = () => { close(); markedEditorSheet({ iso, routine }) }
  const options = [...st.routines.map(r => ({ id: r.id, name: r.name })), { id: FREE, name: t('Otra cosa') }]
  return <div className="day-mark">
    <div className="day-mark-q">
      <button type="button" className={'day-mark-btn' + (did ? ' on' : '')} aria-pressed={did} onClick={() => setDid(true)}><Icon name="check" />{t('Entrené')}</button>
      <button type="button" className="day-mark-btn" onClick={onCancel || close}>{onCancel ? t('Cancelar') : t('No entrené')}</button>
    </div>
    {did && <>
      <h4 className="sec">{t('¿Qué entrenaste?')}</h4>
      <div className="chips">{options.map(o => <button key={o.id} type="button" className={'chip nocap' + (pick === o.id ? ' on' : '')}
        aria-pressed={pick === o.id} onClick={() => setPick(o.id)}>{o.name}</button>)}</div>
      {pick && <div className="day-mark-card"><b>{routine ? routine.name : t('Otra cosa')}</b>
        <div className="small muted">{[routine ? exCount(routine.ex.length) : null, t('cuenta para tu racha')].filter(Boolean).join(' · ')}</div></div>}
      <Button variant="primary" disabled={!pick} onClick={mark}>{t('Marcar como entrenado')}</Button>
      <Button variant="plain" icon="plus" disabled={!pick} onClick={loadSets}>{t('Cargar series (opcional)')}</Button>
    </>}
  </div>
}

// Un entreno del día: tocarlo abre su detalle. Uno marcado ofrece cargar (o editar) sus series.
function DayWorkoutCard({ w, close }) {
  const st = useStore(s => s.S)
  const n = setsDone(w)
  const sub = w.marked
    ? (n ? (n === 1 ? t('1 serie') : t('{0} series', n)) : t('Sin series · cuenta para tu racha'))
    : [...durPart(w.end - w.start), t('{0} sets', n), fmtVol(w.vol, st.unit)].join(' · ')
  const routine = st.routines.find(r => r.id === w.routineId) || null
  return <div className="item day-workout">
    <div className="grow" role="button" tabIndex={0} onClick={() => { close(); openWorkout(w) }}>
      <div className="tt">{w.name} <span className={'tag nocap' + (w.marked ? '' : ' acc')}>{w.marked ? t('Marcado') : t('Entrenado')}</span></div>
      <div className="ss">{sub}</div>
    </div>
    {w.marked && <Button size="sm" variant="plain" icon="plus" onClick={() => { close(); markedEditorSheet({ iso: w.d, routine, workout: w }) }}>{n ? t('Editar series') : t('Cargar series')}</Button>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

export function DaySheet({ iso, close }) {
  const st = useStore(s => s.S)
  const myClasses = useMyClasses()
  const mode = dayMode(iso, todayISO())
  const dayClasses = classesByDate(myClasses?.occurrences, st.workouts)[iso] || []
  const dayWorkouts = st.workouts.filter(w => w.d === iso && !isClassWorkout(w))
  const planned = plannedRoutine(st, iso)
  const [adding, setAdding] = useState(false)
  const nothing = !dayWorkouts.length && !dayClasses.length
  return <div className="day-sheet">
    <h3>{fmtDate(iso, true)}</h3>
    {mode !== 'future' && <>
      <div className="muted small day-tocaba">{planned ? t('Tocaba: {0}', planned.name) : t('Tocaba: descanso')}</div>
      {!nothing && <>
        <h4 className="sec" style={{ marginTop: 0 }}>{mode === 'today' ? t('Hoy') : t('Ese día')}</h4>
        {dayWorkouts.length > 0 && <div className="list day-workouts">{dayWorkouts.map(w => <DayWorkoutCard key={w.id} w={w} close={close} />)}</div>}
        <DayClasses classes={dayClasses} myClasses={myClasses} close={close} />
      </>}
      {nothing || adding
        ? <MarkStep iso={iso} planned={planned} close={close} onCancel={nothing ? null : () => setAdding(false)} />
        : <Button variant="plain" icon="plus" className="day-add" onClick={() => setAdding(true)}>{t('Agregar otro entrenamiento')}</Button>}
    </>}
    {mode === 'future' && dayClasses.length > 0 && <>
      <h4 className="sec" style={{ marginTop: 0 }}>{t('Clases de este día')}</h4>
      <DayClasses classes={dayClasses} myClasses={myClasses} close={close} />
    </>}
    {mode !== 'past' && <DayPlanSection iso={iso} close={close}
      heading={mode === 'today' ? t('Planificar hoy') : dayClasses.length ? t('Rutina de este día') : null} />}
  </div>
}
