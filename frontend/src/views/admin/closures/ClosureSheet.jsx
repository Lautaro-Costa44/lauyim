// Cerrar el gimnasio (feriado, vacaciones): fechas, motivo, impacto (clases suspendidas, avisos) y
// las dos decisiones: avisar a todos (a la hora de avisos de cierre) y correr los vencimientos (solo
// con cuotas prendido y permiso de cuotas: lo decide el servidor en la vista previa). En PC, dos
// columnas. Reabrir: devolver los días corridos (prendido por defecto).
import { useEffect, useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { t } from '../../../lib/i18n.js'
import { errorText } from '../../../lib/errors.js'
import { closuresApi, closureLabel } from '../../../lib/closures.js'
import { addDays } from '../../../lib/classes.js'
import { Button, Segmented, Switch, TextField } from '../../../components/ui.jsx'
import Icon from '../../../components/Icon.jsx'

const ui = () => useUI.getState()
const REASONS = ['Feriado', 'Vacaciones', 'Mantenimiento']
const people = n => n === 1 ? t('1 persona') : t('{0} personas', n)
const members = n => n === 1 ? t('1 socio') : t('{0} socios', n)
const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

// "sale ahora", "sale hoy a las 08:00", "sale mañana a las 08:00" o "sale el 12/10 a las 08:00"
// (hora del navegador del staff, que en la práctica es la del gimnasio).
export function whenText(ms, now = Date.now()) {
  if (!ms || ms <= now + 60000) return t('sale ahora')
  const d = new Date(ms), today = new Date(now)
  const tomorrow = new Date(now); tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return t('sale hoy a las {0}', hhmm(d))
  if (d.toDateString() === tomorrow.toDateString()) return t('sale mañana a las {0}', hhmm(d))
  return t('sale el {0} a las {1}', `${d.getDate()}/${d.getMonth() + 1}`, hhmm(d))
}

function Closure({ today, onChange, close }) {
  const [mode, setMode] = useState('one')
  const [from, setFrom] = useState(addDays(today, 1))
  const [to, setTo] = useState(addDays(today, 1))
  const [reason, setReason] = useState('Feriado')
  const [preview, setPreview] = useState(null)   // respuesta de la vista previa | { error }
  const [notifyAll, setNotifyAll] = useState(true)
  const [extendOn, setExtendOn] = useState(false)
  const [extendDays, setExtendDays] = useState(1)
  const [busy, setBusy] = useState(false)
  const end = mode === 'one' ? from : to
  useEffect(() => {
    setPreview(null)
    const id = setTimeout(() => closuresApi.preview(from, end)
      .then(p => { setPreview(p); setExtendDays(p.days) })
      .catch(e => setPreview({ error: errorText(e, t('Revisá las fechas')) })), 250)
    return () => clearTimeout(id)
  }, [from, end])
  const ready = preview && !preview.error
  const notifies = ready && (preview.booked > 0 || (notifyAll && preview.appMembers > 0))
  const save = async () => {
    setBusy(true)
    try {
      const r = await closuresApi.add({ from, to: end, reason: reason.trim(), notifyAll, extendDays: extendOn && preview?.extend ? extendDays : 0 })
      const bits = [r.notified ? t('avisamos a {0} con reserva', people(r.notified)) : null, r.extended ? t('vencimientos corridos a {0}', members(r.extended)) : null].filter(Boolean)
      ui().toast(bits.length ? t('Gimnasio cerrado: {0}', bits.join(' · ')) : t('Gimnasio cerrado'))
      onChange && onChange()
      close()
    } catch (e) { ui().toast(errorText(e, t('No se pudo cerrar'))) }
    setBusy(false)
  }
  return <div className="closure-sheet">
    <h3>{t('Cerrar el gimnasio')}</h3>
    <div className="closure-cols">
      <div>
        <Segmented options={[{ value: 'one', label: t('Un día') }, { value: 'range', label: t('Varios días') }]} value={mode}
          onChange={m => { setMode(m); if (m === 'range' && to < from) setTo(from) }} />
        <div className="class-editor-row">
          <label className="member-field"><span className="member-field-l">{mode === 'one' ? t('Fecha') : t('Desde')}</span>
            <input className="input" type="date" min={today} value={from} onChange={e => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value) }} /></label>
          {mode === 'range' && <label className="member-field"><span className="member-field-l">{t('Hasta')}</span>
            <input className="input" type="date" min={from} value={to} onChange={e => setTo(e.target.value)} /></label>}
        </div>
        <div className="member-field">
          <span className="member-field-l">{t('Motivo')}</span>
          <div className="chips">{REASONS.map(r => <button key={r} type="button" className={'chip nocap' + (reason === r ? ' on' : '')} aria-pressed={reason === r} onClick={() => setReason(r)}>{t(r)}</button>)}</div>
          <TextField name="closure-reason" maxLength={40} value={reason} onChange={e => setReason(e.target.value)} placeholder={t('Otro motivo (opcional)')} />
        </div>
      </div>
      <div>
        <div className={'class-closure-preview small' + (preview?.error ? ' error' : '')} role="status">
          <Icon name="info" />
          <div>{!preview ? t('Calculando…') : preview.error ? preview.error : <>
            <div>{preview.days === 1 ? t('1 día cerrado') : t('{0} días cerrado', preview.days)}{preview.classes ? ' · ' + (preview.classes === 1 ? t('se suspende 1 clase') : t('se suspenden {0} clases', preview.classes)) : ''}</div>
            {preview.booked > 0 && <div>{t('{0} con reserva: se les avisa ahora', people(preview.booked))}</div>}
          </>}</div>
        </div>
        {ready && <div className="closure-toggle">
          <div className="grow">{t('Avisar a todos los socios')}<div className="small muted">{t('{0} con la app', preview.appMembers)} · {whenText(preview.announceAt)}</div></div>
          <Switch label={t('Avisar a todos los socios')} checked={notifyAll} onChange={setNotifyAll} />
        </div>}
        {ready && preview.extend && <div className="closure-toggle">
          <div className="grow">{t('Correr los vencimientos')}
            <div className="small muted">{extendDays === 1 ? t('+1 día a {0} al día o por vencer', members(preview.extend.members)) : t('+{0} días a {1} al día o por vencer', extendDays, members(preview.extend.members))}{preview.extend.trials ? ' ' + t('(y {0} en prueba)', preview.extend.trials) : ''}</div>
            {extendOn && preview.days > 1 && <input className="input closure-days" type="number" min={1} max={preview.days} value={extendDays} aria-label={t('Días a correr')}
              onChange={e => setExtendDays(Math.max(1, Math.min(preview.days, Number(e.target.value) || 1)))} />}
          </div>
          <Switch label={t('Correr los vencimientos')} checked={extendOn} onChange={setExtendOn} />
        </div>}
      </div>
    </div>
    <div className="closure-actions">
      <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
      <Button variant="danger" icon="lock" data-action="confirm-closure" disabled={!ready || busy} onClick={save}>{notifies ? t('Cerrar y avisar') : t('Cerrar')}</Button>
    </div>
  </div>
}

export function closureSheet({ today, onChange }) {
  ui().openSheet(close => <Closure today={today} onChange={onChange} close={close} />, { kind: 'panel' })
}

function Reopen({ c, canRevert, onChange, close }) {
  const [revert, setRevert] = useState(true)
  const go = async () => {
    try {
      const r = await closuresApi.remove(c.id, canRevert && c.extended > 0 ? revert : false)
      ui().toast(r.reverted ? t('Reabierto: devolvimos los días a {0}', members(r.reverted)) : t('Reabierto'))
      onChange && onChange()
    } catch (e) { ui().toast(errorText(e, t('No se pudo reabrir'))) }
    close()
  }
  return <div className="closure-reopen">
    <h3>{t('¿Reabrir {0}?', closureLabel(c))}</h3>
    <p className="small muted">{t('Las clases de esos días vuelven a estar disponibles. Las reservas que se cancelaron no vuelven; las fijas se reservan solas de nuevo.')}</p>
    {c.notifyAll && !c.announcedAt && <p className="small muted">{t('El aviso a los socios todavía no salió: se cancela.')}</p>}
    {canRevert && c.extended > 0 && <div className="closure-toggle">
      <div className="grow">{c.extendDays === 1 ? t('Devolver el día corrido a {0}', members(c.extended)) : t('Devolver los {0} días a {1}', c.extendDays, members(c.extended))}</div>
      <Switch label={t('Devolver los días corridos')} checked={revert} onChange={setRevert} />
    </div>}
    <div className="closure-actions">
      <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
      <Button variant="primary" onClick={go}>{t('Reabrir')}</Button>
    </div>
  </div>
}

export function reopenClosure(c, { canRevert, onChange }) {
  ui().openSheet(close => <Reopen c={c} canRevert={canRevert} onChange={onChange} close={close} />, { kind: 'center' })
}
