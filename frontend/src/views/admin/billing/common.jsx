import { useEffect, useState } from 'react'
import { api } from '../../../lib/api.js'
import { fmtDateDMY, fmtPesos } from '../../../lib/format.js'
import { t } from '../../../lib/i18n.js'
import { Button } from '../../../components/ui.jsx'

// Cuotas v1 (admin): piezas chicas que comparten el tablero de Cuotas, la ficha del socio y
// UserDetail. Las reglas (estado, vencimiento, deuda) viven en el backend (api/billing.js):
// acá solo se muestran.

export const STATUS_ORDER = ['al_dia', 'por_vencer', 'vencido', 'bloqueado', 'prueba', 'sin_plan']
export const STATUS_LABELS = {
  al_dia: 'Al día', por_vencer: 'Por vencer', vencido: 'Vencido', bloqueado: 'Bloqueado', prueba: 'En prueba', sin_plan: 'Sin plan'
}
export const METHOD_LABELS = { efectivo: 'Efectivo', transferencia: 'Transferencia', otro: 'Otro' }

export const statusLabel = status => t(STATUS_LABELS[status] || status)
export const methodLabel = method => t(METHOD_LABELS[method] || method || '—')

// Un pago cargado para hoy va sin paidAt (el servidor usa "ahora"); para otro día, el mediodía
// de Buenos Aires (15:00 UTC), que cae en esa misma fecha en cualquier tz de América.
export const paidAtFor = (date, today) => {
  if (!date || date === today) return undefined
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d, 15)
}

export function StatusBadge({ status }) {
  return <span className={'tag nocap st-' + status}>{statusLabel(status)}</span>
}

// Abre la ficha de cuota del socio. El módulo es grande (formularios, historial), así que se
// carga recién al abrirla: UserDetail está en el chunk que baja con todo el admin.
export function openMemberBilling(openSheet, props) {
  return import('./MemberBillingSheet.jsx').then(({ MemberBillingSheet }) => openSheet(
    (close, { setOnBack }) => <MemberBillingSheet {...props} close={close} setOnBack={setOnBack} />,
    { locked: true, fullScreen: true, backGesture: true }
  ))
}

// Card de cuota dentro de UserDetail: estado, plan, vencimiento y acceso a la ficha.
export function BillingSummaryCard({ userId, userName, openSheet, onChanged }) {
  const [billing, setBilling] = useState(null)
  const [error, setError] = useState(null)
  const load = () => api('/api/admin/users/' + encodeURIComponent(userId) + '/billing')
    .then(d => { setBilling(d.billing); setError(null) })
    .catch(e => setError(e.message))
  useEffect(() => { load() }, [userId])
  const open = () => openMemberBilling(openSheet, { userId, userName, onChanged: () => { load(); onChanged?.() } })
  return <div className="card billing-summary">
    <div className="row between">
      <h2 style={{ margin: 0 }}>{t('Cuota')}</h2>
      {billing && <StatusBadge status={billing.status} />}
    </div>
    {error ? <div className="form-error" role="alert">{error}</div>
      : !billing ? <div className="dim small" style={{ marginTop: 6 }}>{t('Loading…')}</div>
      : <div className="small muted" style={{ margin: '6px 0 10px' }}>
        {billing.planId == null ? t('Sin plan asignado')
          : [billing.planName, billing.dueDate && t('Vence el {0}', fmtDateDMY(billing.dueDate)), billing.debt > 0 && t('Debe {0}', fmtPesos(billing.debt))].filter(Boolean).join(' · ')}
      </div>}
    <Button variant="tinted" size="sm" onClick={open} disabled={!billing}>{t('Ver cuota')}</Button>
  </div>
}
