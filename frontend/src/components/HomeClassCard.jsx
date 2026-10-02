// Inicio: la próxima clase del socio como un ticket con el color de la clase (día, número y hora).
// A menos de 24 h se despliega la cuenta regresiva y el cupo. "Mis clases" abre la lista de sus
// próximas reservas. Si le suspenden una clase, un aviso que puede cerrar. Se recarga al volver a
// la app y cada 2 minutos (cambios de horario, de profe, del cupo o una suspensión llegan solos);
// el reloj corre cada segundo en la última hora y cada 30 s antes. A la profe, arriba, la próxima
// clase que da y las otras de ese día: tocar la clase abre su hoja, la rueda la gestión.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { classesApi, timeRange, weekdayOf, capacityText, countdown, occTimes, homeClasses, teacherHome, homeStrip, spotsText, addDays, shortDay } from '../lib/classes.js'
import { classSheet, dayLabel } from './ClassSheet.jsx'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'
import { GearButton } from './TeacherClass.jsx'

const ui = () => useUI.getState()
const WEEKDAY_SHORT = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB']
const DISMISSED_KEY = 'lauyim_class_suspended_seen'
const RELOAD_MS = 120000

const readDismissed = () => { try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]') } catch { return [] } }
const saveDismissed = keys => { try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(keys.slice(-50))) } catch { /* storage off */ } }

// Reloj: cada `ms` (cambia con el modo de la cuenta regresiva).
function useNow(ms) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id) }, [ms])
  return now
}

const statusTag = booking => booking.status === 'waitlist'
  ? <span className="tag nocap class-tag-wait">{t('En espera (n.º {0})', booking.waitlistPos)}</span>
  : <span className="tag nocap class-tag-present">{t('Anotado')}</span>

export default function HomeClassCard() {
  const nav = useNavigate()
  const on = useStore(s => !!s.config?.classes_available)
  const [data, setData] = useState(null)
  const [dismissed, setDismissed] = useState(readDismissed)
  const load = () => classesApi.list().then(setData).catch(() => {})
  useEffect(() => {
    if (!on) return
    load()
    const id = setInterval(load, RELOAD_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [on])

  const tz = data?.tz
  const coarse = homeClasses(data?.occurrences, Date.now(), tz, dismissed)
  const coarseTeach = teacherHome(data?.occurrences, Date.now(), tz)
  const nextStart = Math.min(...[coarse.next, coarseTeach.next].filter(Boolean).map(o => occTimes(o, tz).start), Infinity)
  const now = useNow(nextStart - Date.now() < 3600000 ? 1000 : 30000)
  if (!on || !data) return null
  const { next, upcoming, suspended } = homeClasses(data.occurrences, now, tz, dismissed)
  const opts = { today: data.today, tz, cancelHours: data.settings?.cancelHours ?? 2, onChange: load }
  const teach = teacherHome(data.occurrences, now, tz)
  const teaching = teach.next && <TeacherTicket {...teach} now={now} tz={tz} opts={opts} />
  const dismiss = key => { const keys = [...dismissed, key]; setDismissed(keys); saveDismissed(keys) }
  const openList = () => myClassesSheet({ upcoming, suspended, opts, onAll: () => nav('/plan/clases') })

  const alerts = suspended.map(o => <div key={o.key} className="card class-suspended" role="alert">
    <Icon name="warning" />
    <div className="grow"><b>{t('Se suspendió {0}', o.name)}</b><div className="small">{dayLabel(o.date, data.today)} {o.start}{o.teacherName ? ' · ' + t('con {0}', o.teacherName) : ''}</div></div>
    <button type="button" className="iconbtn" aria-label={t('Cerrar aviso')} onClick={() => dismiss(o.key)}><Icon name="xmark" /></button>
  </div>)

  if (!next) return <>
    {teaching}
    {alerts}
    {!teaching && <ClassStrip {...homeStrip(data.occurrences, now, tz)} opts={opts} onAll={() => nav('/plan/clases')} />}
  </>

  const { start, end } = occTimes(next, tz)
  const cd = countdown(start, end, now)
  const soon = cd.mode !== 'days'
  const fill = next.capacity == null ? null : Math.min(1, next.booked / next.capacity)
  return <>
    {teaching}
    {alerts}
    <div className={'card class-ticket' + (soon ? ' soon' : '')} style={{ '--c': next.color }}>
      <button type="button" className="class-ticket-main" onClick={() => classSheet(next, opts)} aria-label={t('Ver {0}', next.name)}>
        <span className="class-ticket-date">
          <span>{WEEKDAY_SHORT[weekdayOf(next.date)]}</span>
          <b>{Number(next.date.slice(8, 10))}</b>
          <span>{next.start}</span>
        </span>
        <span className="class-ticket-info">
          <span className="lbl2">{t('Tu próxima clase')}</span>
          <span className="class-ticket-name">{next.name}</span>
          <span className="muted small">{[next.teacherName && t('con {0}', next.teacherName), next.room].filter(Boolean).join(' · ')}</span>
          <span className="class-ticket-tags">
            {statusTag(next.myBooking)}
            {cd.mode === 'days' && <span className="tag nocap">{cd.label}</span>}
            {next.movedFrom && <span className="tag nocap class-tag-wait">{t('Cambió de horario (era {0})', next.movedFrom)}</span>}
          </span>
        </span>
      </button>
      {soon && <div className="class-ticket-count" aria-live={cd.mode === 'minutes' ? 'off' : 'polite'}>
        <div className="class-ticket-clock">{cd.mode === 'live' ? t('En curso') : <><span className="small muted">{t('Empieza en')}</span> <b>{cd.label}</b></>}</div>
        {fill !== null && <div className="class-ticket-bar" aria-hidden="true"><span style={{ width: `${Math.round(fill * 100)}%` }} /></div>}
        <div className="small muted">{next.capacity == null ? t('{0} anotados', next.booked) : t('{0} lugares ocupados', capacityText(next.booked, next.capacity))}{next.waitlist ? ' · ' + t('{0} en espera', next.waitlist) : ''}</div>
      </div>}
      <button type="button" className="class-ticket-more" onClick={openList}>
        {upcoming.length > 1 ? t('Mis clases ({0})', upcoming.length) : t('Mis clases')} <Icon name="chevronRight" />
      </button>
    </div>
  </>
}

// ---- "Mis clases": la lista de próximas reservas (y las suspendidas) ----

// Se abre con lo que tenía la tarjeta y se refresca sola (al abrir y al volver a la app): un cambio
// de horario o una suspensión se ven aunque la hoja quede abierta.
function MyClasses({ upcoming: initialUpcoming, suspended: initialSuspended, opts, onAll, close }) {
  const [lists, setLists] = useState({ upcoming: initialUpcoming, suspended: initialSuspended })
  useEffect(() => {
    const refresh = () => classesApi.list().then(d => {
      const r = homeClasses(d.occurrences, Date.now(), d.tz, readDismissed())
      setLists({ upcoming: r.upcoming, suspended: r.suspended })
    }).catch(() => {})
    refresh()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  const { upcoming, suspended } = lists
  const rows = [...upcoming, ...suspended].sort((a, b) => occTimes(a, opts.tz).start - occTimes(b, opts.tz).start)
  return <div className="my-classes">
    <h3>{t('Mis clases')}</h3>
    {rows.length === 0 ? <div className="dim small">{t('No tenés clases reservadas.')}</div>
      : <div className="my-classes-list">{rows.map(o => <button key={o.key} type="button" className={'my-class-row' + (o.cancelled ? ' cancelled' : '')}
          onClick={() => { if (!o.cancelled) { close(); classSheet(o, opts) } }}>
          <span className="class-bar" style={{ background: o.color }} aria-hidden="true" />
          <span className="grow">
            <span className="tt">{o.name}</span>
            <span className="ss">{dayLabel(o.date, opts.today)} · {timeRange(o)}{o.teacherName ? ' · ' + t('con {0}', o.teacherName) : ''}</span>
          </span>
          {o.cancelled ? <span className="tag nocap class-tag-absent">{t('Suspendida')}</span> : statusTag(o.myBooking)}
        </button>)}</div>}
    <div style={{ height: 12 }} />
    <Button variant="tinted" icon="calendar" onClick={() => { close(); onAll() }}>{t('Ver todas las clases')}</Button>
  </div>
}

export function myClassesSheet(props) {
  ui().openSheet(close => <MyClasses {...props} close={close} />, { kind: 'panel' })
}

// ---- la profe ----

// Próxima clase que da, como ticket (sin botones: tocarla abre su hoja, la rueda la gestión) y
// debajo las otras que da ese día.
function TeacherTicket({ next, sameDay, over, now, tz, opts }) {
  const { start, end } = occTimes(next, tz)
  const cd = countdown(start, end, now)
  const soon = cd.mode !== 'days'
  const fill = next.capacity == null ? null : Math.min(1, next.booked / next.capacity)
  return <div className={'card class-ticket teach' + (soon ? ' soon' : '')} style={{ '--c': next.color }}>
    <div className="class-ticket-row">
      <button type="button" className="class-ticket-main" onClick={() => classSheet(next, opts)} aria-label={t('Ver {0}', next.name)}>
        <span className="class-ticket-date">
          <span>{WEEKDAY_SHORT[weekdayOf(next.date)]}</span>
          <b>{Number(next.date.slice(8, 10))}</b>
          <span>{next.start}</span>
        </span>
        <span className="class-ticket-info">
          <span className="lbl2">{t('Próxima clase que das')}</span>
          <span className="class-ticket-name">{next.name}</span>
          <span className="muted small">{[next.room, next.movedFrom && t('cambió (era {0})', next.movedFrom)].filter(Boolean).join(' · ')}</span>
          {cd.mode === 'days' && <span className="class-ticket-tags"><span className="tag nocap">{cd.label}</span></span>}
        </span>
      </button>
      <GearButton occ={next} onChange={opts.onChange} className="class-ticket-gear" />
    </div>
    <div className="class-ticket-count">
      {soon && <div className="class-ticket-clock">{cd.mode === 'live' ? t('En curso') : <><span className="small muted">{t('Empieza en')}</span> <b>{cd.label}</b></>}</div>}
      {fill !== null && <div className="class-ticket-bar" aria-hidden="true"><span style={{ width: `${Math.round(fill * 100)}%` }} /></div>}
      <div className="small muted">{t('{0} anotados', capacityText(next.booked, next.capacity))}{next.waitlist ? ' · ' + t('{0} en espera', next.waitlist) : ''}</div>
    </div>
    {sameDay.length > 0 && <div className="class-teach-more">
      <div className="lbl2">{next.date === opts.today ? t('También hoy') : t('También ese día')}</div>
      {sameDay.map(o => <div key={o.key} role="button" tabIndex={0} className="class-teach-row" aria-label={t('Ver {0}', o.name)}
        onClick={() => classSheet(o, opts)} onKeyDown={e => { if (e.key === 'Enter') classSheet(o, opts) }}>
        <span className="class-teach-time">{o.start}</span>
        <span className="grow">
          <span className="tt">{o.name}</span>
          <span className="ss">{over(o) ? t('Terminó') : t('{0} anotados', capacityText(o.booked, o.capacity))}{!over(o) && o.waitlist ? ' · ' + t('{0} en espera', o.waitlist) : ''}</span>
        </span>
        <GearButton occ={o} onChange={opts.onChange} />
      </div>)}
    </div>}
  </div>
}

// ---- sin reservas: las clases del día en fila ----

// Las clases del primer día con algo por delante, en una fila que se desliza (el ancho de cada una
// se ajusta al de la pantalla, ver .class-mini). Tocar una abre su hoja, como en Plan → Clases. Sin
// ninguna en la ventana, la invitación de siempre.
function ClassStrip({ date, items, opts, onAll }) {
  if (!items.length) return <div className="card tappable home-class-empty" onClick={onAll}>
    <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="calendar" /></span>
    <div className="grow"><div className="lbl2">{t('Clases')}</div><div className="ttl">{t('Anotate a una clase')}</div></div>
    <Icon name="chevronRight" className="chev" />
  </div>
  const title = date === opts.today ? t('Clases de hoy') : date === addDays(opts.today, 1) ? t('Clases de mañana') : t('Clases del {0}', shortDay(date))
  return <div className="card class-strip-card">
    <div className="class-strip-head">
      <span className="grow ttl">{title}</span>
      <button type="button" className="class-strip-all" onClick={onAll}>{t('Ver todas')} <Icon name="chevronRight" /></button>
    </div>
    <div className="class-strip" role="list">
      {items.map(o => {
        const [text, ...args] = o.state === 'started' ? ['En curso'] : spotsText(o)
        return <button key={o.key} type="button" role="listitem" className={'class-mini' + (text === 'Lista de espera' ? ' full' : '')} style={{ '--c': o.color }}
          onClick={() => classSheet(o, opts)} aria-label={t('Ver {0}', o.name)}>
          <span className="class-mini-time">{o.start}</span>
          <span className="class-mini-name">{o.name}</span>
          <span className="class-mini-spots">{t(text, ...args)}</span>
        </button>
      })}
    </div>
  </div>
}
