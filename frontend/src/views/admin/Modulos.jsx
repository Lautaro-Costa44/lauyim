import { useEffect, useState } from 'react'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { classesApi } from '../../lib/classes.js'
import { confirmSheet } from '../../sheets.jsx'
import { Switch } from '../../components/ui.jsx'
import { useAdmin } from './context.js'

// Personalización → Módulos (solo el owner): prender y apagar cuotas, clases, ingreso físico y
// suplementos en un solo lugar. Apagar un módulo no borra datos y oculta su sección del panel; cada
// sección conserva sus propios ajustes. "Volver a lauyim" no toca los módulos.
function ModuleRow({ label, help, checked, disabled, onChange }) {
  return <div className="branding-lock">
    <div><div>{label}</div><div className="small dim">{help}</div></div>
    <Switch checked={!!checked} disabled={disabled || checked == null} onChange={onChange} label={label} />
  </div>
}

export default function ModulesCard() {
  const toast = useUI(s => s.toast)
  const { billingEnabled, setBillingEnabled, loadUsers, checkinEnabled, setCheckinEnabled, classesEnabled, setClassesEnabled } = useAdmin() || {}
  const [supps, setSupps] = useState(null)
  const [busy, setBusy] = useState(null)   // el módulo que se está guardando
  useEffect(() => { api('/api/owner/supplements').then(d => setSupps(typeof d?.enabled === 'boolean' ? d.enabled : null)).catch(() => setSupps(null)) }, [])

  const run = (key, request, apply, msgs) => {
    setBusy(key)
    return request()
      .then(v => { apply(v); toast(v ? t(msgs[0]) : t(msgs[1])) })
      .catch(e => toast(errorText(e, t('Failed to save setting'))))
      .finally(() => setBusy(null))
  }
  const off = (title, message, onConfirm) => confirmSheet({ title, message, confirmText: t('Desactivar'), danger: true, onConfirm })

  // Cuotas: al encender, primero se muestra a cuántos socios afecta hoy.
  const putBilling = value => run('billing', () => api('/api/owner/billing/enabled', { method: 'PUT', body: JSON.stringify({ enabled: value }) }).then(d => d.enabled),
    v => { setBillingEnabled?.(v); loadUsers?.() }, ['Cobro de cuotas activado', 'Cobro de cuotas desactivado'])
  const billing = v => v ? (setBusy('billing'), api('/api/owner/billing/enable-preview')
    .then(p => {
      const blocked = Number(p.bloqueado) || 0, late = Number(p.vencido) || 0
      confirmSheet({
        title: t('¿Activar el cobro de cuotas?'),
        message: blocked
          ? t(blocked === 1 ? 'Al activar, {0} socio queda bloqueado' : 'Al activar, {0} socios quedan bloqueados', blocked) + ' ' + t(late === 1 ? 'y {0} vencido.' : 'y {0} vencidos.', late)
          : t('Vuelven la sección Cuotas y los avisos de vencimiento. El bloqueo por cuota vencida vuelve solo si está prendido en los ajustes de Cuotas.'),
        confirmText: t('Activar'),
        onConfirm: () => putBilling(true)
      })
    })
    .catch(e => toast(errorText(e, t('Failed to load'))))
    .finally(() => setBusy(null)))
    : off(t('¿Desactivar el cobro de cuotas?'), t('Se ocultan la sección Cuotas y los avisos de vencimiento, y nadie queda bloqueado por cuota. No se borra ningún dato: al volver a activarlo, todo sigue como estaba. El recordatorio manual de cuota de cada socio vuelve a funcionar.'), () => putBilling(false))

  const putClasses = value => run('classes', () => classesApi.saveSettings({ enabled: value }).then(d => d.settings.enabled),
    v => setClassesEnabled?.(v), ['Clases activadas', 'Clases desactivadas'])
  const classes = v => v ? putClasses(true)
    : off(t('¿Desactivar las clases?'), t('Los socios dejan de ver la pestaña Clases y la tarjeta de Inicio, y se oculta la sección Clases. No se borra ningún dato: al volver a activarlas, todo sigue como estaba.'), () => putClasses(false))

  const putCheckin = value => run('checkin', () => api('/api/owner/checkin/settings', { method: 'PUT', body: JSON.stringify({ enabled: value }) }).then(() => value),
    v => setCheckinEnabled?.(v), ['Ingreso Físico activado', 'Ingreso Físico desactivado'])
  const checkin = v => v ? putCheckin(true)
    : off(t('¿Desactivar Ingreso Físico?'), t('Todos los dispositivos dejan de funcionar y quedan desactivados: para volver a usarlos, un admin tiene que activarlos de nuevo. Los ingresos registrados no se borran.'), () => putCheckin(false))

  const putSupps = value => run('supps', () => api('/api/owner/supplements', { method: 'PUT', body: JSON.stringify({ enabled: value }) }).then(d => d.enabled),
    setSupps, ['Suplementos activados', 'Suplementos desactivados'])
  const supplements = v => v ? putSupps(true)
    : off(t('¿Desactivar los suplementos?'), t('Los socios dejan de ver la guía, la tarjeta y los recordatorios de suplementos. No se borra ningún dato: al volver a activarlo, todo sigue como estaba.'), () => putSupps(false))

  return <div className="card modules-card">
    <h3 className="branding-h">{t('Módulos')}</h3>
    <div className="small dim">{t('Apagar un módulo no borra nada: se oculta su sección y, al prenderlo, todo sigue como estaba.')}</div>
    <ModuleRow label={t('Cobro de cuotas')} checked={billingEnabled == null ? null : billingEnabled !== false} disabled={busy === 'billing'} onChange={billing}
      help={t('Muestra la sección Cuotas y los avisos de vencimiento. El bloqueo por cuota vencida se configura aparte, en los ajustes de Cuotas.')} />
    <ModuleRow label={t('Clases')} checked={classesEnabled == null ? null : classesEnabled !== false} disabled={busy === 'classes'} onChange={classes}
      help={t('Clases con reservas, lista de espera y asistencia. Los socios ven la pestaña Clases y la tarjeta de Inicio.')} />
    <ModuleRow label={t('Ingreso Físico')} checked={checkinEnabled} disabled={busy === 'checkin'} onChange={checkin}
      help={t('Una tablet o notebook en la recepción donde el socio tipea su DNI y queda registrado que vino.')} />
    {supps !== null && <ModuleRow label={t('Suplementos')} checked={supps} disabled={busy === 'supps'} onChange={supplements}
      help={t('En Nutrición: una guía basada en evidencia y el registro de lo que toma cada socio. Lo ve cada socio y el staff con permiso de ver suplementos.')} />}
  </div>
}
