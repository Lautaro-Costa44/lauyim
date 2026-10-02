// Ficha del socio → Clases: el último mes (presentes, ausentes, tardías y % de asistencia), la
// penalización vigente (que quien gestiona todas las clases puede levantar), las próximas reservas
// (recepción puede cancelarlas: a tiempo, sin penalización y con aviso) y los días fijos.
import { useEffect, useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { t } from '../../../lib/i18n.js'
import { errorText } from '../../../lib/errors.js'
import { classesApi, shortDay } from '../../../lib/classes.js'
import { Button } from '../../../components/ui.jsx'
import Icon from '../../../components/Icon.jsx'

const ui = () => useUI.getState()
const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const SHOWN = 5

export default function ClassesMemberCard({ userId, userName }) {
  const [d, setD] = useState(null)
  const [all, setAll] = useState(false)
  const load = () => classesApi.member(userId).then(setD).catch(() => setD(false))
  useEffect(() => { load() }, [userId])
  if (!d) return null
  const confirm = opts => import('../../../sheets.jsx').then(({ confirmSheet }) => confirmSheet(opts))
  const cancel = u => confirm({
    title: t('¿Cancelar {0} del {1}?', u.name, `${shortDay(u.date)} ${u.start}`),
    message: t('Se cancela a tiempo (sin penalización), entra la primera de la lista de espera y le avisamos a {0}.', userName),
    confirmText: t('Cancelar el lugar'), cancelText: t('Volver'), danger: true,
    onConfirm: async () => {
      try { await classesApi.cancelForMember(u.bookingId); ui().toast(t('Lugar cancelado')); load() }
      catch (e) { ui().toast(errorText(e, t('No se pudo cancelar'))) }
    }
  })
  const reset = () => confirm({
    title: t('¿Levantar la penalización?'),
    message: t('{0} vuelve a poder reservar ya. Las ausencias hasta hoy dejan de contar.', userName),
    confirmText: t('Levantar'),
    onConfirm: async () => {
      try { await classesApi.resetPenalty(userId); ui().toast(t('Penalización levantada')); load() }
      catch (e) { ui().toast(errorText(e, t('No se pudo guardar'))) }
    }
  })
  const { month, penalty, upcoming, fixed } = d
  const empty = !upcoming.length && !fixed.length && !month.present && !month.absent && !month.late
  const shown = all ? upcoming : upcoming.slice(0, SHOWN)
  return <div className="card member-classes">
    <div className="member-classes-head"><Icon name="calendar" /><h2>{t('Clases')}</h2><span className="small muted">{t('último mes')}</span></div>
    {empty ? <div className="small muted">{t('Todavía no fue a ninguna clase.')}</div> : <>
      <div className="member-classes-tiles">
        <div><b>{month.present}</b><span>{t('presentes')}</span></div>
        <div><b>{month.absent}</b><span>{t('ausentes')}</span></div>
        <div><b>{month.late}</b><span>{t('tardías')}</span></div>
        <div><b>{month.rate == null ? '—' : `${month.rate}%`}</b><span>{t('asistencia')}</span></div>
      </div>
      {penalty && <div className="access-warn small member-classes-penalty" role="note">
        <Icon name="warning" /> {t('No puede reservar hasta el {0} · {1} ausencias', shortDay(penalty.until), penalty.count)}
      </div>}
      {penalty && d.canReset && <Button size="sm" variant="tinted" onClick={reset}>{t('Levantar penalización')}</Button>}
      {upcoming.length > 0 && <>
        <h4 className="sec">{t('Próximas')}</h4>
        <div className="list">{shown.map(u => <div key={u.bookingId} className="item">
          <span className="class-bar" style={{ background: u.color }} aria-hidden="true" />
          <div className="grow"><div className="tt">{u.name}</div>
            <div className="ss">{shortDay(u.date)} · {u.start} · {u.status === 'waitlist' ? t('En espera n.º {0}', u.waitlistPos) : t('Anotado')}</div></div>
          {d.canCancel && <Button size="sm" variant="plain" className="member-classes-cancel" onClick={() => cancel(u)}>{t('Cancelar')}</Button>}
        </div>)}</div>
        {upcoming.length > SHOWN && !all && <Button size="sm" variant="plain" onClick={() => setAll(true)}>{t('Ver todas ({0})', upcoming.length)}</Button>}
      </>}
      {fixed.length > 0 && <>
        <h4 className="sec">{t('Fijas')}</h4>
        <div className="chips">{fixed.map(f => <span key={f.slotId} className="chip nocap member-classes-fixed" style={{ '--c': f.color }}>{WEEKDAY_SHORT[f.weekday]} {f.start} {f.name}</span>)}</div>
      </>}
    </>}
  </div>
}
