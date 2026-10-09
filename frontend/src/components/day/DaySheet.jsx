// La hoja de un día (semana de Inicio y calendario). Pasado: registrar lo que se hizo (entrené o
// descansé) y ver lo que hay. Hoy: registrar, y planificar mientras no hayas entrenado. Futuro: solo
// planificar. Planificar (rutina, descanso, volver al plan) solo cambia dayPlan: nunca borra un
// entreno. Cada entreno del día tiene su menú (editar, borrar) y borrar siempre confirma.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { fmtDate, fmtVol, durPart, todayISO, uid, exCount } from '../../lib/format.js'
import { effectiveRoutineId, setsDone } from '../../lib/history.js'
import { isClassWorkout } from '../../lib/workout-history.js'
import { buildMarkedWorkout, dayMode, putWorkout } from '../../lib/marked-workout.js'
import { useMyClasses } from '../useMyClasses.js'
import { classesByDate } from '../../lib/classes.js'
import { closureOn } from '../../lib/closures.js'
import { useClosures } from '../../store/useClosures.js'
import { classSheet } from '../ClassSheet.jsx'
import { glyphOf } from '../../lib/glyphs.js'
import { Button } from '../ui.jsx'
import Icon from '../Icon.jsx'
import { workoutEditorSheet } from './MarkedWorkoutEditor.jsx'

const update = (...a) => useStore.getState().update(...a)
const toast = m => useUI.getState().toast(m)
// sheets.jsx importa este archivo: el detalle de un entreno y el diálogo de confirmar se traen al
// usarlos, sin ciclo.
export const openWorkout = w => import('../../sheets.jsx').then(({ workoutDetailSheet }) => workoutDetailSheet(w))
const confirm = opts => import('../../sheets.jsx').then(({ confirmSheet }) => confirmSheet(opts))
const isRest = ov => ov === 'rest' || (!!ov && typeof ov === 'object' && ov.estado === 'descanso')

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
// showWeekly: la línea "Plan semanal: …" (hoy no, porque arriba ya dice qué tocaba).
export function DayPlanSection({ iso, close, heading = null, showWeekly = true }) {
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
    <div className="muted small" style={{ marginBottom: 12 }}>
      {showWeekly && <>{t('Weekly plan:')} {weeklyR ? weeklyR.name : t('Rest')}{ovr && <span style={{ color: 'var(--orange)' }}> · {t('changed for this day')}</span>}<br /></>}
      {t('Sick, missed a day or want a different session? Pick what to train instead.')}
    </div>
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
// Lo que tocaba ese día: la rutina que se planeó para esa fecha, o la de la semana. Un descanso
// puesto después (o un "completado" viejo, que el marcado escribía en dayPlan) no dice qué tocaba.
// Si la rutina planificada para ese día ya no existe, vale la de la semana.
function plannedRoutine(S, iso) {
  const ov = S.dayPlan[iso]
  const own = ov && typeof ov === 'object' ? (ov.estado === 'rutina' ? ov.rutinaId : null) : (typeof ov === 'string' && ov !== 'rest' ? ov : null)
  const byId = id => (id && S.routines.find(r => r.id === id)) || null
  return byId(own) || byId(S.week[new Date(iso + 'T12:00:00').getDay()])
}

// "¿Entrenaste?": marcar el día (sin series) o pasar a cargarlas; "Descansé" lo deja como descanso.
// onCancel: el día ya tiene algo y esto es "agregar otro": en vez de "Descansé", Cancelar.
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
  const rest = () => {
    update(s => { s.dayPlan[iso] = { fecha: iso, estado: 'descanso', rutinaId: null } })
    close()
    toast(t('{0} set to rest', fmtDate(iso)))
  }
  const loadSets = () => { close(); workoutEditorSheet({ iso, routine }) }
  const options = [...st.routines.map(r => ({ id: r.id, name: r.name })), { id: FREE, name: t('Otra cosa') }]
  return <div className="day-mark">
    <div className="day-mark-q">
      <button type="button" className={'day-mark-btn' + (did ? ' on' : '')} aria-pressed={did} onClick={() => setDid(true)}><Icon name="check" />{t('Entrené')}</button>
      {onCancel
        ? <button type="button" className="day-mark-btn" onClick={onCancel}>{t('Cancelar')}</button>
        : <button type="button" className="day-mark-btn" onClick={rest}><Icon name="moon" />{t('Descansé')}</button>}
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

// Un entreno del día: tocarlo abre su detalle; "⋯" abre un menú que flota sobre lo de abajo
// (editar o cargar series, borrar), o sobre lo de arriba si no entra en la pantalla. Se dibuja fuera
// de la hoja (portal) para que la hoja no lo recorte. Borrar confirma con el diálogo de siempre.
const MENU_H = 120
function DayWorkoutCard({ w, close, menu, setMenu }) {
  const menuOpen = menu?.id === w.id
  const st = useStore(s => s.S)
  const n = setsDone(w)
  const sub = w.marked
    ? (n ? (n === 1 ? t('1 serie') : t('{0} series', n)) : t('Sin series · cuenta para tu racha'))
    : [...durPart(w.end - w.start), t('{0} sets', n), fmtVol(w.vol, st.unit)].join(' · ')
  const routine = st.routines.find(r => r.id === w.routineId) || null
  const edit = () => { setMenu(null); close(); workoutEditorSheet({ iso: w.d, routine, workout: w }) }
  const remove = () => {
    setMenu(null)
    confirm({
      title: t('Delete workout?'), message: t('This removes it from your history for good.'), confirmText: t('Delete'), danger: true,
      onConfirm: () => { update(s => { s.workouts = s.workouts.filter(x => x.id !== w.id) }); toast(t('Workout deleted')) },
    })
  }
  return <div className="item day-workout">
    <div className="grow" role="button" tabIndex={0} onClick={() => { close(); openWorkout(w) }}>
      <div className="tt">{w.name} <span className={'tag nocap' + (w.marked ? '' : ' acc')}>{w.marked ? t('Marcado') : t('Entrenado')}</span></div>
      <div className="ss">{sub}</div>
    </div>
    <button type="button" className="iconbtn day-more" aria-label={t('Opciones de {0}', w.name)} aria-expanded={menuOpen}
      onClick={e => {
        if (menuOpen) return setMenu(null)
        const r = e.currentTarget.getBoundingClientRect()
        const vh = window.innerHeight || 0, vw = window.innerWidth || 0
        const up = r.bottom + MENU_H > vh - 8 && r.top > MENU_H
        setMenu({ id: w.id, style: { right: Math.max(8, vw - r.right), ...(up ? { bottom: vh - r.top + 4 } : { top: r.bottom + 4 }) } })
      }}><Icon name="more" /></button>
    {menuOpen && createPortal(<>
      <div className="day-menu-back" onClick={() => setMenu(null)} />
      <div className="day-menu" role="menu" style={menu.style}>
        <button type="button" role="menuitem" onClick={edit}><Icon name="pencil" />{w.marked && !n ? t('Cargar series') : t('Editar series')}</button>
        <button type="button" role="menuitem" className="danger" onClick={remove}><Icon name="trash" />{t('Borrar')}</button>
      </div>
    </>, document.body)}
  </div>
}

export function DaySheet({ iso, close, setOnBack }) {
  const st = useStore(s => s.S)
  const myClasses = useMyClasses()
  const mode = dayMode(iso, todayISO())
  const dayClasses = classesByDate(myClasses?.occurrences, st.workouts)[iso] || []
  const dayWorkouts = st.workouts.filter(w => w.d === iso && !isClassWorkout(w))
  const planned = plannedRoutine(st, iso)
  const closures = useClosures(s => s.closures)
  const closed = closureOn(closures, iso)
  const rested = isRest(st.dayPlan[iso])
  const [adding, setAdding] = useState(false)
  const [menu, setMenu] = useState(null)   // { id, style }: el entreno con el menú abierto y dónde se dibuja
  // Con el menú abierto, "atrás" y Escape cierran el menú y no la hoja; girar la pantalla también
  // lo cierra (quedó dibujado donde estaba el botón).
  useEffect(() => {
    if (!menu) return
    setOnBack?.(() => setMenu(null))
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null) } }
    const onResize = () => setMenu(null)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    return () => {
      setOnBack?.(null)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
    }
  }, [menu, setOnBack])
  const nothing = !dayWorkouts.length && !dayClasses.length
  // Pasado marcado como descanso y sin nada: se dice, con deshacer y "al final entrené".
  const restCard = mode === 'past' && rested && nothing && !adding
  const undoRest = () => { update(s => { delete s.dayPlan[iso] }); toast(t('Back to weekly plan')) }
  return <div className="day-sheet">
    <h3>{fmtDate(iso, true)}</h3>
    {closed && <div className="day-closed small" role="status"><Icon name="lock" />{t('El gimnasio está cerrado')}{closed.reason ? ' · ' + closed.reason : ''}</div>}
    {mode !== 'future' && <>
      <div className="muted small day-tocaba">{planned ? t('Tocaba: {0}', planned.name) : t('Tocaba: descanso')}</div>
      {!nothing && <>
        <h4 className="sec" style={{ marginTop: 0 }}>{mode === 'today' ? t('Hoy') : t('Ese día')}</h4>
        {dayWorkouts.length > 0 && <div className="list day-workouts">{dayWorkouts.map(w =>
          <DayWorkoutCard key={w.id} w={w} close={close} menu={menu} setMenu={setMenu} />)}</div>}
        <DayClasses classes={dayClasses} myClasses={myClasses} close={close} />
      </>}
      {restCard
        ? <>
          <div className="item day-rest"><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span>
            <div className="grow"><div className="tt">{t('Descansaste este día')}</div></div>
            <Button size="sm" variant="plain" onClick={undoRest}>{t('Deshacer')}</Button></div>
          <Button variant="plain" icon="plus" className="day-add" onClick={() => setAdding(true)}>{t('Al final entrené')}</Button>
        </>
        : nothing || adding
          ? <MarkStep iso={iso} planned={planned} close={close} onCancel={adding ? () => setAdding(false) : null} />
          : <Button variant="plain" icon="plus" className="day-add" onClick={() => setAdding(true)}>{t('Agregar otro entrenamiento')}</Button>}
    </>}
    {mode === 'future' && dayClasses.length > 0 && <>
      <h4 className="sec" style={{ marginTop: 0 }}>{t('Clases de este día')}</h4>
      <DayClasses classes={dayClasses} myClasses={myClasses} close={close} />
    </>}
    {(mode === 'future' || (mode === 'today' && !dayWorkouts.length)) && <DayPlanSection iso={iso} close={close} showWeekly={mode === 'future'}
      heading={mode === 'today' ? t('Planificar hoy') : dayClasses.length ? t('Rutina de este día') : null} />}
  </div>
}
