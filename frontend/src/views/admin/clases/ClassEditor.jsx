// Editor de una clase (Admin → Clases): datos, profe, cómo se registra (músculos e intensidad o
// ejercicios) y el horario semanal, con el aviso de superposición debajo de cada día.
import { useEffect, useRef, useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { useStore } from '../../../store/useStore.js'
import { t, exerciseNameFor } from '../../../lib/i18n.js'
import { errorText } from '../../../lib/errors.js'
import { ACCENTS } from '../../../lib/format.js'
import { EXIDX } from '../../../lib/exercises.js'
import { INTENSITY_LABELS, classesApi } from '../../../lib/classes.js'
import { Button, Segmented, TextField } from '../../../components/ui.jsx'
import BodyMap from '../../../components/BodyMap.jsx'
import Icon from '../../../components/Icon.jsx'

const ui = () => useUI.getState()
export const WEEKDAYS = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [0, 'Domingo']]
export const CLASS_ICONS = ['dumbbell', 'bike', 'stretch', 'heart', 'boxing', 'kettlebell', 'figureRun', 'swim', 'flame', 'bolt']
const SELECTED = [{ at: 1, level: 4 }]
const OTHER = '__otra__'

const blank = () => ({ name: '', color: ACCENTS.orange, icon: 'dumbbell', description: '', durationMin: 60, capacity: 15, teacherUserId: null, teacherName: '', room: '', logMode: 'muscles', log: { muscles: [], intensity: 'medium' } })

function Editor({ type, slots: initialSlots, teachers, canManage = true, me, allowOverlap, onSaved, close }) {
  const body = useStore(s => s.S?.body) || 'male'
  const [draft, setDraft] = useState(() => type ? { ...type } : { ...blank(), ...(!canManage && me ? { teacherUserId: me.id } : {}) })
  const [teacherChoice, setTeacherChoice] = useState(() => type?.teacherUserId || (type?.teacherName ? OTHER : ''))
  const [slots, setSlots] = useState(() => (initialSlots || []).map(s => ({ ...s, key: s.id })))
  const [removed, setRemoved] = useState([])
  const [conflicts, setConflicts] = useState({})   // key → { blocking, warnings }
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = patch => { setDraft(d => ({ ...d, ...patch })); setErrors({}) }
  const log = draft.log || {}
  const muscles = log.muscles || []
  const exercises = log.exercises || []

  // Superposición de cada fila del horario contra lo que ya hay (con la duración, sala y profe del borrador).
  const timer = useRef(null)
  const checkKey = JSON.stringify([slots.map(s => [s.key, s.weekday, s.start]), draft.durationMin, draft.room, draft.teacherUserId, draft.teacherName])
  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const out = {}
      for (const s of slots) {
        if (!/^\d{2}:\d{2}$/.test(s.start || '')) continue
        try {
          out[s.key] = await classesApi.overlapCheck({ classId: type?.id, slotId: s.id, weekday: s.weekday, start: s.start, durationMin: Number(draft.durationMin) || 60, room: draft.room, teacherUserId: draft.teacherUserId, teacherName: draft.teacherName })
        } catch { /* el guardado vuelve a controlar */ }
      }
      setConflicts(out)
    }, 350)
    return () => clearTimeout(timer.current)
  }, [checkKey])
  const blocked = slots.some(s => conflicts[s.key]?.blocking?.length)

  const toggleMuscle = slug => set({ log: { ...log, muscles: muscles.includes(slug) ? muscles.filter(m => m !== slug) : [...muscles, slug] } })
  // El selector de ejercicios del editor de rutinas; al elegir, se cierra y suma 3 × 12.
  const addExercise = () => import('../../../sheets.jsx').then(({ exercisePicker }) => exercisePicker(ex => {
    const top = ui().sheets.at(-1); if (top) ui().closeSheet(top.id)
    setDraft(d => {
      const list = d.log?.exercises || []
      return list.some(e => e.id === ex.id) ? d : { ...d, log: { exercises: [...list, { id: ex.id, sets: 3, reps: 12 }] } }
    })
  }))
  const setExercise = (i, patch) => set({ log: { exercises: exercises.map((e, j) => j === i ? { ...e, ...patch } : e) } })
  const setMode = logMode => set({ logMode, log: logMode === 'muscles' ? { muscles: [], intensity: 'medium', ...(draft.logMode === 'muscles' ? log : {}) } : { exercises: draft.logMode === 'exercises' ? exercises : [] } })
  const chooseTeacher = value => {
    setTeacherChoice(value)
    if (value === OTHER) set({ teacherUserId: null })
    else set({ teacherUserId: value || null, teacherName: '' })
  }

  const save = async () => {
    setBusy(true)
    try {
      const payload = { ...draft, id: type?.id, durationMin: Number(draft.durationMin), capacity: Number(draft.capacity) }
      const { type: savedType } = await classesApi.saveType(payload)
      const warnings = []
      for (const id of removed) await classesApi.deleteSlot(id)
      for (const s of slots) {
        const before = (initialSlots || []).find(x => x.id === s.id)
        if (before && before.weekday === s.weekday && before.start === s.start) continue
        try {
          const r = await classesApi.saveSlot({ id: s.id, classId: savedType.id, weekday: s.weekday, start: s.start })
          warnings.push(...(r.warnings || []).map(w => w.text))
        } catch (e) {
          ui().toast(e?.data?.conflicts?.[0]?.text || errorText(e, t('No se pudo guardar el horario')))
          onSaved && onSaved()
          setBusy(false)
          return
        }
      }
      ui().toast(warnings.length ? warnings[0] : t('Clase guardada'))
      onSaved && onSaved()
      close()
    } catch (e) {
      if (e?.data?.field) setErrors({ [e.data.field]: e.data.message })
      ui().toast(errorText(e, t('No se pudo guardar')))
    }
    setBusy(false)
  }

  const field = (name, label, input) => <label className="member-field">
    <span className="member-field-l">{label}</span>{input}
    {errors[name] && <span className="form-error" role="alert">{errors[name]}</span>}
  </label>

  return <div className="class-editor">
    <h3>{type ? t('Editar clase') : t('Nueva clase')}</h3>
    <div className="member-form">
      {field('name', t('Nombre'), <TextField name="class-name" maxLength={40} value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="Spinning" />)}
      <div className="member-field">
        <span className="member-field-l">{t('Color e ícono')}</span>
        <div className="swatches">
          {Object.values(ACCENTS).map(c => <button key={c} type="button" className={'swatch' + (draft.color === c ? ' on' : '')} style={{ background: c }} aria-label={c} onClick={() => set({ color: c })} />)}
          <label className={'swatch swatch-picker' + (!Object.values(ACCENTS).includes(draft.color) ? ' on' : '')} style={!Object.values(ACCENTS).includes(draft.color) ? { background: draft.color } : undefined}>
            <input type="color" value={draft.color} onChange={e => set({ color: e.target.value })} aria-label={t('Elegir cualquier color')} /><Icon name="plus" />
          </label>
        </div>
        <div className="class-icons">
          {CLASS_ICONS.map(i => <button key={i} type="button" className={'iconbtn' + (draft.icon === i ? ' on' : '')} aria-label={i} aria-pressed={draft.icon === i} onClick={() => set({ icon: i })}><Icon name={i} /></button>)}
        </div>
      </div>
      {field('description', t('Descripción'), <textarea className="input" rows={2} maxLength={500} value={draft.description} onChange={e => set({ description: e.target.value })} placeholder={t('Qué se hace, qué traer…')} />)}
      <div className="class-editor-row">
        {field('durationMin', t('Duración (min)'), <TextField name="class-duration" type="number" inputMode="numeric" min={15} max={240} value={draft.durationMin} onChange={e => set({ durationMin: e.target.value })} />)}
        {field('capacity', t('Cupo'), <TextField name="class-capacity" type="number" inputMode="numeric" min={1} max={200} value={draft.capacity} onChange={e => set({ capacity: e.target.value })} />)}
      </div>
      {field('room', t('Sala (opcional)'), <TextField name="class-room" maxLength={30} value={draft.room} onChange={e => set({ room: e.target.value })} placeholder={t('Sala 1')} />)}
      {canManage ? field('teacherUserId', t('Profe'), <select className="input" value={teacherChoice} onChange={e => chooseTeacher(e.target.value)} aria-label={t('Profe')}>
        <option value="">{t('Sin profe')}</option>
        {teachers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value={OTHER}>{t('Otra persona (sin cuenta)')}</option>
      </select>) : <div className="member-field"><span className="member-field-l">{t('Profe')}</span><div className="small">{me?.name || t('Vos')} <span className="dim">· {t('las clases que creás las das vos')}</span></div></div>}
      {canManage && teacherChoice === OTHER && field('teacherName', t('Nombre de la profe'), <TextField name="class-teacher" maxLength={40} value={draft.teacherName} onChange={e => set({ teacherName: e.target.value })} />)}
    </div>

    <h4 className="sec">{t('¿Cómo se registra la clase?')}</h4>
    <Segmented options={[{ value: 'muscles', label: t('Músculos e intensidad') }, { value: 'exercises', label: t('Ejercicios') }]} value={draft.logMode} onChange={setMode} />
    <div className="small dim" style={{ margin: '6px 2px 10px' }}>{draft.logMode === 'muscles'
      ? t('Lo más rápido: tocá los músculos que se trabajan. Al socio le queda como entrenamiento hecho.')
      : t('Los ejercicios con series y repeticiones, como una rutina.')}</div>
    {draft.logMode === 'muscles'
      ? <div className="class-editor-muscles">
          <BodyMap load={Object.fromEntries(muscles.map(m => [m, 1]))} thresholds={SELECTED} body={body} onMuscle={toggleMuscle} />
          <Segmented options={Object.entries(INTENSITY_LABELS).map(([value, label]) => ({ value, label: t(label) }))} value={log.intensity || 'medium'} onChange={v => set({ log: { ...log, intensity: v } })} />
        </div>
      : <div className="list">
          {exercises.map((e, i) => <div key={e.id} className="item class-ex-row">
            <div className="grow"><div className="tt capitalize">{EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : e.id}</div></div>
            <div className="class-ex-controls">
            <input className="input class-num" type="number" min={1} max={10} value={e.sets} aria-label={t('Series')} onChange={ev => setExercise(i, { sets: Number(ev.target.value) })} />
            <span className="dim">×</span>
            <input className="input class-num" type="number" min={1} max={100} value={e.reps} aria-label={t('Repeticiones')} onChange={ev => setExercise(i, { reps: Number(ev.target.value) })} />
            <button type="button" className="iconbtn" aria-label={t('Quitar')} onClick={() => set({ log: { exercises: exercises.filter((_, j) => j !== i) } })}><Icon name="trash" /></button>
            </div>
          </div>)}
          <Button size="sm" icon="plus" onClick={addExercise}>{t('Agregar ejercicio')}</Button>
        </div>}
    {errors.log && <span className="form-error" role="alert">{errors.log}</span>}

    <h4 className="sec">{t('Horario semanal')}</h4>
    <div className="class-slots">
      {slots.map((s, i) => {
        const c = conflicts[s.key]
        return <div key={s.key} className="class-slot">
          <div className="class-slot-row">
            <select className="input" value={s.weekday} aria-label={t('Día')} onChange={e => setSlots(list => list.map((x, j) => j === i ? { ...x, weekday: Number(e.target.value) } : x))}>
              {WEEKDAYS.map(([d, label]) => <option key={d} value={d}>{t(label)}</option>)}
            </select>
            <input className="input" type="time" value={s.start} aria-label={t('Hora')} onChange={e => setSlots(list => list.map((x, j) => j === i ? { ...x, start: e.target.value } : x))} />
            <button type="button" className="iconbtn" aria-label={t('Quitar día')} onClick={() => { if (s.id) setRemoved(r => [...r, s.id]); setSlots(list => list.filter((_, j) => j !== i)) }}><Icon name="trash" /></button>
          </div>
          {[...(c?.blocking || []), ...(c?.warnings || [])].map((x, k) => <div key={k} className={'small ' + (c.blocking?.includes(x) ? 'form-error' : 'access-warn')} role="note">{x.text}</div>)}
        </div>
      })}
      <Button size="sm" icon="plus" onClick={() => setSlots(list => [...list, { key: 'n' + Date.now(), weekday: 1, start: '19:00' }])}>{t('Agregar día')}</Button>
      {blocked && !allowOverlap && <div className="small dim">{t('Hay un horario que choca con otra clase. Cambialo o permití clases en el mismo horario en Ajustes.')}</div>}
    </div>

    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={busy || blocked || !draft.name.trim()} onClick={save}>{busy ? t('Guardando…') : t('Guardar')}</Button>
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}

export function classEditorSheet({ type, slots, teachers, canManage, me, allowOverlap, onSaved }) {
  ui().openSheet(close => <Editor type={type} slots={slots} teachers={teachers} canManage={canManage} me={me} allowOverlap={allowOverlap} onSaved={onSaved} close={close} />, { kind: 'panel' })
}
