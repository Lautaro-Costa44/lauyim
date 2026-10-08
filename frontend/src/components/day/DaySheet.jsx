// La hoja de un día (semana de Inicio y calendario): las clases de ese día y qué rutina toca.
// Planificar (rutina, descanso, volver al plan) solo cambia dayPlan: nunca borra un entreno.
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { fmtDate, uid, exCount } from '../../lib/format.js'
import { effectiveRoutineId, markedDoneWorkout } from '../../lib/history.js'
import { isClassWorkout } from '../../lib/workout-history.js'
import { useMyClasses } from '../useMyClasses.js'
import { classesByDate } from '../../lib/classes.js'
import { classSheet } from '../ClassSheet.jsx'
import { glyphOf } from '../../lib/glyphs.js'
import Icon from '../Icon.jsx'

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
  const trainedThatDay = st.workouts.some(w => w.d === iso && !isClassWorkout(w))
  const currentStatus = typeof ovVal === 'object' && ovVal ? ovVal.estado : (ovVal === 'rest' ? 'descanso' : (typeof ovVal === 'string' && ovVal ? 'rutina' : (trainedThatDay ? 'completado' : null)))
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

  // Provisorio hasta la hoja de registrar: ya no borra lo que había ese día.
  const markDone = routine => {
    update(s => {
      s.workouts.push(markedDoneWorkout(iso, routine, { id: uid(), name: routine ? routine.name : t('Freestyle') }))
      s.dayPlan[iso] = { fecha: iso, estado: 'completado', rutinaId: null }
    })
    close()
    toast(t('Entrenamiento marcado como realizado'))
  }

  return <div className="day-plan">
    {heading && <h4 className="sec">{heading}</h4>}
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Weekly plan:')} {weeklyR ? weeklyR.name : t('Rest')}{ovr && <span style={{ color: 'var(--orange)' }}> · {t('changed for this day')}</span>}<br />{t('Sick, missed a day or want a different session? Pick what to train instead.')}</div>
    <div className="list">
      <div className="item" onClick={() => markDone(st.routines.find(r => r.id === effId) || st.routines[0])}>
        <span className="lrow-i" style={{ background: 'var(--acc)', color: '#000' }}><Icon name="checkCircle" /></span>
        <div className="grow"><div className="tt">{t('Marcar como realizado en esta fecha')}</div></div>
        {currentStatus === 'completado' && <Icon name="check" className="accent" />}
      </div>
      {st.routines.map(r => <div key={r.id} className="item" onClick={() => setEstado('rutina', r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {currentStatus === 'rutina' && currentRoutineId === r.id && <Icon name="check" className="accent" />}</div>)}
      <div className="item" onClick={() => setEstado('descanso')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest / skip this day')}</div></div>{currentStatus === 'descanso' && <Icon name="check" className="accent" />}</div>
      {ovr && <div className="item" onClick={() => setEstado(null)}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="reset" /></span><div className="grow"><div className="tt">{t('Back to weekly plan')}</div></div></div>}
    </div>
  </div>
}

export function DaySheet({ iso, close }) {
  const st = useStore(s => s.S)
  const myClasses = useMyClasses()
  const dayClasses = classesByDate(myClasses?.occurrences, st.workouts)[iso] || []
  return <div className="day-sheet">
    <h3>{fmtDate(iso, true)}</h3>
    {dayClasses.length > 0 && <h4 className="sec" style={{ marginTop: 0 }}>{t('Clases de este día')}</h4>}
    <DayClasses classes={dayClasses} myClasses={myClasses} close={close} />
    <DayPlanSection iso={iso} close={close} heading={dayClasses.length ? t('Rutina de este día') : null} />
  </div>
}
