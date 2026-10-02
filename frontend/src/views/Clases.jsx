// Plan → Clases: las clases del gimnasio día por día, con cupo y el botón de anotarse. Tocar una
// clase abre su hoja (components/ClassSheet.jsx). ?d=YYYY-MM-DD abre en ese día (los avisos).
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { errorText } from '../lib/errors.js'
import { buttonState, capacityText, timeRange, dayChips, shortDay, classesApi, closureOn, planLine } from '../lib/classes.js'
import { classSheet, classAction } from '../components/ClassSheet.jsx'
import { GearButton } from '../components/TeacherClass.jsx'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

export default function Clases() {
  const loc = useLocation()
  const asked = new URLSearchParams(loc.search).get('d')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [day, setDay] = useState(asked || null)
  const [busyKey, setBusyKey] = useState(null)

  const load = () => classesApi.list().then(d => { setData(d); setError(null); setDay(cur => cur && d.occurrences.some(o => o.date === cur) ? cur : cur || d.today) })
    .catch(e => setError(errorText(e, t('No se pudieron cargar las clases'))))
  useEffect(() => { load() }, [])

  if (error) return <div className="empty">{error}<div style={{ height: 10 }} /><Button size="sm" onClick={load}>{t('Reintentar')}</Button></div>
  if (!data) return <div className="dim small" aria-busy="true">{t('Loading…')}</div>
  if (!data.enabled) return <div className="empty">{t('El gimnasio no tiene clases por ahora.')}</div>

  const chips = dayChips(data.today, data.days)
  const ofDay = data.occurrences.filter(o => o.date === day)
  const opts = { today: data.today, tz: data.tz, cancelHours: data.settings?.cancelHours ?? 2, onChange: load }
  const act = async (e, occ) => {
    e.stopPropagation()
    const state = buttonState(occ)
    if (state.key === 'booked' || state.key === 'waiting') return classSheet(occ, opts)
    setBusyKey(occ.key)
    await classAction(occ, opts)
    setBusyKey(null)
  }

  return <div className="classes">
    {data.penalty && <div className="access-warn small class-penalty" role="note">
      {t('Por {0} ausencias en el último mes no podés reservar hasta el {1}.', data.penalty.count, shortDay(data.penalty.until))}
    </div>}
    {data.planLimit && (() => {
      const [text, ...args] = planLine(data.planLimit, day, data.today)
      return <div className="small muted class-plan-line" role="note"><Icon name="info" /> {t(text, ...args)}</div>
    })()}
    <div className="chips class-days" role="tablist" aria-label={t('Días')}>
      {chips.map(c => {
        const has = data.occurrences.some(o => o.date === c.date && !o.cancelled)
        const closed = closureOn(data.closures, c.date)
        return <button key={c.date} role="tab" aria-selected={c.date === day} aria-label={closed ? t('{0}, cerrado', t(c.label)) : undefined}
          className={'chip' + (c.date === day ? ' on' : '') + (has ? '' : ' dim') + (closed ? ' closed' : '')} onClick={() => setDay(c.date)}>
          {closed && <Icon name="lock" />}{t(c.label)}</button>
      })}
    </div>
    {/* Día cerrado (feriado, vacaciones): el aviso en lugar de la lista. */}
    {closureOn(data.closures, day) ? <div className="empty class-closed-day"><Icon name="lock" /><div>{t('El gimnasio está cerrado')}{closureOn(data.closures, day).reason ? ' · ' + closureOn(data.closures, day).reason : ''}</div></div>
      : ofDay.length === 0
      ? <div className="empty">{t('No hay clases este día.')}</div>
      : <div className="list class-list">
          {ofDay.map(occ => {
            const state = buttonState(occ)
            return <div key={occ.key} role="button" tabIndex={0} className={'item class-item' + (occ.cancelled ? ' cancelled' : '')}
              onClick={() => classSheet(occ, opts)} onKeyDown={e => { if (e.key === 'Enter') classSheet(occ, opts) }}>
              <span className="class-bar" style={{ background: occ.color }} aria-hidden="true" />
              <div className="grow">
                <div className="class-time">{timeRange(occ)}{occ.movedFrom ? <span className="tag" style={{ marginLeft: 6 }}>{t('cambió')}</span> : null}{occ.teaching ? <span className="tag nocap class-tag-present" style={{ marginLeft: 6 }}>{t('La das vos')}</span> : null}</div>
                <div className="tt">{occ.name}</div>
                <div className="ss">{[occ.teacherName, occ.room, occ.capacity == null ? t('{0} anotados', occ.booked) : capacityText(occ.booked, occ.capacity)].filter(Boolean).join(' · ')}</div>
              </div>
              {/* La profe: en lugar de anotarse, la rueda para gestionar la fecha. */}
              {occ.teaching ? <GearButton occ={occ} onChange={load} />
                : <Button size="sm" variant={state.key === 'book' ? 'primary' : state.key === 'booked' ? 'tinted' : 'plain'}
                disabled={state.disabled || busyKey === occ.key} onClick={e => act(e, occ)}
                icon={state.key === 'booked' ? 'check' : undefined}>{t(state.label)}</Button>}
            </div>
          })}
        </div>}
    <div className="small dim class-hint"><Icon name="info" /> {t('Podés cancelar sin problema hasta {0} horas antes.', opts.cancelHours)}</div>
  </div>
}
