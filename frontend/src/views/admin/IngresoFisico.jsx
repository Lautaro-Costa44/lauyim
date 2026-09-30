import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAdmin } from './context.js'
import { UserDetail } from './shared.jsx'
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

// "Juan Fernández [Juani]": nombre y apellido de la ficha y, entre corchetes, el nombre de usuario.
// Sin nombre y apellido cargado, solo el usuario; si son iguales, una sola vez.
export function checkinName({ fullName, nick }) {
  if (!fullName) return nick || ''
  return nick && nick.trim().toLowerCase() !== fullName.trim().toLowerCase() ? `${fullName} [${nick}]` : fullName
}
// Cuota de hoy, corta, para el registro: "Vence en 3 días", "Venció hace 2 días", "Prueba: 1 día".
export function feeShort({ status, days }) {
  const d = n => t(n === 1 ? '{0} día' : '{0} días', n)
  if (status === 'sin_plan') return t('Sin plan')
  if (days == null) return null
  if (status === 'prueba') return days === 0 ? t('Prueba: termina hoy') : t('Prueba: {0}', d(days))
  if (days > 0) return t('Vence en {0}', d(days))
  if (days === 0) return t('Vence hoy')
  return t('Venció hace {0}', d(-days))
}
const initials = ({ fullName, nick }) => (fullName || nick || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

// Días como YYYY-MM-DD en UTC al mediodía: el calendario del gym, sin que el huso del navegador
// corra la fecha.
const shiftDay = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function dayLabel(date, today) {
  if (date === today) return t('Hoy')
  if (date === shiftDay(today, -1)) return t('Ayer')
  const label = new Date(date + 'T12:00:00Z').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// Registro de ingresos: hoy por defecto (se refresca solo) y cualquier día anterior con las
// flechas o eligiendo la fecha. Los ingresos se guardan sin vencimiento.
function CheckinLogCard({ date, today, checkins, loading, onDate, onRefresh, onOpen }) {
  const isToday = date === today
  const count = checkins.length
  return <div className="card checkin-log">
    <div className="row between" style={{ gap: 10 }}>
      <h2 style={{ margin: 0 }}>{t('Registro de ingresos')}</h2>
      <button className="iconbtn" onClick={onRefresh} aria-label={t('Actualizar')} title={t('Actualizar')}><Icon name="reset" /></button>
    </div>
    <div className="checkin-log-nav">
      <button className="iconbtn" onClick={() => onDate(shiftDay(date, -1))} aria-label={t('Día anterior')}><Icon name="chevronLeft" /></button>
      <label className="checkin-log-day">
        <span className="checkin-log-day-t">{dayLabel(date, today)}</span>
        <span className="checkin-log-day-s">{new Date(date + 'T12:00:00Z').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })} · {loading ? t('Cargando…') : t(count === 1 ? '{0} ingreso' : '{0} ingresos', count)}</span>
        {/* El calendario nativo: tocar la fecha abre el selector. */}
        <input type="date" className="checkin-log-picker" value={date} max={today} aria-label={t('Elegir día')}
          onChange={e => e.target.value && e.target.value <= today && onDate(e.target.value)} />
      </label>
      <button className="iconbtn" onClick={() => onDate(shiftDay(date, 1))} disabled={isToday} aria-label={t('Día siguiente')}><Icon name="chevronRight" /></button>
    </div>
    {count ? <ol className="checkin-log-list">
      {checkins.map(c => <li key={c.userId + c.at}><button type="button" className="checkin-log-row" title={checkinName(c)} onClick={() => onOpen(c.userId)}>
        <span className="checkin-log-avatar" aria-hidden="true">{initials(c)}</span>
        <span className="checkin-log-main">
          <span className="checkin-log-name">
            {c.fullName || c.nick}
            {c.fullName && c.nick && c.nick.trim().toLowerCase() !== c.fullName.trim().toLowerCase() && <span className="checkin-log-nick"> [{c.nick}]</span>}
          </span>
          {c.billing && feeShort(c.billing) && <span className={'checkin-log-fee st-' + c.billing.status} title={t('Cuota de hoy')}>{feeShort(c.billing)}</span>}
        </span>
        <time className="checkin-log-time" dateTime={new Date(c.at).toISOString()}>{hhmm(c.at)}</time>
      </button></li>)}
    </ol> : <div className="checkin-log-empty">
      <Icon name="calendar" />
      <div>{loading ? t('Cargando…') : isToday ? t('Todavía no hay ingresos hoy.') : t('No hubo ingresos este día.')}</div>
    </div>}
    {!isToday && <Button size="sm" variant="tinted" onClick={() => onDate(today)}>{t('Volver a hoy')}</Button>}
  </div>
}

export default function IngresoFisico() {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const { setCheckinEnabled, users, loadUsers, billingEnabled } = useAdmin()
  const openSheet = useUI(s => s.openSheet)
  const owner = !!user?.owner
  const [data, setData] = useState(null)
  const [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [date, setDate] = useState(null)            // null = hoy (lo decide el servidor, en gym_tz)
  const [loadingDay, setLoadingDay] = useState(false)
  const dateRef = useRef(date)
  dateRef.current = date
  const load = (day = dateRef.current) => api('/api/admin/checkin' + (day ? '?date=' + day : ''))
    .then(d => { if (day === dateRef.current) setData(d); setCheckinEnabled?.(d.settings.enabled) })
    .catch(e => { if (e?.data?.error === 'feature_disabled') { setDenied(true); setCheckinEnabled?.(false) } else toast(errorText(e)) })
  const pickDay = day => { const next = day === data?.today ? null : day; setDate(next); dateRef.current = next; setLoadingDay(true); load(next).finally(() => setLoadingDay(false)) }
  // Polling liviano mientras se mira el día de hoy (un día anterior no cambia).
  useEffect(() => { load(); const iv = setInterval(() => { if (!dateRef.current) load() }, POLL_MS); return () => clearInterval(iv) }, [])

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

  // El mismo detalle que en Usuarios, como panel sobre la vista (bottom sheet en el celular).
  const openUser = id => openSheet(close => <UserDetail id={id} billingEnabled={billingEnabled !== false} users={users}
    openUser={other => { close(); openUser(other) }} onChanged={() => { loadUsers?.(); load() }} close={close} />, { kind: 'panel' })

  const { settings } = data
  return <div className="admin-cards">
    <EnableCard settings={settings} owner={owner} onSave={save} busy={busy} />
    {settings.enabled && <>
      <IdentifyCard settings={settings} billingEnabled={data.billingEnabled} owner={owner} onSave={save} busy={busy} />
      <DevicesCard devices={data.devices} onRevoke={revoke} />
      <CheckinLogCard date={data.date || data.today} today={data.today} checkins={data.checkins} loading={loadingDay}
        onDate={pickDay} onRefresh={() => load()} onOpen={openUser} />
    </>}
  </div>
}
