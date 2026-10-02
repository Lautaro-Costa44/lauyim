// Hoja de una clase para el socio (Plan → Clases, tarjeta de Inicio): qué se trabaja, anotarse o
// cancelar, "Todas las semanas", recordatorios y "Agregar a mi calendario". Y la hoja
// "Recordatorios para esta clase".
import { useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { errorText } from '../lib/errors.js'
import { EXIDX } from '../lib/exercises.js'
import { REMINDER_OPTIONS, reminderLabel, buttonState, capacityText, timeRange, intensityLabel, shortDay, weekdayOf, classesApi } from '../lib/classes.js'
import { Button, Switch } from './ui.jsx'
import BodyMap from './BodyMap.jsx'
import Icon from './Icon.jsx'

const ui = () => useUI.getState()
const WEEKDAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

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

function ClassDetail({ occ: initial, today, cancelHours, onChange, close }) {
  const [occ, setOcc] = useState(initial)
  const [busy, setBusy] = useState(false)
  const body = useStore(s => s.S?.body) || 'male'
  const state = buttonState(occ)
  const mine = occ.myBooking && ['booked', 'waitlist'].includes(occ.myBooking.status) ? occ.myBooking : null
  const refresh = async () => {
    onChange && onChange()
    try {
      const data = await classesApi.list(occ.date, 1)
      const fresh = data.occurrences.find(o => o.key === occ.key)
      if (fresh) setOcc(fresh)
    } catch { /* la lista se recarga igual */ }
  }
  const primary = async () => {
    setBusy(true)
    await classAction(occ, { cancelHours, onChange: refresh })
    setBusy(false)
  }
  const toggleRecurring = async on => {
    try {
      const r = await classesApi.recurring(occ.slotId, on)
      ui().toast(on ? t('Te anotamos todas las semanas') : t('Ya no te anotamos todas las semanas'))
      if (on && r.booked) await refresh(); else setOcc(o => ({ ...o, recurring: on }))
    } catch (e) { ui().toast(errorText(e, t('No se pudo guardar'))) }
  }
  const log = occ.log || {}
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
      <span><Icon name="person" /> {capacityText(occ.booked, occ.capacity)}{occ.waitlist ? ' · ' + t('{0} en espera', occ.waitlist) : ''}</span>
    </div>
    {occ.description && <p className="class-sheet-desc">{occ.description}</p>}

    <h4 className="sec">{t('Qué se trabaja')}</h4>
    {occ.logMode === 'exercises'
      ? <div className="list">{(log.exercises || []).map(e => <div key={e.id} className="item"><div className="grow"><div className="tt capitalize">{EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : e.id}</div><div className="ss">{t('{0} series × {1}', e.sets, e.reps)}</div></div></div>)}</div>
      : <div className="class-sheet-map">
          <BodyMap load={Object.fromEntries((log.muscles || []).map(m => [m, 1]))} body={body} />
          <div className="small muted">{t('Intensidad')}: <b>{t(intensityLabel(log.intensity))}</b></div>
        </div>}

    <div className="class-sheet-actions">
      {mine
        ? <Button variant="tinted" disabled={busy} onClick={() => cancelBooking(occ, { cancelHours, onChange, close })}>{mine.status === 'waitlist' ? t('Salir de la lista de espera') : t('Cancelar mi lugar')}</Button>
        : <Button variant="primary" disabled={busy || state.disabled} onClick={primary}>{t(state.label)}</Button>}
      {mine && <div className="muted small center">{mine.status === 'waitlist' ? t('Estás n.º {0} en la lista de espera.', mine.waitlistPos) : t('Tenés tu lugar.')}</div>}
    </div>

    {occ.slotId && <div className="branding-lock">
      <div><div>{t('Todas las semanas')}</div><div className="small dim">{t('Te anotamos solos en cada {0} a las {1}.', t(WEEKDAY_NAMES[weekdayOf(occ.date)]), occ.movedFrom || occ.start)}</div></div>
      <Switch checked={!!occ.recurring} onChange={toggleRecurring} label={t('Todas las semanas')} />
    </div>}

    {mine && <div className="class-sheet-links">
      <Button size="sm" icon="bell" onClick={() => classRemindersSheet(mine, { onSaved: reminders => setOcc(o => ({ ...o, myBooking: { ...o.myBooking, reminders } })) })}>
        {mine.reminders?.length ? t('Recordatorios: {0}', mine.reminders.map(reminderLabel).join(', ')) : t('Sin recordatorio')}
      </Button>
      {mine.status === 'booked' && <a className="btn sm plain" href={classesApi.icsUrl(mine.id)} download="clase.ics"><Icon name="calendar" /><span>{t('Agregar a mi calendario')}</span></a>}
    </div>}
  </div>
}

export function classSheet(occ, { today, cancelHours = 2, onChange } = {}) {
  ui().openSheet(close => <ClassDetail occ={occ} today={today} cancelHours={cancelHours} onChange={onChange} close={close} />, { kind: 'panel' })
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
    <Button variant="ghost" className="dim" onClick={() => { close(); window.location.hash = '#/settings' }}>{t('Cambiar los de entrada en Ajustes')}</Button>
  </div>
}

export function classRemindersSheet(booking, { onSaved } = {}) {
  ui().openSheet(close => <RemindersPicker booking={booking} onSaved={onSaved} close={close} />)
}
