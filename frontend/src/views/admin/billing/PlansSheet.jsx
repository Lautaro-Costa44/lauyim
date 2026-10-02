import { useEffect, useRef, useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { api } from '../../../lib/api.js'
import { fmtPesos } from '../../../lib/format.js'
import { t } from '../../../lib/i18n.js'
import { Button, NumberField, Row, Section, Segmented, Switch, TextField } from '../../../components/ui.jsx'
import { errorText } from '../../../lib/errors.js'
import { planLimitLabel } from '../../../lib/classes.js'

// Planes de cuota: lista, alta y edición en el mismo sheet (paso interno 'edit'). Los planes
// no se borran; se desactivan (un plan inactivo no se asigna, quien ya lo tiene lo conserva).

function PlanEditor({ plan, onSaved, onCancel }) {
  const toast = useUI(s => s.toast)
  const [name, setName] = useState(plan?.name || '')
  const [price, setPrice] = useState(plan ? plan.price : null)
  const [durationDays, setDurationDays] = useState(plan ? plan.durationDays : 30)
  const [active, setActive] = useState(plan ? plan.active : true)
  // Clases incluidas: 'free' (libre) o cuántas por semana o por mes.
  const [classPeriod, setClassPeriod] = useState(plan?.classLimit ? plan.classPeriod : 'free')
  const [classLimit, setClassLimit] = useState(plan?.classLimit || 2)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const limitOk = classPeriod === 'free' || (Number.isInteger(classLimit) && classLimit >= 1 && classLimit <= 31)
  const valid = name.trim() && Number.isInteger(price) && price >= 0 && Number.isInteger(durationDays) && durationDays >= 1 && durationDays <= 3660 && limitOk

  const save = () => {
    setSaving(true); setError(null)
    const body = { name: name.trim(), price, durationDays, ...(classPeriod === 'free' ? { classLimit: null } : { classLimit, classPeriod }), ...(plan ? { active } : {}) }
    api(plan ? '/api/admin/billing/plans/' + plan.id : '/api/admin/billing/plans', { method: plan ? 'PUT' : 'POST', body: JSON.stringify(body) })
      .then(() => { toast(plan ? t('Plan actualizado') : t('Plan creado')); onSaved() })
      .catch(e => { setSaving(false); setError(errorText(e)) })
  }

  return <>
    <h3>{plan ? t('Editar plan') : t('Nuevo plan')}</h3>
    <Section title={t('Nombre')}>
      <TextField type="text" inputMode="text" value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder={t('Ej.: Mensual')} />
    </Section>
    <Section footer={t('Precio en pesos, sin centavos. La duración define cuánto extiende cada pago el vencimiento.')}>
      <Row title={t('Precio ($)')}><NumberField className="row-num wide" value={price} onChange={setPrice} decimal={false} nullable /></Row>
      <Row title={t('Duración (días)')}><NumberField className="row-num" value={durationDays} onChange={setDurationDays} decimal={false} nullable /></Row>
      {plan && <Row title={t('Activo')} subtitle={active ? t('Se puede asignar') : t('No se asigna a nuevos socios')}>
        <Switch checked={active} onChange={setActive} />
      </Row>}
    </Section>
    <Section title={t('Clases incluidas')} footer={classPeriod === 'free'
      ? t('Pase libre: se anota a todas las clases que quiera.')
      : t('Al llegar al límite no puede reservar más esa semana (de lunes a domingo) o ese mes. Cancelar a tiempo le devuelve la clase. Recepción puede anotarlo igual.')}>
      <div className="lrow" style={{ paddingTop: 10, paddingBottom: 10 }}>
        <Segmented options={[{ value: 'free', label: t('Libre') }, { value: 'week', label: t('Por semana') }, { value: 'month', label: t('Por mes') }]} value={classPeriod} onChange={setClassPeriod} />
      </div>
      {classPeriod !== 'free' && <Row title={classPeriod === 'week' ? t('Clases por semana') : t('Clases por mes')}>
        <NumberField className="row-num" value={classLimit} onChange={setClassLimit} decimal={false} nullable />
      </Row>}
    </Section>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={saving || !valid} onClick={save}>{saving ? t('Guardando…') : t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={onCancel}>{t('Cancel')}</Button>
  </>
}

export function PlansSheet({ close, setOnBack, onChanged }) {
  const [plans, setPlans] = useState(null)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)      // null | 'new' | plan
  const editingRef = useRef(editing)
  editingRef.current = editing
  const load = () => api('/api/admin/billing/plans').then(d => setPlans(d.plans)).catch(e => setError(errorText(e)))
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!setOnBack) return
    setOnBack(() => editingRef.current ? setEditing(null) : close())
    return () => setOnBack(null)
  }, [close, setOnBack])

  if (editing) return <PlanEditor plan={editing === 'new' ? null : editing}
    onSaved={() => { setEditing(null); load(); onChanged?.() }} onCancel={() => setEditing(null)} />
  return <>
    <div className="row between" style={{ marginBottom: 8 }}>
      <h3 style={{ margin: 0 }}>{t('Planes')}</h3>
      <Button variant="primary" size="sm" icon="plus" onClick={() => setEditing('new')}>{t('Nuevo plan')}</Button>
    </div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {!plans ? <div className="dim small">{t('Loading…')}</div>
      : plans.length ? <div className="sect-b">
        {plans.map(p => <Row key={p.id} title={p.name} subtitle={[fmtPesos(p.price), t('{0} días', p.durationDays), p.classLimit && planLimitLabel({ limit: p.classLimit, period: p.classPeriod })].filter(Boolean).join(' · ')}
          onClick={() => setEditing(p)} accessory="chevron">
          {!p.active && <span className="tag nocap">{t('Inactivo')}</span>}
        </Row>)}
      </div>
      : <div className="empty">{t('Todavía no hay planes. Creá el primero para poder asignarlo a los socios.')}</div>}
    <div style={{ height: 8 }} />
  </>
}
