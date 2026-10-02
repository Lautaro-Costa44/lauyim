// Una clase en el historial (entrega 4): de qué clase fue, cómo quedó presente, qué se trabajó, las
// estrellas y la nota. El socio califica (mientras se pueda), anota y la borra del historial (la
// asistencia sigue contando para el gimnasio); el staff, desde la ficha, solo mira.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { fmtDate } from '../../lib/format.js'
import { NOTE_MAX } from '../../lib/history.js'
import { NO_AUTOFILL } from '../../lib/input-safety.js'
import { classesApi, intensityLabel, attendanceSourceLabel } from '../../lib/classes.js'
import { Stars } from '../ClassAfterPrompt.jsx'
import { Button } from '../ui.jsx'
import BodyMap from '../BodyMap.jsx'
import Icon from '../Icon.jsx'
import { exerciseName } from './WorkoutDetailView.jsx'

const ui = () => useUI.getState()
const hhmm = ms => new Date(ms).toTimeString().slice(0, 5)

// La nota del socio se guarda al salir del campo y al cerrar (como en un entreno).
function useNote(w) {
  const update = useStore(s => s.update)
  const [note, setNote] = useState(w.note || '')
  const latest = useRef(note)
  latest.current = note
  const initial = useRef(w.note || '')
  const save = () => {
    const text = latest.current.trim().slice(0, NOTE_MAX)
    if (text === initial.current) return
    initial.current = text
    update(s => {
      const rec = s.workouts.find(x => x.id === w.id)
      if (!rec) return
      if (text) rec.note = text; else delete rec.note
    })
  }
  useEffect(() => save, [])
  return { note, setNote, save }
}

export default function ClassWorkoutDetail({ w, close, staff = false }) {
  const body = useStore(s => s.S?.body) || 'male'
  const update = useStore(s => s.update)
  // null: cargando; false: sin conexión (se ve lo que trae el entrenamiento).
  const [info, setInfo] = useState(null)
  const [rating, setRating] = useState(null)
  const { note, setNote, save } = useNote(w)
  useEffect(() => {
    if (!w.classBookingId) { setInfo(false); return }
    const get = staff ? classesApi.adminBooking : classesApi.booking
    get(w.classBookingId).then(setInfo).catch(() => setInfo(false))
  }, [w.id])
  const occ = info?.occurrence
  const booking = info?.booking
  const stars = rating ?? booking?.rating ?? 0
  const rate = async n => {
    setRating(n)
    try { await classesApi.rate(w.classBookingId, n); ui().toast(t('Calificación guardada')) }
    catch (e) { setRating(null); ui().toast(errorText(e, t('No se pudo guardar'))) }
  }
  const remove = () => import('../../sheets.jsx').then(({ confirmSheet }) => confirmSheet({
    title: t('¿Borrar esta clase del historial?'),
    message: t('Deja de contar para tu fatiga y tus números. Para el gimnasio sigue siendo una clase a la que fuiste.'),
    confirmText: t('Borrar'), danger: true,
    onConfirm: () => { update(s => { s.workouts = s.workouts.filter(x => x.id !== w.id) }); close?.(); ui().toast(t('Clase borrada del historial')) }
  }))

  const time = occ ? `${occ.start}–${occ.end}` : w.start ? `${hhmm(w.start)}–${hhmm(w.end || w.start)}` : ''
  const teacher = occ?.teacherName || w.teacher
  const source = booking && attendanceSourceLabel(booking.source, staff)
  const load = w.muscleLoad
  return <div className="class-history">
    <div className="class-sheet-head">
      <span className="class-dot" style={{ background: occ?.color || 'var(--acc)' }} aria-hidden="true" />
      <div className="grow">
        <h3>{w.name}</h3>
        <div className="muted small">{[fmtDate(w.d, true), time, teacher && t('con {0}', teacher), occ?.room].filter(Boolean).join(' · ')}</div>
      </div>
      <span className="tag nocap">{t('Clase')}</span>
    </div>
    {source && <span className="tag nocap class-tag-present"><Icon name="checkCircle" /> {t(source)}</span>}

    <h4 className="sec">{t('Qué se trabajó')}</h4>
    {load
      ? <div className="class-sheet-map">
          <BodyMap load={Object.fromEntries((load.muscles || []).map(m => [m, 1]))} body={body} />
          <div className="small muted">{t('Intensidad')}: <b>{t(intensityLabel(load.intensity))}</b></div>
        </div>
      : <div className="list">{(w.entries || []).map(e => <div key={e.id} className="item"><div className="grow">
          <div className="tt capitalize">{exerciseName(e)}</div>
          <div className="ss">{t('{0} series × {1}', (e.sets || []).length, e.sets?.[0]?.r ?? '')}</div>
        </div></div>)}</div>}

    <h4 className="sec">{staff ? t('Calificación') : t('Tu calificación')}</h4>
    {info === null ? <div className="dim small">{t('Loading…')}</div>
      : info === false ? <div className="dim small">{t('Sin conexión: la calificación se ve cuando vuelva.')}</div>
      : !staff && booking.canRate ? <><Stars value={stars} onChange={rate} /><div className="small dim class-history-hint">{t('Podés cambiarla durante 7 días.')}</div></>
      : stars ? <Stars value={stars} />
      : <div className="dim small">{staff ? t('No la calificó.') : t('No la calificaste.')}</div>}

    {staff
      ? w.note && <><h4 className="sec">{t('Nota')}</h4><p className="class-sheet-desc">{w.note}</p></>
      : <>
          <div className="small muted" style={{ margin: '14px 0 6px' }}>{t('Nota')}</div>
          <textarea {...NO_AUTOFILL} name="app-class-note" className="input" rows={2} maxLength={NOTE_MAX} value={note}
            placeholder={t('Cómo estuvo la clase.')} onChange={e => setNote(e.target.value)} onBlur={save} />
          <div style={{ height: 14 }} />
          <Button variant="danger" onClick={remove}>{t('Borrar del historial')}</Button>
        </>}
  </div>
}
