// Admin → Resumen: próximos cierres (y el que está en curso) con su estado, "＋ Cerrar" y "Reabrir"
// para quien tiene gym.closures. El owner no necesita permiso. Devolver días corridos pide fees.manage.
import { useEffect, useState } from 'react'
import { useStore } from '../../../store/useStore.js'
import { can } from '../../../lib/permissions.js'
import { t } from '../../../lib/i18n.js'
import { closuresApi, closureLabel } from '../../../lib/closures.js'
import { closureSheet, reopenClosure } from './ClosureSheet.jsx'
import { Button } from '../../../components/ui.jsx'
import Icon from '../../../components/Icon.jsx'
import { todayISO } from '../../../lib/format.js'

const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
// "aviso: hoy 08:00", "aviso: 12/10 08:00", "avisado a todos", "3 con reserva avisados", "vencimientos +1 día".
export function statusLine(c, now = Date.now()) {
  const bits = []
  if (c.notifyAll) {
    if (c.announcedAt) bits.push(t('avisado a todos'))
    else if (c.announceAt) {
      const d = new Date(c.announceAt)
      bits.push(t('aviso: {0} {1}', d.toDateString() === new Date(now).toDateString() ? t('hoy') : `${d.getDate()}/${d.getMonth() + 1}`, hhmm(d)))
    }
  }
  if (c.notified) bits.push(c.notified === 1 ? t('1 con reserva avisado') : t('{0} con reserva avisados', c.notified))
  if (c.extended) bits.push(c.extendDays === 1 ? t('vencimientos +1 día') : t('vencimientos +{0} días', c.extendDays))
  return bits.join(' · ')
}

export default function ClosuresCard() {
  const user = useStore(s => s.user)
  const manage = can(user, 'gym.closures')
  const canRevert = can(user, 'fees.manage')
  const [data, setData] = useState(null)
  const load = () => closuresApi.list().then(setData).catch(() => setData({ today: null, closures: [] }))
  useEffect(() => { load() }, [])
  if (!data) return null
  const list = (data.closures || []).filter(c => !data.today || c.to >= data.today)
  return <div className="card closures-card">
    <div className="row between">
      <h3 style={{ margin: 0 }} className="row"><Icon name="lock" /> {t('Cierres')}</h3>
      {manage && <Button size="sm" icon="plus" data-action="close-gym" onClick={() => closureSheet({ today: data.today || todayISO(), onChange: load })}>{t('Cerrar')}</Button>}
    </div>
    {!list.length ? <div className="small muted" style={{ marginTop: 6 }}>{t('No hay cierres programados')}</div>
      : list.map(c => <div key={c.id} className="closure-row">
        <div className="grow"><b>{closureLabel(c)}</b>{c.reason && <span className="small muted"> · {c.reason}</span>}
          {statusLine(c) && <div className="small muted">{statusLine(c)}</div>}</div>
        {manage && <Button size="sm" variant="plain" onClick={() => reopenClosure(c, { canRevert, onChange: load })}>{t('Reabrir')}</Button>}
      </div>)}
  </div>
}
