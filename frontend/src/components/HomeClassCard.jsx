// Inicio: la próxima clase a la que está anotado el socio, o "Ver clases". Solo con el módulo de
// clases prendido y clases cargadas (/api/config → classes_available).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { classesApi, timeRange } from '../lib/classes.js'
import { classSheet, dayLabel } from './ClassSheet.jsx'
import Icon from './Icon.jsx'

// La primera fecha con reserva activa que todavía no empezó.
export const nextBooked = occurrences => (occurrences || []).find(o => o.state !== 'started' && !o.cancelled && o.myBooking && ['booked', 'waitlist'].includes(o.myBooking.status)) || null

export default function HomeClassCard() {
  const nav = useNavigate()
  const on = useStore(s => !!s.config?.classes_available)
  const [data, setData] = useState(null)
  const load = () => classesApi.list().then(setData).catch(() => setData(null))
  useEffect(() => { if (on) load() }, [on])
  if (!on) return null
  const next = nextBooked(data?.occurrences)
  if (!next) {
    return <div className="card tappable home-class" style={{ cursor: 'pointer' }} onClick={() => nav('/plan/clases')}>
      <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="calendar" /></span>
      <div className="grow"><div className="lbl2">{t('Clases')}</div><div className="ttl">{t('Ver clases')}</div></div>
      <Icon name="chevronRight" className="chev" />
    </div>
  }
  const waiting = next.myBooking.status === 'waitlist'
  return <div className="card tappable home-class" style={{ cursor: 'pointer' }}
    onClick={() => classSheet(next, { today: data.today, tz: data.tz, cancelHours: data.settings?.cancelHours ?? 2, onChange: load })}>
    <span className="lrow-i" style={{ background: next.color }}><Icon name={next.icon || 'dumbbell'} /></span>
    <div className="grow">
      <div className="lbl2">{t('Tu próxima clase')}</div>
      <div className="ttl">{next.name} · {dayLabel(next.date, data.today)} {timeRange(next).split('–')[0]}</div>
      <div className="muted small">{next.teacherName ? t('con {0}', next.teacherName) : ''}{next.teacherName && next.room ? ' · ' : ''}{next.room}</div>
    </div>
    <span className="tag" style={waiting ? undefined : { color: 'var(--green)', background: 'color-mix(in srgb,var(--green) 16%,transparent)' }}>
      {waiting ? t('En espera (n.º {0})', next.myBooking.waitlistPos) : t('Anotado')}
    </span>
  </div>
}
