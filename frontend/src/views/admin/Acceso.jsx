import { useEffect, useState } from 'react'
import { useAdmin } from './context.js'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { confirmSheet } from '../../sheets.jsx'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button, Switch } from '../../components/ui.jsx'
import QrCanvas from '../../components/QrCanvas.jsx'

// Moved as-is from Usuarios: every admin can create and revoke invite codes.
function InvitesCard({ invites, reload }) {
  const toast = useUI(s => s.toast)
  const gen = () => api('/api/admin/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { navigator.clipboard?.writeText(invite.code).catch(() => {}); toast(t('Code {0} created & copied', invite.code)); reload() })
    .catch(e => toast(e.message))
  const revoke = code => api('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
    .then(() => { toast(t('Code revoked')); reload() }).catch(e => toast(e.message))
  const open = (invites || []).filter(i => !i.usedBy)
  const used = (invites || []).filter(i => i.usedBy)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Invite codes')}</h2>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">{t('Generate')}</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{open.length} {t('unused')} · {used.length} {t('redeemed')}</div>
    {open.map(i => <div key={i.code} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
      <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontWeight: 500, letterSpacing: '.06em' }}
        onClick={() => { navigator.clipboard?.writeText(i.code).catch(() => {}); toast(t('Copied {0}', i.code)) }}>{i.code}</span>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => revoke(i.code)} aria-label="revoke"><Icon name="trash" /></button>
    </div>)}
    {used.map(i => <div key={i.code} className="row between dim" style={{ padding: '7px 2px', fontSize: '.8rem' }}>
      <span style={{ fontFamily: 'monospace' }}>{i.code}</span><span>→ {i.usedByName || t('used')}</span>
    </div>)}
    {!open.length && !used.length && <div className="dim small">{t('No codes yet — generate one to invite someone.')}</div>}
  </div>
}

function QrAccessCard({ data, reload }) {
  const toast = useUI(s => s.toast)
  const config = useStore(s => s.config)
  const loadConfig = useStore(s => s.loadConfig)
  const [qrCanvas, setQrCanvas] = useState(null)
  useEffect(() => { loadConfig().catch(e => toast(e.message || t('Failed to load configuration'))) }, [loadConfig])
  const link = data?.token ? window.location.origin + '/?qr=' + encodeURIComponent(data.token) : ''
  const copy = () => link && navigator.clipboard?.writeText(link).then(() => toast(t('QR link copied'))).catch(() => toast(t('Could not copy the QR link')))
  const save = () => {
    if (!qrCanvas) return toast(t('Could not save the QR'))
    try {
      const name = String(config?.instance_name || 'lauyim').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '') || 'lauyim'
      const a = document.createElement('a')
      a.href = qrCanvas.toDataURL('image/png')
      a.download = `${name}-qr-acceso.png`
      a.click()
    } catch (e) {
      toast(e.message || t('Could not save the QR'))
    }
  }
  const regenerate = () => confirmSheet({
    title: t('Regenerate QR access?'),
    message: t('This immediately invalidates the QR currently printed or shared. A new QR link will be generated.'),
    confirmText: t('Regenerate'), danger: true,
    onConfirm: () => api('/api/owner/qr/regenerate', { method: 'POST', body: '{}' })
      .then(d => { reload(d); toast(t('QR access regenerated')) })
      .catch(e => toast(e.message || t('Failed to regenerate QR access')))
  })
  return <div className="card">
    <h2 style={{ margin: 0 }}>{t('QR access')}</h2>
    <div className="small muted" style={{ margin: '6px 0 12px' }}>{t('Anyone who opens this link can register without an invite code. The QR itself does not expire; regenerating it invalidates the previous one.')}</div>
    {data?.token ? <>
      <div className="row" style={{ alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <QrCanvas value={link} onCanvas={setQrCanvas} />
        <div className="grow" style={{ minWidth: 220 }}>
          <div className="small dim" style={{ marginBottom: 5 }}>{t('Current link')}</div>
          <div style={{ wordBreak: 'break-all', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: '.78rem', padding: 10, background: 'var(--surface-2)', borderRadius: 8 }}>{link}</div>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <Button size="sm" variant="primary" onClick={save}>{t('Save QR')}</Button>
            <Button size="sm" onClick={copy}>{t('Copy link')}</Button>
            <Button size="sm" variant="danger" onClick={regenerate}>{t('Regenerate')}</Button>
          </div>
        </div>
      </div>
    </> : <div className="dim small">{t('Loading…')}</div>}
  </div>
}

// Datos que se piden al dar de alta una ficha (config de api/members.js). Cada cambio se guarda
// en el acto; "Obligatorio" sin "Pedir" no existe (el servidor lo rechaza).
const MEMBER_FIELD_LABELS = [
  ['full_name', 'Nombre y apellido'],
  ['dni', 'DNI'],
  ['phone', 'Celular'],
  ['email', 'Mail'],
]

function MemberFieldsCard() {
  const toast = useUI(s => s.toast)
  const [fields, setFields] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    api('/api/admin/members/settings').then(d => setFields(d.fields)).catch(e => toast(e.message || t('Failed to load')))
  }, [])
  const save = patch => {
    setSaving(true)
    api('/api/admin/members/settings', { method: 'PUT', body: JSON.stringify({ fields: patch }) })
      .then(d => setFields(d.fields))
      .catch(e => toast(e.message || t('Failed to save setting')))
      .finally(() => setSaving(false))
  }
  return <div className="card">
    <h2 style={{ margin: 0 }}>{t('Datos del registro')}</h2>
    <div className="small muted" style={{ margin: '6px 0 4px' }}>{t('Qué datos se piden al registrar un socio. El nombre de usuario siempre se pide.')}</div>
    {fields ? MEMBER_FIELD_LABELS.map(([key, label]) => {
      const f = fields[key] || { enabled: false, required: false }
      return <div key={key} className="access-field">
        <div className="access-field-name">{t(label)}</div>
        <div className="access-field-switches">
          <span className="access-switch"><span className="small muted">{t('Pedir')}</span>
            <Switch label={t('Pedir {0}', t(label))} checked={f.enabled} disabled={saving}
              onChange={v => save({ [key]: v ? { enabled: true } : { enabled: false, required: false } })} /></span>
          <span className="access-switch"><span className="small muted">{t('Obligatorio')}</span>
            <Switch label={t('{0} obligatorio', t(label))} checked={f.required} disabled={saving || !f.enabled}
              onChange={v => save({ [key]: { required: v } })} /></span>
        </div>
        {key === 'dni' && !f.enabled && <div className="access-field-warn small" role="note">{t('Sin DNI no se pueden detectar socios duplicados')}</div>}
      </div>
    }) : <div className="dim small">{t('Loading…')}</div>}
  </div>
}

// Interruptor de cuotas (owner). Apagarlo no borra datos: el servidor deja de bloquear, de
// avisar vencimientos y de aceptar cambios de cuotas hasta que se vuelva a encender.
function BillingToggleCard({ enabled, onChanged }) {
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)
  const put = value => {
    setBusy(true)
    api('/api/owner/billing/enabled', { method: 'PUT', body: JSON.stringify({ enabled: value }) })
      .then(d => { onChanged(d.enabled); toast(d.enabled ? t('Cobro de cuotas activado') : t('Cobro de cuotas desactivado')) })
      .catch(e => toast(e.message || t('Failed to save setting')))
      .finally(() => setBusy(false))
  }
  const turnOff = () => confirmSheet({
    title: t('¿Desactivar el cobro de cuotas?'),
    message: t('Se ocultan la sección Cuotas y los avisos de vencimiento, y nadie queda bloqueado por cuota. No se borra ningún dato: al volver a activarlo, todo sigue como estaba. El recordatorio manual de cuota de cada socio vuelve a funcionar.'),
    confirmText: t('Desactivar'), danger: true,
    onConfirm: () => put(false)
  })
  // Al encender, primero se muestra a cuántos socios afecta hoy.
  const turnOn = () => {
    setBusy(true)
    api('/api/owner/billing/enable-preview')
      .then(p => {
        const blocked = Number(p.bloqueado) || 0, late = Number(p.vencido) || 0
        confirmSheet({
          title: t('¿Activar el cobro de cuotas?'),
          message: blocked
            ? t(blocked === 1 ? 'Al activar, {0} socio queda bloqueado' : 'Al activar, {0} socios quedan bloqueados', blocked) + ' ' + t(late === 1 ? 'y {0} vencido.' : 'y {0} vencidos.', late)
            : t('Vuelven la sección Cuotas, los avisos de vencimiento y el bloqueo por cuota vencida.'),
          confirmText: t('Activar'),
          onConfirm: () => put(true)
        })
      })
      .catch(e => toast(e.message || t('Failed to load')))
      .finally(() => setBusy(false))
  }
  return <div className="card">
    <h2 style={{ margin: 0 }}>{t('Cobro de cuotas')}</h2>
    <div className="row between" style={{ gap: 12, marginTop: 10 }}>
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{t('Bloquear el acceso por cuota vencida')}</div>
        <div className="small muted" style={{ marginTop: 2 }}>{t('Quien pasa la tolerancia sin pagar no puede entrenar ni sincronizar hasta que registres el pago.')}</div>
      </div>
      <Switch label={t('Bloquear el acceso por cuota vencida')} checked={enabled !== false} disabled={busy || enabled == null}
        onChange={v => v ? turnOn() : turnOff()} />
    </div>
  </div>
}

// Invitaciones para todos los admins; QR, datos del registro y cuotas solo para el owner.
export default function Acceso() {
  const user = useStore(s => s.user)
  const { invites, loadInvites, qrAccess, setQrAccess, billingEnabled, setBillingEnabled, loadUsers } = useAdmin()
  const invitesCard = <InvitesCard invites={invites} reload={loadInvites} />
  if (!user?.owner) return <div className="admin-single">{invitesCard}</div>
  return <div className="admin-access">
    {invitesCard}
    <QrAccessCard data={qrAccess} reload={setQrAccess} />
    <MemberFieldsCard />
    <BillingToggleCard enabled={billingEnabled} onChanged={v => { setBillingEnabled(v); loadUsers() }} />
  </div>
}
