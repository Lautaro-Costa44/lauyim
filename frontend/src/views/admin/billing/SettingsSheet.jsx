import { useEffect, useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { api } from '../../../lib/api.js'
import { t } from '../../../lib/i18n.js'
import { Button, NumberField, Row, Section, SelectRow, Switch } from '../../../components/ui.jsx'
import { METHOD_LABELS, methodLabel } from './common.jsx'

// Configuración global de cuotas (admin_settings). El servidor valida lo mismo; acá se evita
// mandar algo que sabemos que va a rechazar.

const AR_TIMEZONES = [
  'America/Argentina/Buenos_Aires', 'America/Argentina/Cordoba', 'America/Argentina/Salta',
  'America/Argentina/Jujuy', 'America/Argentina/Tucuman', 'America/Argentina/Catamarca',
  'America/Argentina/La_Rioja', 'America/Argentina/San_Juan', 'America/Argentina/Mendoza',
  'America/Argentina/San_Luis', 'America/Argentina/Rio_Gallegos', 'America/Argentina/Ushuaia'
]
const tzLabel = tz => tz.split('/').pop().replace(/_/g, ' ')
const DAY_FIELDS = [
  ['due_soon_days', 'Días "por vencer"', 'Cuántos días antes del vencimiento se marca como por vencer.'],
  ['push_days_before', 'Días de aviso push', 'Cuántos días antes del vencimiento sale el aviso al socio.'],
  ['grace_days', 'Días de tolerancia', 'Días después del vencimiento antes de bloquear la app.']
]
const inRange = n => Number.isInteger(n) && n >= 0 && n <= 30

export function SettingsSheet({ close, onChanged }) {
  const toast = useUI(s => s.toast)
  const [form, setForm] = useState(null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { api('/api/admin/billing/settings').then(d => setForm(d.settings)).catch(e => setError(e.message)) }, [])

  if (!form) return <>
    <h3>{t('Configuración de cuotas')}</h3>
    {error ? <div className="form-error" role="alert">{error}</div> : <div className="dim small">{t('Loading…')}</div>}
  </>

  const set = patch => { setError(null); setForm(f => ({ ...f, ...patch })) }
  const toggleMethod = (method, on) => set({ payment_methods: Object.keys(METHOD_LABELS).filter(m => m === method ? on : form.payment_methods.includes(m)) })
  // Zonas de Argentina, más la guardada y la del navegador si no están en la lista.
  const browserTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return null } })()
  const zones = [...new Set([...AR_TIMEZONES, form.gym_tz, browserTz].filter(Boolean))]
  const valid = DAY_FIELDS.every(([key]) => inRange(form[key])) && form.payment_methods.length > 0

  const save = () => {
    setSaving(true)
    const { due_soon_days, push_days_before, grace_days, payment_methods, gym_tz } = form
    api('/api/admin/billing/settings', { method: 'PUT', body: JSON.stringify({ due_soon_days, push_days_before, grace_days, payment_methods, gym_tz }) })
      .then(() => { toast(t('Configuración guardada')); onChanged?.(); close() })
      .catch(e => { setSaving(false); setError(e.message) })
  }

  return <>
    <h3>{t('Configuración de cuotas')}</h3>
    <Section title={t('Plazos (0 a 30 días)')}>
      {DAY_FIELDS.map(([key, title, subtitle]) => <Row key={key} title={t(title)} subtitle={t(subtitle)}>
        <NumberField className="row-num" value={form[key]} onChange={v => set({ [key]: v })} decimal={false} nullable />
      </Row>)}
    </Section>
    <Section title={t('Métodos de pago')} footer={t('Al menos uno tiene que quedar habilitado.')}>
      {Object.keys(METHOD_LABELS).map(m => <Row key={m} title={methodLabel(m)}>
        {/* El último método habilitado no se puede apagar. */}
        <Switch checked={form.payment_methods.includes(m)} onChange={on => toggleMethod(m, on)}
          disabled={form.payment_methods.length === 1 && form.payment_methods.includes(m)} />
      </Row>)}
    </Section>
    <Section title={t('Zona horaria del gym')} footer={t('Define qué día es "hoy" para los vencimientos y a qué hora sale el aviso.')}>
      <SelectRow title={t('Zona horaria')} value={form.gym_tz} onChange={v => set({ gym_tz: v })} sheetTitle={t('Zona horaria del gym')}
        options={zones.map(z => ({ value: z, label: tzLabel(z), subtitle: z }))} />
    </Section>
    {!valid && <div className="form-error" role="alert">{t('Revisá los plazos (enteros de 0 a 30) y dejá al menos un método de pago.')}</div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={saving || !valid} onClick={save}>{saving ? t('Guardando…') : t('Save')}</Button>
    <div style={{ height: 8 }} />
  </>
}
