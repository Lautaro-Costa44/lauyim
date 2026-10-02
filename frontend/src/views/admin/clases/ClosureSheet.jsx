// Cerrar el gimnasio (feriado, vacaciones): un día o varios, con un motivo. La vista previa dice
// cuántas clases se suspenden y a cuántas personas les avisamos (un aviso por persona). Y la lista
// de próximos cierres, cada uno con "Reabrir".
import { useEffect, useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { t } from '../../../lib/i18n.js'
import { errorText } from '../../../lib/errors.js'
import { addDays, classesApi, closureLabel } from '../../../lib/classes.js'
import { Button, Segmented, TextField } from '../../../components/ui.jsx'
import Icon from '../../../components/Icon.jsx'

const ui = () => useUI.getState()
const REASONS = ['Feriado', 'Vacaciones', 'Mantenimiento']

function Closure({ today, onChange, close }) {
  const [mode, setMode] = useState('one')
  const [from, setFrom] = useState(addDays(today, 1))
  const [to, setTo] = useState(addDays(today, 1))
  const [reason, setReason] = useState('Feriado')
  const [preview, setPreview] = useState(null)   // { classes, people } | { error }
  const [busy, setBusy] = useState(false)
  const end = mode === 'one' ? from : to
  useEffect(() => {
    setPreview(null)
    const id = setTimeout(() => classesApi.closurePreview(from, end)
      .then(setPreview).catch(e => setPreview({ error: errorText(e, t('Revisá las fechas')) })), 250)
    return () => clearTimeout(id)
  }, [from, end])
  const save = async () => {
    setBusy(true)
    try {
      const r = await classesApi.addClosure({ from, to: end, reason: reason.trim() })
      ui().toast(r.notified ? t('Gimnasio cerrado: avisamos a {0}', r.notified === 1 ? t('1 persona') : t('{0} personas', r.notified)) : t('Gimnasio cerrado'))
      onChange && onChange()
      close()
    } catch (e) { ui().toast(errorText(e, t('No se pudo cerrar'))) }
    setBusy(false)
  }
  const ready = preview && !preview.error
  return <div className="class-closure">
    <h3>{t('Cerrar el gimnasio')}</h3>
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
      <TextField name="class-closure-reason" maxLength={40} value={reason} onChange={e => setReason(e.target.value)} placeholder={t('Otro motivo (opcional)')} />
    </div>
    <div className={'class-closure-preview small' + (preview?.error ? ' error' : '')} role="status">
      <Icon name="info" />
      {!preview ? t('Calculando…')
        : preview.error ? preview.error
        : preview.classes === 0 ? t('No hay clases esos días. Igual queda cerrado.')
        : t('Se suspenden {0} y le avisamos a {1}.', preview.classes === 1 ? t('1 clase') : t('{0} clases', preview.classes), preview.people === 1 ? t('1 persona') : t('{0} personas', preview.people))}
    </div>
    <Button variant="danger" icon="lock" disabled={!ready || busy} onClick={save}>{preview?.people ? t('Cerrar y avisar') : t('Cerrar')}</Button>
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}

export function closureSheet({ today, onChange }) {
  ui().openSheet(close => <Closure today={today} onChange={onChange} close={close} />)
}

// Próximos cierres (Admin → Clases). Reabrir devuelve las fechas, no las reservas canceladas.
export function ClosureList({ closures, canManage, onChange }) {
  if (!closures?.length) return null
  const reopen = c => import('../../../sheets.jsx').then(({ confirmSheet }) => confirmSheet({
    title: t('¿Reabrir {0}?', closureLabel(c)),
    message: t('Las clases de esos días vuelven a estar disponibles. Las reservas que se cancelaron no vuelven; las fijas se reservan solas de nuevo.'),
    confirmText: t('Reabrir'),
    onConfirm: async () => {
      try { await classesApi.deleteClosure(c.id); ui().toast(t('Reabierto')); onChange && onChange() }
      catch (e) { ui().toast(errorText(e, t('No se pudo reabrir'))) }
    }
  }))
  return <div className="class-closures">
    {closures.map(c => <div key={c.id} className="class-closure-row">
      <Icon name="lock" />
      <div className="grow"><b>{t('Cerrado')} · {closureLabel(c)}</b>{c.reason && <span className="small muted"> · {c.reason}</span>}</div>
      {canManage && <Button size="sm" variant="plain" onClick={() => reopen(c)}>{t('Reabrir')}</Button>}
    </div>)}
  </div>
}
