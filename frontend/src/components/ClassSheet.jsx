// Hoja de una clase para el socio (Plan → Clases, tarjeta de Inicio): qué se trabaja, anotarse o
// cancelar, "Anotarme a todas esta semana", "Fija" (los días que se reservan cada semana), recordatorios
// y "Agregar a mi calendario". Y la hoja "Recordatorios para esta clase".
import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { errorText } from '../lib/errors.js'
import { EXIDX } from '../lib/exercises.js'
import { REMINDER_OPTIONS, reminderLabel, buttonState, capacityText, timeRange, intensityLabel, shortDay, googleCalendarUrl, classesApi, classSlotChips, weekBookable, bookWeekText, countdown, occTimes } from '../lib/classes.js'
import { IS_APPLE } from '../lib/api.js'
import { can } from '../lib/permissions.js'
import { Button } from './ui.jsx'
import BodyMap from './BodyMap.jsx'
import Icon from './Icon.jsx'
import { GearButton } from './TeacherClass.jsx'

const ui = () => useUI.getState()
const WEEKDAY_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados']

// "Hoy", "Mañana" o "Mié 7".
export function dayLabel(date, today) {
  if (date === today) return t('Hoy')
  const next = new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
  return date === next ? t('Mañana') : shortDay(date)
}

// Faltan menos de cancelHours: cancelar cuenta como tardía (aproximado con el reloj del celular).
export const isLateCancel = (occ, cancelHours) => Date.parse(`${occ.date}T${occ.start}:00`) - Date.now() < cancelHours * 3600000

// Anotarse / cancelar según el estado. onChange: recargar la lista.
export async function classAction(occ, { cancelHours = 2, onChange } = {}) {
  const toast = ui().toast
  const state = buttonState(occ)
  try {
    if (state.key === 'book' || state.key === 'waitlist') {
      const { booking } = await classesApi.book(occ)
      toast(booking.status === 'booked' ? t('Te anotaste a {0}', occ.name) : t('Quedaste en la lista de espera (n.º {0})', booking.waitlistPos))
      onChange && onChange()
    }
  } catch (e) { toast(errorText(e, t('No se pudo anotar'))) }
}

async function cancelBooking(occ, { cancelHours, onChange, close }) {
  const doIt = async () => {
    try {
      const { kind } = await classesApi.cancel(occ.myBooking.id)
      ui().toast(kind === 'late_cancel' ? t('Cancelaste (tardía)') : t('Cancelaste tu lugar'))
      close && close()
      onChange && onChange()
    } catch (e) { ui().toast(errorText(e, t('No se pudo cancelar'))) }
  }
  if (occ.myBooking.status === 'booked' && isLateCancel(occ, cancelHours)) {
    const { confirmSheet } = await import('../sheets.jsx')
    confirmSheet({
      title: t('¿Cancelar igual?'),
      message: t('Faltan menos de {0} horas: cuenta como cancelación tardía.', cancelHours),
      confirmText: t('Cancelar mi lugar'), cancelText: t('Volver'), danger: true, onConfirm: doIt
    })
  } else doIt()
}

function ClassDetail({ occ: initial, today, tz, cancelHours, onChange, close }) {
  const [occ, setOcc] = useState(initial)
  const [busy, setBusy] = useState(false)
  // Los días de la clase (para "Fija") y las fechas de esta semana que todavía puede reservar.
  const [week, setWeek] = useState({ slots: [], bookable: [] })
  const body = useStore(s => s.S?.body) || 'male'
  const state = buttonState(occ)
  const mine = occ.myBooking && ['booked', 'waitlist'].includes(occ.myBooking.status) ? occ.myBooking : null
  // La ventana de reserva trae la semana; una fecha fuera de ella se busca sola.
  const load = async () => {
    try {
      const data = await classesApi.list()
      setWeek({ slots: classSlotChips(data.slots, occ.classId), bookable: weekBookable(data.occurrences, occ.classId, data.today) })
      const fresh = data.occurrences.find(o => o.key === occ.key) || (await classesApi.list(occ.date, 1)).occurrences.find(o => o.key === occ.key)
      if (fresh) setOcc(fresh)
    } catch { /* queda lo que había */ }
  }
  useEffect(() => { load() }, [])
  const refresh = async () => {
    onChange && onChange()
    await load()
  }
  const primary = async () => {
    setBusy(true)
    await classAction(occ, { cancelHours, onChange: refresh })
    setBusy(false)
  }
  const bookWeek = async () => {
    setBusy(true)
    try {
      const [text, ...args] = bookWeekText(await classesApi.bookWeek(occ.classId))
      ui().toast(t(text, ...args))
      await refresh()
    } catch (e) { ui().toast(errorText(e, t('No se pudo anotar'))) }
    setBusy(false)
  }
  const toggleFixed = async slot => {
    const on = !slot.recurring
    const mark = value => setWeek(w => ({ ...w, slots: w.slots.map(s => s.id === slot.id ? { ...s, recurring: value } : s) }))
    mark(on)
    try {
      await classesApi.recurring(slot.id, on)
      const days = t(WEEKDAY_PLURAL[slot.weekday])
      ui().toast(on ? t('Te anotamos todos los {0} a las {1}', days, slot.start) : t('Ya no te anotamos los {0} a las {1}', days, slot.start))
      await refresh()
    } catch (e) { mark(!on); ui().toast(errorText(e, t('No se pudo guardar'))) }
  }
  const otherDates = week.bookable.filter(o => o.key !== occ.key)
  return <div className="class-sheet">
    <div className="class-sheet-head">
      <span className="class-dot" style={{ background: occ.color }} aria-hidden="true" />
      <div className="grow">
        <h3>{occ.name}</h3>
        <div className="muted small">{dayLabel(occ.date, today)} · {timeRange(occ)}{occ.movedFrom ? ' · ' + t('cambió (era {0})', occ.movedFrom) : ''}</div>
      </div>
    </div>
    <div className="class-sheet-meta small">
      {occ.teacherName && <span><Icon name="personCircle" /> {occ.teacherName}</span>}
      {occ.room && <span><Icon name="house" /> {occ.room}</span>}
      <span><Icon name="person" /> {occ.capacity == null ? t('{0} anotados', occ.booked) + ' · ' + t('sin cupo') : capacityText(occ.booked, occ.capacity)}{occ.waitlist ? ' · ' + t('{0} en espera', occ.waitlist) : ''}</span>
    </div>
    {occ.description && <p className="class-sheet-desc">{occ.description}</p>}

    <WorkedOn occ={occ} body={body} />

    <div className="class-sheet-actions">
      {mine
        ? <Button variant="tinted" disabled={busy} onClick={() => cancelBooking(occ, { cancelHours, onChange, close })}>{mine.status === 'waitlist' ? t('Salir de la lista de espera') : t('Cancelar mi lugar')}</Button>
        : <Button variant="primary" disabled={busy || state.disabled} onClick={primary}>{t(state.label)}</Button>}
      {mine && <div className="muted small class-sheet-status">{mine.status === 'waitlist' ? t('Estás n.º {0} en la lista de espera.', mine.waitlistPos) : t('Tenés tu lugar.')}</div>}
    </div>

    {otherDates.length > 0 && <div className="class-week">
      <Button variant="tinted" icon="calendar" disabled={busy} onClick={bookWeek}>{t('Anotarme a todas esta semana')}</Button>
      <div className="small dim">{week.bookable.map(o => `${dayLabel(o.date, today)} ${o.start}`).join(' · ')}</div>
    </div>}

    {week.slots.length > 0 && <div className="class-fixed">
      <div>{t('Fija')}</div>
      <div className="small dim">{t('Marcá los días y te anotamos cada semana.')}</div>
      <div className="chips" role="group" aria-label={t('Días fijos')}>
        {week.slots.map(s => <button key={s.id} type="button" className={'chip' + (s.recurring ? ' on' : '')} aria-pressed={s.recurring} onClick={() => toggleFixed(s)}>{s.label}</button>)}
      </div>
    </div>}

    {mine && <div className="class-sheet-links">
      <Button size="sm" icon="bell" onClick={() => classRemindersSheet(mine, { onSaved: reminders => setOcc(o => ({ ...o, myBooking: { ...o.myBooking, reminders } })) })}>
        {mine.reminders?.length ? t('Recordatorios: {0}', mine.reminders.map(reminderLabel).join(', ')) : t('Sin recordatorio')}
      </Button>
      {mine.status === 'booked' && <Button size="sm" icon="calendar" onClick={() => calendarChoiceSheet(occ, mine, tz)}>{t('Agregar a mi calendario')}</Button>}
    </div>}
  </div>
}

// Qué se trabaja: los ejercicios o el mapa del cuerpo con la intensidad.
function WorkedOn({ occ, body }) {
  const log = occ.log || {}
  return <>
    <h4 className="sec">{t('Qué se trabaja')}</h4>
    {occ.logMode === 'exercises'
      ? <div className="list">{(log.exercises || []).map(e => <div key={e.id} className="item"><div className="grow"><div className="tt capitalize">{EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : e.id}</div><div className="ss">{t('{0} series × {1}', e.sets, e.reps)}</div></div></div>)}</div>
      : <div className="class-sheet-map">
          <BodyMap load={Object.fromEntries((log.muscles || []).map(m => [m, 1]))} body={body} />
          <div className="small muted">{t('Intensidad')}: <b>{t(intensityLabel(log.intensity))}</b></div>
        </div>}
  </>
}

// La misma hoja para la profe que da esa fecha: sin anotarse; cuántos hay, cuánto falta y la rueda
// para gestionarla. Se refresca al volver de la rueda.
function TeachingDetail({ occ: initial, today, tz, onChange }) {
  const [occ, setOcc] = useState(initial)
  const [people, setPeople] = useState(null)   // quiénes vienen (si puede ver socios)
  const body = useStore(s => s.S?.body) || 'male'
  const seesMembers = useStore(s => can(s.user, 'members.view'))
  const loadPeople = () => seesMembers && classesApi.session(occ).then(d => setPeople({ booked: d.booked, waitlist: d.waitlist })).catch(() => {})
  useEffect(() => { loadPeople() }, [])
  const refresh = async () => {
    onChange && onChange()
    loadPeople()
    try {
      const fresh = (await classesApi.list(occ.date, 1)).occurrences.find(o => o.key === occ.key)
      if (fresh) setOcc(fresh)
    } catch { /* queda lo que había */ }
  }
  const { start, end } = occTimes(occ, tz)
  const cd = countdown(start, end, Date.now())
  const when = cd.mode === 'over' ? t('Terminó') : cd.mode === 'live' ? t('En curso') : cd.label
  return <div className="class-sheet">
    <div className="class-sheet-head">
      <span className="class-dot" style={{ background: occ.color }} aria-hidden="true" />
      <div className="grow">
        <h3>{occ.name}</h3>
        <div className="muted small">{dayLabel(occ.date, today)} · {timeRange(occ)}{occ.room ? ' · ' + occ.room : ''}{occ.movedFrom ? ' · ' + t('cambió (era {0})', occ.movedFrom) : ''}</div>
      </div>
      <GearButton occ={occ} onChange={refresh} />
    </div>
    <span className="tag nocap class-tag-present">{t('La das vos')}</span>
    <div className="class-teach-stats">
      <div><b>{capacityText(occ.booked, occ.capacity)}</b><span>{t('anotados')}</span></div>
      <div><b>{occ.waitlist || 0}</b><span>{t('en espera')}</span></div>
      <div><b>{when}</b><span>{cd.mode === 'over' || cd.mode === 'live' ? t('estado') : t('para empezar')}</span></div>
    </div>
    {people && <>
      <h4 className="sec">{t('Anotados')}</h4>
      {people.booked.length === 0 ? <div className="dim small">{t('Nadie anotado todavía.')}</div>
        : <div className="list">{people.booked.map(p => <div key={p.bookingId} className="item"><div className="grow"><div className="tt">{p.name}</div></div>
            {p.status === 'attended' && <span className="tag nocap class-tag-present">{t('Presente')}</span>}
            {p.status === 'absent' && <span className="tag nocap class-tag-absent">{t('Ausente')}</span>}
          </div>)}</div>}
      {people.waitlist.length > 0 && <>
        <h4 className="sec">{t('Lista de espera')}</h4>
        <div className="list">{people.waitlist.map(p => <div key={p.bookingId} className="item"><span className="tag">{p.pos}</span><div className="grow"><div className="tt">{p.name}</div></div></div>)}</div>
      </>}
    </>}
    {occ.description && <p className="class-sheet-desc">{occ.description}</p>}
    <WorkedOn occ={occ} body={body} />
    <div className="small dim class-teach-hint"><Icon name="gear" /> {t('Con la rueda tomás lista, mandás un mensaje a los anotados o cambiás algo de esta fecha.')}</div>
  </div>
}

export function classSheet(occ, { today, tz, cancelHours = 2, onChange } = {}) {
  ui().openSheet(close => occ.teaching
    ? <TeachingDetail occ={occ} today={today} tz={tz} onChange={onChange} close={close} />
    : <ClassDetail occ={occ} today={today} tz={tz} cancelHours={cancelHours} onChange={onChange} close={close} />, { kind: 'panel' })
}

// ---- agregar al calendario ----

// Google Calendar abre el evento ya cargado (Android y PC). El iPhone abre el .ics y ofrece
// "Agregar"; el mismo .ics sirve para cualquier otro calendario. Primero, el del celular.
function CalendarChoice({ occ, booking, tz, close }) {
  const google = <a key="g" className="btn tinted" href={googleCalendarUrl(occ, tz)} target="_blank" rel="noopener noreferrer" onClick={close}><Icon name="calendar" /><span>Google Calendar</span></a>
  const apple = <a key="a" className="btn tinted" href={classesApi.icsUrl(booking.id)} onClick={close}><Icon name="calendar" /><span>{IS_APPLE ? t('Calendario del iPhone') : t('Otro calendario (.ics)')}</span></a>
  return <div className="class-calendar-choice">
    <h3>{t('Agregar a mi calendario')}</h3>
    <p className="muted small">{occ.name} · {shortDay(occ.date)} {timeRange(occ)}</p>
    {IS_APPLE ? [apple, google] : [google, apple]}
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}

export function calendarChoiceSheet(occ, booking, tz) {
  ui().openSheet(close => <CalendarChoice occ={occ} booking={booking} tz={tz} close={close} />)
}

// ---- recordatorios ----

function RemindersPicker({ booking, onSaved, close }) {
  const [chosen, setChosen] = useState(booking.reminders || [])
  const save = async next => {
    setChosen(next)
    try {
      const r = await classesApi.setReminders(booking.id, next)
      onSaved && onSaved(r.booking.reminders)
    } catch (e) { ui().toast(errorText(e, t('No se pudo guardar'))) }
  }
  const toggle = m => save(chosen.includes(m) ? chosen.filter(x => x !== m) : REMINDER_OPTIONS.filter(x => x === m || chosen.includes(x)))
  return <div>
    <h3>{t('Recordatorios para esta clase')}</h3>
    <p className="muted small">{t('Te avisamos antes de que empiece. Podés elegir varios.')}</p>
    <div className="chips class-reminders" role="group" aria-label={t('Recordatorios para esta clase')}>
      {REMINDER_OPTIONS.map(m => <button key={m} type="button" className={'chip' + (chosen.includes(m) ? ' on' : '')} aria-pressed={chosen.includes(m)} onClick={() => toggle(m)}>{t('{0} antes', reminderLabel(m))}</button>)}
      <button type="button" className={'chip' + (!chosen.length ? ' on' : '')} aria-pressed={!chosen.length} onClick={() => save([])}>{t('Sin recordatorio')}</button>
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Listo')}</Button>
    {/* A Ajustes: se cierran esta hoja y la de la clase. */}
    <Button variant="ghost" className="dim" onClick={() => { ui().closeAll(); window.location.hash = '#/settings' }}>{t('Cambiar los de entrada en Ajustes')}</Button>
  </div>
}

export function classRemindersSheet(booking, { onSaved } = {}) {
  ui().openSheet(close => <RemindersPicker booking={booking} onSaved={onSaved} close={close} />)
}
