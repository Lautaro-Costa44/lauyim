import { useEffect, useRef, useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { api } from '../../../lib/api.js'
import { addDaysISO, fmtDateDMY, fmtPesos, isoOf, todayISO } from '../../../lib/format.js'
import { t } from '../../../lib/i18n.js'
import { confirmSheet } from '../../../sheets.jsx'
import Icon from '../../../components/Icon.jsx'
import { Button, NumberField, Row, SearchField, Section, Segmented, SelectRow, TextField, usePickerStep } from '../../../components/ui.jsx'
import { StatusBadge, methodLabel, paidAtFor, statusLabel } from './common.jsx'

// Ficha de cuota de un socio: estado, plan, historial y las acciones que lo cambian (registrar
// pago, asignar plan, anular el último pago). UN solo sheet real con pasos internos, como el
// wizard de sugerencias de AdminManageSheet: pagar o asignar no apilan sheets, y el gesto de
// atrás retrocede un paso (setOnBack) en vez de cerrar.
//
// startWith: 'detail' (default) o 'pick' (acción global "Registrar pago": primero se elige
// el socio, con `members` del tablero, y después se pasa directo al formulario de pago).

const billingUrl = userId => '/api/admin/users/' + encodeURIComponent(userId) + '/billing'
const paymentsUrl = userId => '/api/admin/users/' + encodeURIComponent(userId) + '/payments'
const userUrl = (userId, rest) => '/api/admin/users/' + encodeURIComponent(userId) + rest


function Header({ title, subtitle, onClose, badge }) {
  return <div className="row between compound-builder-header">
    <div style={{ minWidth: 0 }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      {subtitle && <div className="t-sub" style={{ color: 'var(--label-2)', marginTop: 2 }}>{subtitle}</div>}
    </div>
    <div className="row" style={{ gap: 8 }}>
      {badge}
      <button type="button" className="iconbtn" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
    </div>
  </div>
}

// Motivo opcional al anular: un confirm con un campo de texto (confirmSheet no lo tiene).
function VoidDialog({ payment, close, onConfirm }) {
  const [reason, setReason] = useState('')
  return <div className="confirm-dialog">
    <h3>{t('¿Anular este pago?')}</h3>
    <div className="muted confirm-dialog-message">
      {t('{0} del {1}. El socio vuelve al vencimiento que tenía antes del pago. El pago queda en el historial, anulado.', fmtPesos(payment.amount), fmtDateDMY(isoOf(new Date(payment.paidAt))))}
    </div>
    <div style={{ margin: '12px 0' }}>
      <TextField type="text" inputMode="text" value={reason} onChange={e => setReason(e.target.value)} maxLength={200} placeholder={t('Motivo (opcional)')} />
    </div>
    <div className="confirm-dialog-actions">
      <button className="btn danger" onClick={() => { close(); onConfirm(reason.trim()) }}>{t('Anular pago')}</button>
      <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
    </div>
  </div>
}

function MemberPicker({ members, onPick }) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLocaleLowerCase()
  const list = (members || []).filter(m => !needle || m.name.toLocaleLowerCase().includes(needle))
  return <>
    <SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder={t('Buscar socio por nombre')} aria-label={t('Buscar socio por nombre')} />
    <div className="sect-b" style={{ marginTop: 10 }}>
      {list.map(m => <Row key={m.id} title={m.name} subtitle={m.planName || t('Sin plan')} onClick={() => onPick(m)} accessory="chevron">
        <StatusBadge status={m.status} />
      </Row>)}
    </div>
    {!list.length && <div className="empty">{t('Ningún socio coincide con esa búsqueda.')}</div>}
  </>
}

function PaymentForm({ member, billing, plans, methods, today, picker, onDone }) {
  const toast = useUI(s => s.toast)
  // Solo planes activos, más el que ya tiene asignado aunque esté inactivo: el servidor le deja
  // seguir pagándolo y es el default.
  const options = plans.filter(p => p.active || p.id === billing.planId)
  const [planId, setPlanId] = useState(() => options.some(p => p.id === billing.planId) ? billing.planId : options[0]?.id ?? null)
  const plan = options.find(p => p.id === planId) || null
  const [amount, setAmount] = useState(plan ? plan.price : null)
  const [method, setMethod] = useState(methods[0])
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState(null)       // { dueDate } | { error }
  const [saving, setSaving] = useState(false)
  const amountOk = Number.isInteger(amount) && amount > 0

  const body = dryRun => ({
    planId, method, note: note.trim() || undefined, paidAt: paidAtFor(date, today),
    ...(amountOk ? { amount } : {}), ...(dryRun ? { dry_run: true } : {})
  })

  // Vista previa del vencimiento con la misma regla del servidor (dry_run): nada de recalcular
  // nextDueDate acá. Se pide al cambiar plan, fecha o método.
  useEffect(() => {
    if (!planId || !date) { setPreview(null); return }
    let alive = true
    const timer = setTimeout(() => {
      api(paymentsUrl(member.id), { method: 'POST', body: JSON.stringify(body(true)) })
        .then(r => { if (alive) setPreview({ dueDate: r.billing.dueDate }) })
        .catch(e => { if (alive) setPreview({ error: e.message }) })
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [planId, date, method])

  const changePlan = id => {
    setPlanId(id)
    const next = options.find(p => p.id === id)
    if (next) setAmount(next.price)
  }
  const save = () => {
    setSaving(true)
    api(paymentsUrl(member.id), { method: 'POST', body: JSON.stringify(body(false)) })
      .then(r => { toast(t('Pago registrado · vence el {0}', fmtDateDMY(r.billing.dueDate))); onDone() })
      .catch(e => { setSaving(false); setPreview({ error: e.message }) })
  }

  if (!options.length) return <div className="empty">{t('No hay planes activos. Creá uno desde Planes.')}</div>
  return <>
    <Section title={t('Pago')}>
      <SelectRow title={t('Plan')} value={planId} onChange={changePlan} sheetTitle={t('Plan')} picker={picker}
        options={options.map(p => ({ value: p.id, label: p.name + (p.active ? '' : ' · ' + t('inactivo')), subtitle: `${fmtPesos(p.price)} · ${t('{0} días', p.durationDays)}` }))} />
      <Row title={t('Monto ($)')}>
        <NumberField className="row-num wide" value={amount} onChange={setAmount} decimal={false} nullable />
      </Row>
      <Row title={t('Fecha')}>
        <input name="app-billing-paid-date" type="date" className="timef" value={date} max={today} onChange={e => setDate(e.target.value)} />
      </Row>
    </Section>
    {/* Como Section pero sin la caja: el segmented ya trae su propio fondo. */}
    <section className="sect">
      <h2 className="sect-t">{t('Método')}</h2>
      <Segmented options={methods.map(m => ({ value: m, label: methodLabel(m) }))} value={method} onChange={setMethod} />
    </section>
    <Section title={t('Nota')}>
      <TextField type="text" inputMode="text" value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder={t('Opcional')} />
    </Section>
    <div className="nutri-live row between" aria-live="polite">
      <span>{t('Nuevo vencimiento')}</span>
      <span>{preview?.dueDate ? fmtDateDMY(preview.dueDate) : preview?.error ? '—' : t('Calculando…')}</span>
    </div>
    {preview?.error && <div className="form-error" role="alert">{preview.error}</div>}
    {!amountOk && <div className="form-error" role="alert">{t('Ingresá un monto entero mayor que 0')}</div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={saving || !amountOk || !planId || !date} onClick={save}>
      {saving ? t('Guardando…') : t('Confirmar pago')}
    </Button>
  </>
}

function AssignForm({ member, billing, plans, today, picker, onDone }) {
  const toast = useUI(s => s.toast)
  const active = plans.filter(p => p.active)
  const initialPlan = active.find(p => p.id === billing.planId) || active[0] || null
  const [planId, setPlanId] = useState(initialPlan?.id ?? null)
  const [dueDate, setDueDate] = useState(initialPlan ? addDaysISO(today, initialPlan.durationDays) : today)
  const [dateTouched, setDateTouched] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const changePlan = id => {
    setPlanId(id)
    const next = active.find(p => p.id === id)
    // El vencimiento propuesto sigue al plan mientras el admin no lo haya tocado.
    if (next && !dateTouched) setDueDate(addDaysISO(today, next.durationDays))
  }
  const put = (payload, done) => {
    setSaving(true); setError(null)
    api(billingUrl(member.id), { method: 'PUT', body: JSON.stringify(payload) })
      .then(() => { toast(done); onDone() })
      .catch(e => { setSaving(false); setError(e.message) })
  }
  const removePlan = () => confirmSheet({
    title: t('¿Quitar el plan?'),
    message: t('{0} queda sin plan ni vencimiento. El historial de pagos no cambia.', member.name),
    confirmText: t('Quitar plan'), danger: true,
    onConfirm: () => put({ planId: null }, t('Plan quitado'))
  })

  return <>
    {active.length ? <Section title={t('Plan y vencimiento')} footer={t('El vencimiento es el día en que el socio vuelve a deber. Se propone hoy + la duración del plan.')}>
      <SelectRow title={t('Plan')} value={planId} onChange={changePlan} sheetTitle={t('Plan')} picker={picker}
        options={active.map(p => ({ value: p.id, label: p.name, subtitle: `${fmtPesos(p.price)} · ${t('{0} días', p.durationDays)}` }))} />
      <Row title={t('Vence')}>
        <input name="app-billing-due-date" type="date" className="timef" value={dueDate} onChange={e => { setDateTouched(true); setDueDate(e.target.value) }} />
      </Row>
    </Section> : <div className="empty">{t('No hay planes activos. Creá uno desde Planes.')}</div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <div style={{ height: 12 }} />
    {!!active.length && <Button variant="primary" disabled={saving || !planId || !dueDate}
      onClick={() => put({ planId, dueDate }, t('Plan asignado · vence el {0}', fmtDateDMY(dueDate)))}>{t('Guardar plan')}</Button>}
    {billing.planId != null && <>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="danger-text" style={{ color: 'var(--danger)' }} disabled={saving} onClick={removePlan}>{t('Quitar plan')}</Button>
    </>}
  </>
}

// Prueba gratis en el historial: no es un pago (monto 0, no se anula, no suma a nada).
const dayMonth = iso => fmtDateDMY(iso).slice(0, 5)
export function TrialRow({ trial }) {
  const parts = [t('Prueba gratis')]
  if (trial.days) parts.push(t(trial.days === 1 ? '1 día' : '{0} días', trial.days), `${dayMonth(trial.startDate)}–${dayMonth(trial.trialUntil)}`)
  else parts.push(t('desde el {0}', dayMonth(trial.startDate)))
  if (trial.createdByName) parts.push(trial.createdByName)
  return <Row className="pay-row trial" title={parts.join(' · ')} value={fmtPesos(0)} />
}

function PaymentRow({ payment, voidable, onVoid }) {
  const paid = fmtDateDMY(isoOf(new Date(payment.paidAt)))
  const period = payment.periodStart && payment.periodEnd ? t('Período {0} – {1}', fmtDateDMY(payment.periodStart), fmtDateDMY(payment.periodEnd)) : null
  const by = payment.createdByName ? t('Cargó {0}', payment.createdByName) : null
  const voided = payment.voidedAt
    ? t('Anulado') + (payment.voidedByName ? ' · ' + payment.voidedByName : '') + (payment.voidReason ? ': ' + payment.voidReason : '')
    : null
  return <Row className={'pay-row' + (payment.voidedAt ? ' voided' : '')}
    title={`${fmtPesos(payment.amount)} · ${methodLabel(payment.method)} · ${paid}`}
    subtitle={[payment.planName, period, by, payment.note, voided].filter(Boolean).join(' · ')}>
    {voidable && <Button size="sm" variant="ghost" style={{ color: 'var(--danger)' }} onClick={() => onVoid(payment)}>{t('Anular')}</Button>}
  </Row>
}

export function MemberBillingSheet({ userId, userName, members, startWith = 'detail', today: todayProp, close, setOnBack, onChanged }) {
  const openSheet = useUI(s => s.openSheet)
  const toast = useUI(s => s.toast)
  const today = todayProp || todayISO()
  const [member, setMember] = useState(userId ? { id: userId, name: userName } : null)
  const [step, setStep] = useState(startWith === 'pick' && !userId ? 'pick' : 'detail')
  const [data, setData] = useState(null)             // { billing, payments }
  const [plans, setPlans] = useState(null)
  const [methods, setMethods] = useState(null)
  const [error, setError] = useState(null)
  // Elegir plan es un paso más de este sheet, no otro sheet encima.
  const picker = usePickerStep()

  // Pago elegido desde "Registrar pago" global: atrás vuelve a la lista de socios, no a la ficha.
  const fromPick = useRef(false)
  const stepRef = useRef(step)
  stepRef.current = step
  // Atrás (gesto o botón "Volver"): un paso hacia atrás; desde la ficha o la lista, cierra.
  const goBack = () => {
    if (picker.isOpen) return picker.close()
    const cur = stepRef.current
    if (cur === 'pay' && fromPick.current) return setStep('pick')
    if (cur === 'pay' || cur === 'assign') return setStep('detail')
    close()
  }
  const goBackRef = useRef(goBack)
  goBackRef.current = goBack
  // Un solo registro de back para el sheet; lo variable se lee por ref (ver AdminManageSheet).
  useEffect(() => {
    if (!setOnBack) return
    setOnBack(() => goBackRef.current())
    return () => setOnBack(null)
  }, [setOnBack])

  const load = id => api(billingUrl(id)).then(d => { setData(d); setError(null) }).catch(e => setError(e.message))
  useEffect(() => { if (member) load(member.id) }, [member?.id])
  useEffect(() => {
    api('/api/admin/billing/plans').then(d => setPlans(d.plans)).catch(e => setError(e.message))
    api('/api/admin/billing/settings').then(d => setMethods(d.settings.payment_methods)).catch(e => setError(e.message))
  }, [])

  const changed = () => { if (member) load(member.id); onChanged?.() }
  const afterAction = () => { changed(); fromPick.current = false; setStep('detail') }

  const startTrial = () => confirmSheet({
    title: t('¿Iniciar prueba?'),
    message: t(data.trial.days === 1 ? 'Prueba de 1 día: puede usar la app solo hoy. Es una sola por persona.' : 'Prueba de {0} días, vence el {1}. Es una sola por persona.', data.trial.days, fmtDateDMY(data.trial.until)),
    confirmText: t('Iniciar prueba'),
    onConfirm: () => api(userUrl(member.id, '/trial'), { method: 'POST', body: '{}' })
      .then(() => { toast(t('Prueba iniciada')); changed() })
      .catch(e => setError(e.data?.message || e.message))
  })

  const voidPayment = payment => openSheet(c => <VoidDialog payment={payment} close={c} onConfirm={reason =>
    api(paymentsUrl(member.id) + '/' + payment.id + '/void', { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) })
      .then(() => { toast(t('Pago anulado')); changed() })
      .catch(e => setError(e.message))
  } />, { kind: 'center' })

  if (step === 'pick') return <div className="compound-builder"><div className="compound-builder-content">
    <Header title={t('Registrar pago')} subtitle={t('Elegí el socio')} onClose={close} />
    <MemberPicker members={members} onPick={m => { setData(null); setMember({ id: m.id, name: m.name }); fromPick.current = true; setStep('pay') }} />
  </div></div>

  const ready = data && plans && methods
  const billing = data?.billing
  // El último pago vigente es el último registrado (id más alto), igual que en el servidor. Uno
  // importado no se anula (y tapa a los anteriores: solo se deshacen en orden).
  const voidableId = (data?.payments || []).filter(p => !p.voidedAt).reduce((max, p) => Math.max(max, p.id), 0)
  const isVoidable = p => p.id === voidableId && p.source !== 'import'
  // Pagos y pruebas por fecha (history); un servidor viejo solo manda payments.
  const history = data?.history || (data?.payments || []).map(p => ({ type: 'payment', ...p }))
  const back = step !== 'detail' && <Button size="sm" icon="chevronLeft" onClick={goBack}>{t('Volver')}</Button>

  const trial = data?.trial
  return <div className="compound-builder">
    <div className="compound-builder-content">
      {picker.view}
      <div hidden={picker.isOpen}>
      <Header title={step === 'pay' ? t('Registrar pago') : step === 'assign' ? t('Asignar plan') : t('Cuota')}
        subtitle={member?.name} onClose={close} badge={billing && step === 'detail' ? <StatusBadge status={billing.status} /> : null} />
      {error && <div className="form-error" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
      {!ready ? <div className="dim small">{t('Loading…')}</div>
        : step === 'pay' ? <>{back}<div style={{ height: 10 }} />
          <PaymentForm member={member} billing={billing} plans={plans} methods={methods} today={today} picker={picker.open} onDone={afterAction} /></>
        : step === 'assign' ? <>{back}<div style={{ height: 10 }} />
          <AssignForm member={member} billing={billing} plans={plans} today={today} picker={picker.open} onDone={afterAction} /></>
        : <>
          <Section>
            <Row title={t('Estado')} value={statusLabel(billing.status)} />
            <Row title={t('Plan')} value={billing.planName || t('Sin plan')} />
            {billing.trialUntil ? <Row title={t('Prueba hasta')} value={fmtDateDMY(billing.trialUntil)} />
              : <Row title={t('Vence')} value={billing.dueDate ? fmtDateDMY(billing.dueDate) : '—'} />}
            <Row title={t('Deuda')} value={fmtPesos(billing.debt)} />
          </Section>
          <div className="billing-actions">
            <Button variant="primary" size="sm" icon="plus" onClick={() => { setError(null); setStep('pay') }}>{t('Registrar pago')}</Button>
            <Button variant="tinted" size="sm" onClick={() => { setError(null); setStep('assign') }}>{billing.planId == null ? t('Asignar plan') : t('Cambiar plan')}</Button>
            {trial?.available && <Button variant="tinted" size="sm" onClick={startTrial}>{t('Iniciar prueba')}</Button>}
          </div>
          {/* Prueba: una por persona (DNI); con plan vigente o prueba en curso no se ofrece. */}
          {trial?.blocker === 'trial_used' && <div className="dim small billing-trial-note">{t('Ya usó su prueba')}</div>}
          {trial?.blocker === 'trial_requires_dni' && <div className="dim small billing-trial-note">{t('Para darle una prueba, cargá su DNI en la ficha.')}</div>}
          <Section title={t('Historial de pagos')}>
            {history.length ? history.map(h => h.type === 'trial' ? <TrialRow key={'t' + h.id} trial={h} />
              : <PaymentRow key={h.id} payment={h} voidable={isVoidable(h)} onVoid={voidPayment} />)
              : <div className="empty" style={{ padding: '20px' }}>{t('Todavía no hay pagos registrados.')}</div>}
          </Section>
        </>}
      </div>
    </div>
  </div>
}
