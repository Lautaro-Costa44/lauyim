// Una fecha de clase en el panel: anotados, lista de espera y anotar a mano (tomar lista); y con
// "Clases y horarios": cambiar la hora o la profe de ese día, o suspenderla.
import { useEffect, useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { t } from '../../../lib/i18n.js'
import { errorText } from '../../../lib/errors.js'
import { capacityText, timeRange, shortDay, classesApi } from '../../../lib/classes.js'
import { Button, Switch, TextField } from '../../../components/ui.jsx'
import Icon from '../../../components/Icon.jsx'

const ui = () => useUI.getState()
const conflictToast = (e, fallback) => ui().toast(e?.data?.conflicts?.[0]?.text || errorText(e, fallback))

function SessionDetail({ occ: initial, canManage, users, teachers, onChange, close }) {
  const [occ, setOcc] = useState(initial)
  const [detail, setDetail] = useState(null)
  const [mode, setMode] = useState(null)   // 'add' | 'time' | 'teacher'
  const [q, setQ] = useState('')
  const [time, setTime] = useState(initial.start)
  const [teacher, setTeacher] = useState(initial.teacherUserId || '')
  const [teacherName, setTeacherName] = useState('')
  const load = (o = occ) => classesApi.session(o).then(d => { setDetail(d); setOcc(d.occurrence) }).catch(e => ui().toast(errorText(e, t('Failed to load'))))
  useEffect(() => { load() }, [])
  const done = async fresh => { onChange && onChange(); await load(fresh || occ) }

  const add = async userId => {
    try {
      await classesApi.addToSession(occ, userId)
      ui().toast(t('Anotado'))
      setQ(''); setMode(null)
      const d = await classesApi.session(occ)
      setDetail(d); setOcc(d.occurrence); onChange && onChange()
    } catch (e) { ui().toast(errorText(e, t('No se pudo anotar'))) }
  }
  const change = async (patch, okText) => {
    try {
      const r = await classesApi.changeSession({ sessionId: occ.sessionId, slotId: occ.slotId, date: occ.date, classId: occ.classId, ...patch })
      ui().toast(r.warnings?.[0]?.text || okText)
      setMode(null)
      await done(r.occurrence)
    } catch (e) { conflictToast(e, t('No se pudo guardar')) }
  }
  const suspend = () => import('../../../sheets.jsx').then(({ confirmSheet }) => confirmSheet({
    title: t('¿Suspender {0} de este día?', occ.name),
    message: detail?.booked?.length ? t('Les avisamos a las {0} personas anotadas.', detail.booked.length + (detail.waitlist?.length || 0)) : t('No hay nadie anotado todavía.'),
    confirmText: t('Suspender'), danger: true,
    onConfirm: () => change({ cancelled: true }, t('Clase suspendida'))
  }))

  const taken = new Set([...(detail?.booked || []), ...(detail?.waitlist || [])].map(p => p.userId))
  const matches = (users || []).filter(u => !u.disabled && !taken.has(u.id) && (!q.trim() || u.name.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 8)

  return <div className="class-session">
    <div className="class-sheet-head">
      <span className="class-dot" style={{ background: occ.color }} aria-hidden="true" />
      <div className="grow">
        <h3>{occ.name}</h3>
        <div className="muted small">{shortDay(occ.date)} · {timeRange(occ)}{occ.movedFrom ? ' · ' + t('era {0}', occ.movedFrom) : ''}{occ.cancelled ? ' · ' + t('Suspendida') : ''}</div>
      </div>
      <span className="tag">{capacityText(occ.booked, occ.capacity)}</span>
    </div>
    <div className="class-sheet-meta small">
      {occ.teacherName && <span><Icon name="personCircle" /> {occ.teacherName}</span>}
      {occ.room && <span><Icon name="house" /> {occ.room}</span>}
    </div>

    <h4 className="sec">{t('Anotados')}</h4>
    {!detail ? <div className="dim small">{t('Loading…')}</div>
      : detail.booked.length === 0 ? <div className="dim small">{t('Nadie anotado todavía.')}</div>
      : <div className="list">{detail.booked.map(p => <div key={p.bookingId} className="item"><div className="grow"><div className="tt">{p.name}</div></div>{p.addedBy && <span className="tag nocap">{t('a mano')}</span>}</div>)}</div>}
    {detail?.waitlist?.length > 0 && <>
      <h4 className="sec">{t('Lista de espera')}</h4>
      <div className="list">{detail.waitlist.map(p => <div key={p.bookingId} className="item"><span className="tag">{p.pos}</span><div className="grow"><div className="tt">{p.name}</div></div></div>)}</div>
    </>}

    {!occ.cancelled && <div className="class-session-actions">
      {mode === 'add'
        ? <div className="member-form">
            <TextField name="class-add-search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('Buscar socio')} />
            <div className="list">{matches.map(u => <button key={u.id} type="button" className="item" onClick={() => add(u.id)}><div className="grow"><div className="tt">{u.name}</div></div><Icon name="plus" className="chev" /></button>)}</div>
            <div className="small dim">{t('Se anota aunque la clase esté llena.')}</div>
          </div>
        : <Button icon="personPlus" onClick={() => setMode('add')}>{t('Anotar a mano')}</Button>}

      {canManage && mode === 'time' && <div className="class-inline">
        <input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} aria-label={t('Hora nueva')} />
        <Button size="sm" variant="primary" onClick={() => change({ start: time }, t('Horario cambiado'))}>{t('Guardar')}</Button>
      </div>}
      {canManage && mode === 'teacher' && <div className="class-inline">
        <select className="input" value={teacher} onChange={e => setTeacher(e.target.value)} aria-label={t('Profe de este día')}>
          {teachers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="">{t('Otra persona (sin cuenta)')}</option>
        </select>
        {!teacher && <TextField name="class-day-teacher" value={teacherName} onChange={e => setTeacherName(e.target.value)} placeholder={t('Nombre')} />}
        <Button size="sm" variant="primary" disabled={!teacher && !teacherName.trim()} onClick={() => change({ teacherUserId: teacher || null, teacherName: teacher ? null : teacherName.trim() }, t('Profe cambiada'))}>{t('Guardar')}</Button>
      </div>}
      {canManage && !mode && <div className="class-session-manage">
        <Button size="sm" icon="clock" onClick={() => setMode('time')}>{t('Cambiar horario este día')}</Button>
        <Button size="sm" icon="personCircle" onClick={() => setMode('teacher')}>{t('Cambiar profe este día')}</Button>
        <Button size="sm" variant="danger" icon="xmark" onClick={suspend}>{t('Suspender este día')}</Button>
      </div>}
    </div>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cerrar')}</Button>
  </div>
}

export function sessionSheet(occ, opts) {
  ui().openSheet(close => <SessionDetail occ={occ} {...opts} close={close} />, { kind: 'panel' })
}

// ---- clase suelta ----

function LooseClass({ types, today, onChange, close }) {
  const [classId, setClassId] = useState(types[0]?.id || '')
  const [date, setDate] = useState(today)
  const [start, setStart] = useState('10:00')
  const save = async () => {
    try {
      const r = await classesApi.changeSession({ classId, date, start })
      ui().toast(r.warnings?.[0]?.text || t('Clase agregada'))
      onChange && onChange(); close()
    } catch (e) { conflictToast(e, t('No se pudo guardar')) }
  }
  return <div>
    <h3>{t('Clase suelta')}</h3>
    <p className="muted small">{t('Una clase fuera del horario semanal, en una fecha.')}</p>
    <div className="member-form">
      <label className="member-field"><span className="member-field-l">{t('Clase')}</span>
        <select className="input" value={classId} onChange={e => setClassId(e.target.value)}>{types.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <div className="class-editor-row">
        <label className="member-field"><span className="member-field-l">{t('Fecha')}</span><input className="input" type="date" min={today} value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className="member-field"><span className="member-field-l">{t('Hora')}</span><input className="input" type="time" value={start} onChange={e => setStart(e.target.value)} /></label>
      </div>
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={!classId || !date || !start} onClick={save}>{t('Agregar')}</Button>
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}

export function looseClassSheet(opts) {
  ui().openSheet(close => <LooseClass {...opts} close={close} />, { kind: 'panel' })
}

// ---- ajustes (owner) ----

function Settings({ onChange, close }) {
  const [s, setS] = useState(null)
  useEffect(() => { classesApi.settings().then(d => setS(d.settings)).catch(e => ui().toast(errorText(e, t('Failed to load')))) }, [])
  if (!s) return <div className="dim small">{t('Loading…')}</div>
  const set = patch => setS(x => ({ ...x, ...patch }))
  const save = async () => {
    try {
      await classesApi.saveSettings(s)
      ui().toast(t('Ajustes guardados'))
      onChange && onChange(); close()
    } catch (e) { ui().toast(errorText(e, t('No se pudo guardar'))) }
  }
  const num = (key, label, min, max, help) => <label className="member-field">
    <span className="member-field-l">{label}</span>
    <input className="input" type="number" inputMode="numeric" min={min} max={max} value={s[key]} onChange={e => set({ [key]: Number(e.target.value) })} />
    <span className="small dim">{help}</span>
  </label>
  const SwitchRow = ({ value, label, help, onToggle }) => <div className="branding-lock">
    <div><div>{label}</div><div className="small dim">{help}</div></div>
    <Switch checked={value} onChange={onToggle} label={label} />
  </div>
  return <div>
    <h3>{t('Ajustes de clases')}</h3>
    <SwitchRow value={s.enabled} label={t('Clases en la app')} help={t('Apagado, los socios no ven la pestaña Clases ni la tarjeta de Inicio.')} onToggle={v => set({ enabled: v })} />
    <div className="member-form" style={{ marginTop: 12 }}>
      {num('bookAheadDays', t('Se puede reservar desde (días antes)'), 1, 30, t('De 1 a 30 días.'))}
      {num('cancelHours', t('Cancelar sin que cuente como tardía (horas antes)'), 0, 48, t('Después cuenta como cancelación tardía.'))}
      {num('waitlistCutoffMin', t('La lista de espera sube gente hasta (minutos antes)'), 0, 720, t('Después ya no se avisa a nadie que entró.'))}
    </div>
    <SwitchRow value={s.allowOverlap} label={t('Permitir clases en el mismo horario')}
      help={t('Dos clases chocan si coinciden en la hora y están en la misma sala, o si alguna no tiene sala. Apagado, no se pueden guardar; encendido, se avisa.')}
      onToggle={v => set({ allowOverlap: v })} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Guardar')}</Button>
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}

export function classSettingsSheet(opts) {
  ui().openSheet(close => <Settings {...opts} close={close} />, { kind: 'panel' })
}
