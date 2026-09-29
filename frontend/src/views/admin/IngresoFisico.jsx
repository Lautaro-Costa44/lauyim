import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAdmin } from './context.js'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import { errorText, fieldErrors } from '../../lib/errors.js'
import { confirmSheet } from '../../sheets.jsx'
import { setCheckinToken, CHECKIN_ROUTE } from '../../lib/checkin-device.js'
import Icon from '../../components/Icon.jsx'
import { Button, Segmented, Switch, TextField } from '../../components/ui.jsx'

// Ingreso Físico: la tablet o notebook de recepción donde el socio tipea su DNI y queda
// registrado que vino. Configuración (interruptor, modo, dígitos, estado de cuota): solo owner.
// Abrir la pantalla en un dispositivo y revocar dispositivos: cualquier admin.
const POLL_MS = 30000
const hhmm = ms => new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
const dmy = ms => new Date(ms).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
const SOURCES = { physical: 'Físico', qr: 'QR' }

const EXPLAIN = 'Una tablet o notebook en la recepción donde el socio tipea su DNI en un teclado numérico y queda registrado que vino. Ve su nombre y, si querés, el estado de su cuota. Los ingresos suman al gráfico de asistencia. Es distinto del QR de acceso (que sirve para registrarse).'

function EnableCard({ settings, owner, onSave, busy }) {
  const turnOff = () => confirmSheet({
    title: t('¿Desactivar Ingreso Físico?'),
    message: t('Todos los dispositivos dejan de funcionar y quedan desactivados: para volver a usarlos, un admin tiene que activarlos de nuevo. Los ingresos registrados no se borran.'),
    confirmText: t('Desactivar'), danger: true,
    onConfirm: () => onSave({ enabled: false }),
  })
  return <div className="card">
    <div className="row between" style={{ gap: 12 }}>
      <div className="grow">
        <h2 style={{ margin: 0 }}>{t('Ingreso Físico')}</h2>
        <div className="small muted" style={{ marginTop: 6, lineHeight: 1.45 }}>{t(EXPLAIN)}</div>
      </div>
      {owner && <Switch label={t('Ingreso Físico')} checked={settings.enabled} disabled={busy}
        onChange={v => v ? onSave({ enabled: true }) : turnOff()} />}
    </div>
  </div>
}

function IdentifyCard({ settings, billingEnabled, owner, onSave, busy }) {
  return <div className="card">
    <h2 style={{ margin: 0 }}>{t('Identificación')}</h2>
    <div className="small muted" style={{ margin: '6px 0 12px' }}>{t('Qué tipea el socio en el teclado.')}</div>
    <Segmented value={settings.mode} onChange={v => owner && !busy && onSave({ mode: v })}
      options={[{ value: 'full', label: t('DNI completo') }, { value: 'last', label: t('Últimos dígitos') }]} />
    {settings.mode === 'last' && <div className="row between" style={{ marginTop: 12, gap: 12 }}>
      <div className="grow small">{t('Cantidad de dígitos')}<div className="dim small">{t('Si varios socios coinciden, elige su nombre de una lista (nombre e inicial del apellido).')}</div></div>
      <Segmented value={String(settings.digits)} onChange={v => owner && !busy && onSave({ digits: Number(v) })}
        options={[3, 4, 5].map(n => ({ value: String(n), label: String(n) }))} />
    </div>}
    <div className="row between" style={{ marginTop: 14, gap: 12 }}>
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{t('Mostrar el estado de la cuota')}</div>
        <div className="small muted" style={{ marginTop: 2 }}>{billingEnabled
          ? t('Al día, por vencer, vencida, bloqueado o en prueba, con los días que faltan.')
          : t('El cobro de cuotas está desactivado: el estado no se muestra.')}</div>
      </div>
      {owner && <Switch label={t('Mostrar el estado de la cuota')} checked={settings.showStatus && billingEnabled} disabled={busy || !billingEnabled}
        onChange={v => onSave({ showStatus: v })} />}
    </div>
    {!owner && <div className="dim small" style={{ marginTop: 10 }}>{t('Solo el dueño cambia esta configuración.')}</div>}
  </div>
}

// Nombre del dispositivo antes de activarlo. Activar cierra la sesión del admin en este
// navegador: la recepción no conserva datos de nadie.
function ActivateSheet({ close }) {
  const toast = useUI(s => s.toast)
  const [name, setName] = useState('Tablet recepción')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const activate = async () => {
    if (!name.trim()) return setError(t('Poné un nombre para el dispositivo'))
    setBusy(true); setError(null)
    try {
      const { token } = await api('/api/admin/checkin/devices', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
      setCheckinToken(token)
      close()
      await useStore.getState().signOut()
      window.location.hash = '#' + CHECKIN_ROUTE
    } catch (e) {
      setBusy(false)
      setError(fieldErrors(e).name || errorText(e))
      if (!e?.status) toast(errorText(e))
    }
  }
  return <>
    <h3>{t('Abrir Ingreso Físico en este dispositivo')}</h3>
    <div className="small muted" style={{ marginBottom: 12, lineHeight: 1.45 }}>{t('Este navegador queda como pantalla de Ingreso Físico y se cierra tu sesión en él. Para salir de la pantalla hace falta la passkey de un admin.')}</div>
    <label className="member-field">
      <span className="member-field-l">{t('Nombre del dispositivo')}</span>
      <TextField type="text" inputMode="text" value={name} maxLength={40} onChange={e => { setName(e.target.value); setError(null) }} aria-invalid={!!error} />
      {error && <span className="form-error" role="alert">{error}</span>}
    </label>
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="play" disabled={busy} onClick={activate}>{busy ? t('Activando…') : t('Activar y abrir')}</Button>
  </>
}

function DevicesCard({ devices, onRevoke }) {
  const openSheet = useUI(s => s.openSheet)
  const revoke = d => confirmSheet({
    title: t('¿Revocar "{0}"?', d.name),
    message: t('El dispositivo deja de funcionar al instante. Para volver a usarlo, un admin tiene que activarlo de nuevo.'),
    confirmText: t('Revocar'), danger: true,
    onConfirm: () => onRevoke(d),
  })
  return <div className="card">
    <h2 style={{ margin: 0 }}>{t('Dispositivos')}</h2>
    {devices.length ? <div className="list" style={{ marginTop: 10 }}>
      {devices.map(d => <div key={d.id} className="item">
        <span className="lrow-i"><Icon name="key" /></span>
        <div className="grow">
          <div className="tt">{d.name}</div>
          <div className="ss">{t('Alta {0}', dmy(d.createdAt))} · {d.lastUsedAt ? t('Último uso {0} {1}', dmy(d.lastUsedAt), hhmm(d.lastUsedAt)) : t('Sin uso todavía')}</div>
        </div>
        <Button size="sm" variant="tinted" onClick={() => revoke(d)}>{t('Revocar')}</Button>
      </div>)}
    </div> : <div className="dim small" style={{ margin: '8px 0 4px' }}>{t('Ningún dispositivo activado.')}</div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="play" onClick={() => openSheet(close => <ActivateSheet close={close} />)}>{t('Abrir Ingreso Físico en este dispositivo')}</Button>
  </div>
}

function TodayCard({ checkins, onRefresh }) {
  return <div className="card">
    <div className="row between" style={{ gap: 10 }}>
      <h2 style={{ margin: 0 }}>{t('Ingresos de hoy')}</h2>
      <button className="iconbtn" onClick={onRefresh} aria-label={t('Actualizar')} title={t('Actualizar')}><Icon name="reset" /></button>
    </div>
    {checkins.length ? <div className="list" style={{ marginTop: 10 }}>
      {checkins.map(c => <div key={c.userId + c.at} className="item">
        <div className="grow"><div className="tt">{c.name}</div></div>
        <span className="tag">{t(SOURCES[c.source] || c.source)}</span>
        <span className="dim small" style={{ minWidth: 44, textAlign: 'right' }}>{hhmm(c.at)}</span>
      </div>)}
    </div> : <div className="dim small" style={{ marginTop: 8 }}>{t('Todavía no hay ingresos hoy.')}</div>}
  </div>
}

export default function IngresoFisico() {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const { setCheckinEnabled } = useAdmin()
  const owner = !!user?.owner
  const [data, setData] = useState(null)
  const [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = () => api('/api/admin/checkin').then(d => { setData(d); setCheckinEnabled?.(d.settings.enabled) })
    .catch(e => { if (e?.data?.error === 'feature_disabled') { setDenied(true); setCheckinEnabled?.(false) } else toast(errorText(e)) })
  // Ingresos de hoy con polling liviano mientras la sección está abierta.
  useEffect(() => { load(); const iv = setInterval(load, POLL_MS); return () => clearInterval(iv) }, [])

  if (denied) return <Navigate to="/admin/resumen" replace />
  if (!data) return <div className="card"><div className="dim small">{t('Loading…')}</div></div>

  const save = patch => {
    setBusy(true)
    api('/api/owner/checkin/settings', { method: 'PUT', body: JSON.stringify(patch) })
      .then(() => { toast(t('Guardado')); return load() })
      .catch(e => toast(errorText(e)))
      .finally(() => setBusy(false))
  }
  const revoke = d => api('/api/admin/checkin/devices/' + d.id, { method: 'DELETE' })
    .then(() => { toast(t('Dispositivo revocado')); load() })
    .catch(e => toast(errorText(e)))

  const { settings } = data
  return <div className="admin-cards">
    <EnableCard settings={settings} owner={owner} onSave={save} busy={busy} />
    {settings.enabled && <>
      <IdentifyCard settings={settings} billingEnabled={data.billingEnabled} owner={owner} onSave={save} busy={busy} />
      <DevicesCard devices={data.devices} onRevoke={revoke} />
      <TodayCard checkins={data.checkins} onRefresh={load} />
    </>}
  </div>
}
