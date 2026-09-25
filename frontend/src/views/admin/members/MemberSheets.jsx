import { useEffect, useRef, useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { api } from '../../../lib/api.js'
import { fmtDateDMY, fmtPesos, todayISO } from '../../../lib/format.js'
import { t } from '../../../lib/i18n.js'
import { confirmSheet } from '../../../sheets.jsx'
import Icon from '../../../components/Icon.jsx'
import QrCanvas from '../../../components/QrCanvas.jsx'
import { Button, NumberField, Row, SearchField, Section, Segmented, SelectRow, TextField, usePickerStep, useSheetBack } from '../../../components/ui.jsx'
import { methodLabel, paidAtFor } from '../billing/common.jsx'
import { DuplicateNotice, MEMBER_FIELDS, lookupDni, profileUrl } from './common.jsx'

// Flujos de fichas de socio (admin). Cada uno es UN sheet a pantalla completa; los que tienen
// pasos (unir ficha con cuenta) retroceden un paso con el gesto de atrás, como MemberBillingSheet.

const userUrl = (userId, rest) => '/api/admin/users/' + encodeURIComponent(userId) + rest

function Header({ title, subtitle, onClose }) {
  return <div className="row between compound-builder-header">
    <div style={{ minWidth: 0 }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      {subtitle && <div className="t-sub" style={{ color: 'var(--label-2)', marginTop: 2 }}>{subtitle}</div>}
    </div>
    <button type="button" className="iconbtn" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
  </div>
}

// Otra persona ya tiene ese DNI (lookup o 409 dni_duplicado del servidor).
const duplicateFrom = e => e?.data?.error === 'dni_duplicado' ? { userId: e.data.userId, name: e.data.name, hasApp: !!e.data.hasApp } : null

const INPUTS = {
  full_name: { type: 'text', inputMode: 'text', maxLength: 80 },
  dni: { type: 'text', inputMode: 'numeric', pattern: '[0-9]*', maxLength: 8 },
  phone: { type: 'tel', inputMode: 'tel', maxLength: 30 },
  email: { type: 'email', inputMode: 'email', maxLength: 120 },
}

// Campos de la ficha según la config (solo los que se piden; * = obligatorio). `errors` trae el
// error del servidor por campo ({ dni: 'DNI inválido' }).
function MemberFields({ fields, values, onChange, errors, onDniBlur, extra }) {
  const shown = MEMBER_FIELDS.filter(f => fields[f.key]?.enabled)
  const anyRequired = shown.some(f => fields[f.key].required) || extra?.required
  return <div className="member-form">
    {extra && <label className="member-field">
      <span className="member-field-l">{t(extra.label)}{extra.required && ' *'}</span>
      <TextField type="text" inputMode="text" name="app-member-username" maxLength={40} value={values.name || ''}
        onChange={e => onChange('name', e.target.value)} aria-invalid={!!errors.name} />
      {errors.name && <span className="form-error" role="alert">{errors.name}</span>}
    </label>}
    {shown.map(f => <label key={f.key} className="member-field">
      <span className="member-field-l">{t(f.label)}{fields[f.key].required && ' *'}</span>
      <TextField {...INPUTS[f.key]} name={'app-member-' + f.key} value={values[f.prop] || ''}
        onChange={e => onChange(f.prop, f.key === 'dni' ? e.target.value.replace(/\D/g, '').slice(0, 8) : e.target.value)} onBlur={f.key === 'dni' ? onDniBlur : undefined}
        aria-invalid={!!errors[f.key]} />
      {errors[f.key] && <span className="form-error" role="alert">{errors[f.key]}</span>}
    </label>)}
    {anyRequired && <div className="dim small">{t('* Obligatorio')}</div>}
  </div>
}

// 400 del servidor → error del campo (field) o general.
const fieldError = e => e?.data?.field ? { [e.data.field]: e.message } : { general: e?.message || t('No se pudo guardar') }

const PRIVACY_NOTE = 'Estos datos se usan solo para identificar al socio en el gimnasio y solo los ve el staff.'

/* ---------------------------------- alta ---------------------------------- */

const START_OPTIONS = [
  ['payment', 'Registrar pago', 'Cobra el primer mes (o el plan que elijas) ahora.'],
  ['trial', 'Iniciar prueba', null],
  ['none', 'Solo ficha', 'Sin pago ni prueba: la cuota se carga después.'],
]

// "Cuota inicial" del alta: primer pago (con vista previa del vencimiento del servidor, dry_run)
// o prueba gratis. La elección de plan es un paso más del mismo sheet (picker).
function InitialFee({ fields, dni, plans, settings, today, start, setStart, pay, setPay, picker }) {
  const [preview, setPreview] = useState(null)       // { dueDate } | { trialUntil } | { error }
  const dniOn = !!fields.dni?.enabled
  const canTrial = dniOn && !!String(dni || '').trim()
  const trialWhy = !dniOn ? t('La prueba necesita el DNI (una por persona) y este gimnasio no lo pide. Se activa en Acceso → Datos del registro.')
    : !canTrial ? t('Cargá el DNI en el paso anterior para poder darle una prueba (una por persona).') : null
  const plan = plans.find(p => p.id === pay.planId) || null

  useEffect(() => {
    if (start === 'none' || (start === 'payment' && (!plan || !pay.date))) { setPreview(null); return }
    let alive = true
    const body = start === 'trial' ? { type: 'trial' }
      : { type: 'payment', planId: pay.planId, method: pay.method, paidAt: paidAtFor(pay.date, today), ...(Number.isInteger(pay.amount) && pay.amount > 0 ? { amount: pay.amount } : {}) }
    const timer = setTimeout(() => api('/api/admin/members', { method: 'POST', body: JSON.stringify({ dry_run: true, start: body }) })
      .then(r => { if (alive) setPreview(r) })
      .catch(e => { if (alive) setPreview({ error: e.message }) }), 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [start, pay.planId, pay.date, pay.method])

  const days = settings.trial_days
  const trialLine = preview?.trialUntil
    ? t(days === 1 ? 'Prueba de 1 día, vence el {1}' : 'Prueba de {0} días, vence el {1}', days, fmtDateDMY(preview.trialUntil).slice(0, 5))
    : t(days === 1 ? 'Prueba de 1 día' : 'Prueba de {0} días', days)
  return <>
    <Section title={t('Cuota inicial')}>
      {START_OPTIONS.map(([value, label, sub]) => {
        const disabled = value === 'trial' ? !canTrial : value === 'payment' && !plans.length
        const subtitle = value === 'trial' ? (trialWhy || trialLine) : value === 'payment' && !plans.length ? t('No hay planes activos. Creá uno desde Cuotas → Planes.') : t(sub)
        return <Row key={value} title={t(label)} subtitle={subtitle} className={'start-opt' + (disabled ? ' lrow-disabled' : '')}
          onClick={disabled ? undefined : () => setStart(value)} accessory={start === value ? 'check' : 'none'} />
      })}
    </Section>
    {start === 'payment' && plan && <>
      <Section title={t('Pago')}>
        <SelectRow title={t('Plan')} value={pay.planId} sheetTitle={t('Plan')} picker={picker}
          onChange={id => setPay(p => ({ ...p, planId: id, amount: plans.find(x => x.id === id)?.price ?? p.amount }))}
          options={plans.map(p => ({ value: p.id, label: p.name, subtitle: `${fmtPesos(p.price)} · ${t('{0} días', p.durationDays)}` }))} />
        <Row title={t('Monto ($)')}>
          <NumberField className="row-num wide" value={pay.amount} onChange={v => setPay(p => ({ ...p, amount: v }))} decimal={false} nullable />
        </Row>
        <Row title={t('Fecha')}>
          <input name="app-member-paid-date" type="date" className="timef" aria-label={t('Fecha')} value={pay.date} max={today}
            onChange={e => setPay(p => ({ ...p, date: e.target.value }))} />
        </Row>
      </Section>
      <section className="sect">
        <h2 className="sect-t">{t('Método')}</h2>
        <Segmented options={settings.payment_methods.map(m => ({ value: m, label: methodLabel(m) }))} value={pay.method} onChange={m => setPay(p => ({ ...p, method: m }))} />
      </section>
      <Section title={t('Nota')}>
        <TextField type="text" inputMode="text" value={pay.note} onChange={e => setPay(p => ({ ...p, note: e.target.value }))} maxLength={200} placeholder={t('Opcional')} />
      </Section>
      <div className="nutri-live row between" aria-live="polite">
        <span>{t('Vence el')}</span>
        <span>{preview?.dueDate ? fmtDateDMY(preview.dueDate) : preview?.error ? '—' : t('Calculando…')}</span>
      </div>
    </>}
    {preview?.error && <div className="form-error" role="alert">{preview.error}</div>}
  </>
}

// Nuevo socio sin app, en pasos: datos → (con cuotas encendido) cuota inicial. Un DNI repetido
// (al salir del campo o al guardar) ofrece abrir a esa persona en vez de crear otra. La ficha y
// el pago o la prueba se guardan juntos (una transacción en el servidor).
export function MemberCreateSheet({ billingEnabled, close, setOnBack, onCreated, onOpenExisting }) {
  const toast = useUI(s => s.toast)
  const today = todayISO()
  const [step, setStep] = useState('datos')
  const [fields, setFields] = useState(null)
  const [plans, setPlans] = useState(billingEnabled ? null : [])
  const [settings, setSettings] = useState(billingEnabled ? null : {})
  const [values, setValues] = useState({})
  const [start, setStart] = useState('none')
  const [pay, setPay] = useState({ planId: null, amount: null, method: null, date: today, note: '' })
  const [duplicate, setDuplicate] = useState(null)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const picker = usePickerStep()

  useSheetBack(setOnBack, () => picker.isOpen ? picker.close() : step === 'cuota' ? setStep('datos') : close())

  useEffect(() => {
    api('/api/admin/members/settings').then(d => setFields(d.fields)).catch(e => setErrors({ general: e.message }))
    if (!billingEnabled) return
    Promise.all([api('/api/admin/billing/plans'), api('/api/admin/billing/settings')]).then(([p, s]) => {
      const active = p.plans.filter(x => x.active)
      setPlans(active)
      setSettings(s.settings)
      // Lo habitual es cobrar el primer pago: queda elegido si hay planes.
      if (active.length) {
        setStart('payment')
        setPay(cur => ({ ...cur, planId: active[0].id, amount: active[0].price, method: s.settings.payment_methods[0] }))
      }
    }).catch(e => setErrors({ general: e.message }))
  }, [])

  const change = (prop, value) => {
    setValues(v => ({ ...v, [prop]: value }))
    if (prop === 'dni') setDuplicate(null)
  }
  const checkDni = () => lookupDni(values.dni).then(found => setDuplicate(found))
  const needsName = fields && !fields.full_name?.enabled
  // Sin DNI la prueba no se puede dar: si estaba elegida, vuelve a "solo ficha".
  useEffect(() => { if (start === 'trial' && !String(values.dni || '').trim()) setStart('none') }, [values.dni])

  const save = () => {
    const body = {}
    for (const f of MEMBER_FIELDS) {
      const v = (values[f.prop] || '').trim()
      if (fields[f.key]?.enabled && v) body[f.prop] = v
    }
    if (needsName) body.name = (values.name || '').trim()
    if (billingEnabled && start === 'payment') {
      body.start = { type: 'payment', planId: pay.planId, method: pay.method, paidAt: paidAtFor(pay.date, today), note: pay.note.trim() || undefined, amount: pay.amount }
    } else if (billingEnabled && start === 'trial') body.start = { type: 'trial' }
    setSaving(true); setErrors({})
    api('/api/admin/members', { method: 'POST', body: JSON.stringify(body) })
      .then(({ member }) => { toast(t('Socio creado')); close(); onCreated(member.userId) })
      .catch(e => {
        setSaving(false)
        const dup = duplicateFrom(e)
        // Lo que falla en los datos se corrige en el primer paso.
        if (dup) { setDuplicate(dup); setStep('datos') }
        else if (e?.data?.field) { setErrors(fieldError(e)); setStep('datos') }
        else setErrors({ general: e?.data?.message || e?.message || t('No se pudo guardar') })
      })
  }
  const openExisting = id => { close(); onOpenExisting(id) }
  const loading = !fields || !plans || !settings
  const payOk = start !== 'payment' || (pay.planId && Number.isInteger(pay.amount) && pay.amount > 0 && pay.date && pay.method)

  return <div className="compound-builder"><div className="compound-builder-content">
    {picker.view}
    <div hidden={picker.isOpen}>
      <Header title={t('Nuevo socio')} subtitle={step === 'cuota' ? t('Paso 2 de 2 · Cuota inicial') : billingEnabled ? t('Paso 1 de 2 · Datos') : t('Sin app: lo carga el gimnasio')} onClose={close} />
      {loading ? <div className="dim small">{t('Loading…')}</div> : <>
        <div hidden={step !== 'datos'}>
          <MemberFields fields={fields} values={values} onChange={change} errors={errors} onDniBlur={checkDni}
            extra={needsName ? { label: 'Nombre del socio', required: true } : null} />
          {duplicate && <DuplicateNotice other={duplicate} onOpen={openExisting} />}
        </div>
        {step === 'cuota' && <>
          <Button size="sm" icon="chevronLeft" onClick={() => setStep('datos')}>{t('Volver')}</Button>
          <div style={{ height: 10 }} />
          <InitialFee fields={fields} dni={values.dni} plans={plans} settings={settings} today={today}
            start={start} setStart={setStart} pay={pay} setPay={setPay} picker={picker.open} />
        </>}
        {errors.general && <div className="form-error" role="alert">{errors.general}</div>}
        <div style={{ height: 12 }} />
        {billingEnabled && step === 'datos'
          ? <Button variant="primary" disabled={!!duplicate} onClick={() => { setErrors({}); setStep('cuota') }}>{t('Siguiente')}</Button>
          : <Button variant="primary" disabled={saving || !!duplicate || !payOk} onClick={save}>{saving ? t('Guardando…') : t('Crear socio')}</Button>}
        <p className="dim small member-privacy">{t(PRIVACY_NOTE)}</p>
      </>}
    </div>
  </div></div>
}

/* --------------------------------- edición -------------------------------- */

// Edición parcial de la ficha: solo va lo que cambió ('' borra). Un DNI de otra persona muestra
// quién es y, si una es ficha sin app y la otra una cuenta con app (no staff), ofrece unirlas.
export function ProfileEditSheet({ user, users, profile, fields, close, onSaved, openUser, onLink }) {
  const toast = useUI(s => s.toast)
  const initial = Object.fromEntries(MEMBER_FIELDS.map(f => [f.prop, profile[f.prop] ?? '']))
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState({})
  const [duplicate, setDuplicate] = useState(null)
  const [saving, setSaving] = useState(false)
  const change = (prop, value) => { setValues(v => ({ ...v, [prop]: value })); if (prop === 'dni') setDuplicate(null) }
  const body = {}
  for (const f of MEMBER_FIELDS) if (fields[f.key]?.enabled && (values[f.prop] || '').trim() !== (initial[f.prop] || '')) body[f.prop] = values[f.prop].trim()
  const dirty = Object.keys(body).length > 0

  const save = () => {
    setSaving(true); setErrors({})
    api(profileUrl(user.id), { method: 'PUT', body: JSON.stringify(body) })
      .then(() => { toast(t('Ficha guardada')); close(); onSaved() })
      .catch(e => { setSaving(false); const dup = duplicateFrom(e); dup ? setDuplicate(dup) : setErrors(fieldError(e)) })
  }
  // Unir tiene sentido entre una ficha sin app y una cuenta con app que no sea staff.
  const staff = id => { const u = (users || []).find(x => x.id === id); return !!(u && (u.admin || u.owner)) }
  const pair = duplicate && user.hasApp !== duplicate.hasApp
    ? (user.hasApp ? { fichaId: duplicate.userId, fichaName: duplicate.name, targetId: user.id } : { fichaId: user.id, fichaName: user.name, targetId: duplicate.userId })
    : null
  const canLink = pair && onLink && !staff(pair.targetId)

  return <div className="compound-builder"><div className="compound-builder-content">
    <Header title={t('Editar ficha')} subtitle={user.name} onClose={close} />
    <MemberFields fields={fields} values={values} onChange={change} errors={errors} />
    {duplicate && <DuplicateNotice other={duplicate}
      onOpen={openUser ? id => { close(); openUser(id) } : null}
      onLink={canLink ? () => { close(); onLink(pair) } : null} />}
    {errors.general && <div className="form-error" role="alert">{errors.general}</div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={saving || !dirty} onClick={save}>{saving ? t('Guardando…') : t('Guardar')}</Button>
    <p className="dim small member-privacy">{t(PRIVACY_NOTE)}</p>
  </div></div>
}

/* --------------------------- código de vinculación ------------------------- */

const pad = n => String(n).padStart(2, '0')
export const expiryLabel = iso => {
  const d = new Date(iso)
  return t('Vence el {0} a las {1}', `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`, `${pad(d.getHours())}:${pad(d.getMinutes())}`)
}

export const LINK_POLL_MS = 3000

// Genera el código al abrirse (el servidor revoca el anterior) y lo muestra una sola vez.
// Mientras está abierto pregunta cada 3 s si el socio ya creó su acceso: en ese caso se cierra
// solo y avisa (onLinked refresca el detalle y la lista). Cerrar el sheet corta el polling.
export function LinkCodeSheet({ user, close, onLinked }) {
  const toast = useUI(s => s.toast)
  const [data, setData] = useState(null)     // { code, link, expiresAt }
  const [error, setError] = useState(null)
  const asked = useRef(false)                // StrictMode monta dos veces: un solo código
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    api(userUrl(user.id, '/link-code'), { method: 'POST', body: '{}' }).then(setData).catch(e => setError(e.message))
  }, [])
  useEffect(() => {
    if (!data) return
    let alive = true
    const timer = setInterval(() => {
      api('/api/admin/user?id=' + encodeURIComponent(user.id)).then(d => {
        if (!alive || !d?.user?.hasApp) return
        alive = false
        clearInterval(timer)
        toast(t('{0} ya tiene acceso a la app', d.user.name || user.name))
        close()
        onLinked?.()
      }).catch(() => {})          // sin red: se reintenta en el próximo ciclo
    }, LINK_POLL_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [data])
  const copy = () => navigator.clipboard?.writeText(data.link)
    .then(() => toast(t('Link copiado'))).catch(() => toast(t('No se pudo copiar el link')))
  const share = () => navigator.share
    ? navigator.share({ title: 'lauyim', text: t('Tu código del gimnasio: {0}', data.code), url: data.link }).catch(() => {})
    : copy()
  const revoke = () => confirmSheet({
    title: t('¿Revocar el código?'),
    message: t('El código deja de funcionar en el acto. Para vincular después, generá uno nuevo.'),
    confirmText: t('Revocar'), danger: true,
    onConfirm: () => api(userUrl(user.id, '/link-code'), { method: 'DELETE' })
      .then(() => { toast(t('Código revocado')); close() })
      .catch(e => setError(e.message))
  })

  return <div className="compound-builder"><div className="compound-builder-content">
    <Header title={t('Código de vinculación')} subtitle={user.name} onClose={close} />
    {error ? <div className="form-error" role="alert">{error}</div>
      : !data ? <div className="dim small">{t('Generando código…')}</div>
      : <div className="link-code">
        <div className="link-code-qr"><QrCanvas value={data.link} size={220} ariaLabel={t('QR del código de vinculación')} /></div>
        <div className="link-code-v" aria-label={t('Código')}>{data.code}</div>
        <div className="small muted">{expiryLabel(data.expiresAt)}</div>
        <div className="link-code-a">
          <Button size="sm" variant="tinted" onClick={copy}>{t('Copiar link')}</Button>
          <Button size="sm" variant="tinted" onClick={share}>{t('Compartir')}</Button>
          <Button size="sm" variant="ghost" style={{ color: 'var(--danger)' }} onClick={revoke}>{t('Revocar')}</Button>
        </div>
        <div className="member-warn small" role="note">{t('El código se muestra una sola vez. Si cerrás, generá uno nuevo.')}</div>
        <div className="dim small">{t('El socio lo carga en "Tengo un código del gym" al entrar a la app, o escanea el QR.')}</div>
      </div>}
  </div></div>
}

/* ------------------------- unir ficha con una cuenta ------------------------ */

const LOST_LABELS = {
  state: 'ajustes de la app', routines: 'rutinas', weekPlan: 'días de la semana', dayPlan: 'días planificados',
  workouts: 'entrenamientos', exerciseWeights: 'pesos por ejercicio', bodyweight: 'registros de peso',
  customExercises: 'ejercicios propios', exerciseNotes: 'notas de ejercicios', reminders: 'recordatorios',
  equipProfiles: 'perfiles de equipamiento', meals: 'comidas registradas', mealTemplates: 'plantillas de comida',
  subscriptions: 'suscripciones de notificaciones'
}
const planLine = b => !b ? null : b.trialUntil ? t('Prueba hasta {0}', fmtDateDMY(b.trialUntil).slice(0, 5))
  : [b.planName || t('Plan'), b.dueDate && t('vence el {0}', fmtDateDMY(b.dueDate))].filter(Boolean).join(' · ')

function AccountPicker({ ficha, users, onPick }) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLocaleLowerCase()
  const list = (users || []).filter(u => u.hasApp && !u.admin && !u.owner && u.id !== ficha.id)
    .filter(u => !needle || u.name.toLocaleLowerCase().includes(needle))
  return <>
    <div className="small muted" style={{ marginBottom: 10 }}>{t('Elegí la cuenta con app de la misma persona. La ficha se une a esa cuenta.')}</div>
    <SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder={t('Buscar cuenta por nombre')} aria-label={t('Buscar cuenta por nombre')} />
    <div className="sect-b" style={{ marginTop: 10 }}>
      {list.map(u => <Row key={u.id} title={u.name} subtitle={u.disabled ? t('Desactivada') : null} onClick={() => onPick(u)} accessory="chevron" />)}
    </div>
    {!list.length && <div className="empty">{t('Ninguna cuenta con app coincide.')}</div>}
  </>
}

function MergePreview({ plan, keep, setKeep }) {
  const b = plan.billing
  const moves = [
    t(plan.payments === 1 ? '1 pago' : '{0} pagos', plan.payments),
    b.ficha && !b.conflict ? t('Plan: {0}', planLine(b.ficha)) : null,
    plan.profile.action === 'move' ? t('Los datos de la ficha (nombre y apellido, DNI, celular, mail)')
      : plan.profile.action === 'fill' ? t('Los datos de la ficha que le falten a la cuenta') : null,
  ].filter(Boolean)
  const lost = Object.entries(plan.lost || {})
  return <>
    <Section title={t('Pasa a {0}', plan.target.name)}>
      {moves.map((m, i) => <Row key={i} title={m} />)}
    </Section>
    {b.conflict && <Section title={t('Las dos tienen plan: ¿cuál queda?')}>
      <Row title={t('Mantener el plan de la ficha')} subtitle={planLine(b.ficha)} onClick={() => setKeep('ficha')} accessory={keep === 'ficha' ? 'check' : 'none'} />
      <Row title={t('Mantener el plan de la cuenta')} subtitle={planLine(b.cuenta)} onClick={() => setKeep('cuenta')} accessory={keep === 'cuenta' ? 'check' : 'none'} />
    </Section>}
    {lost.length > 0 && <Section title={t('Se pierde')} footer={t('Son datos cargados en la ficha que la cuenta no recibe.')}>
      {lost.map(([key, n]) => <Row key={key} title={t(LOST_LABELS[key] || key)} value={String(n)} />)}
    </Section>}
  </>
}

// Pasos: elegir cuenta (salvo que venga elegida) → vista previa (dry_run) → confirmar en rojo →
// merge real → onMerged(cuenta), que abre el detalle de la cuenta destino.
export function MergeSheet({ ficha, users, targetId: presetTarget, close, setOnBack, onMerged }) {
  const toast = useUI(s => s.toast)
  const [target, setTarget] = useState(presetTarget ? { id: presetTarget } : null)
  const [plan, setPlan] = useState(null)
  const [keep, setKeep] = useState(null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const step = target ? 'preview' : 'pick'

  useSheetBack(setOnBack, () => { if (step === 'preview' && !presetTarget) { setTarget(null); setPlan(null); setError(null); setKeep(null) } else close() })

  useEffect(() => {
    if (!target) return
    let alive = true
    api(userUrl(ficha.id, '/merge'), { method: 'POST', body: JSON.stringify({ targetId: target.id, dry_run: true }) })
      .then(p => { if (alive) setPlan(p) })
      .catch(e => { if (alive) setError(e.data?.message || e.message) })
    return () => { alive = false }
  }, [target?.id])

  const merge = () => {
    setSaving(true); setError(null)
    api(userUrl(ficha.id, '/merge'), { method: 'POST', body: JSON.stringify({ targetId: target.id, ...(plan.billing.conflict ? { keepBilling: keep } : {}) }) })
      .then(r => { toast(t('Ficha unida a {0}', r.target.name)); close(); onMerged(r.target.id) })
      .catch(e => { setSaving(false); setError(e.data?.message || e.message) })
  }
  const confirm = () => confirmSheet({
    title: t('¿Unir {0} con {1}?', ficha.name, plan.target.name),
    message: t('La ficha se borra, esta acción no se puede deshacer.'),
    confirmText: t('Unir'), danger: true, onConfirm: merge
  })
  const blocked = plan?.profile.conflict
  const ready = plan && !blocked && (!plan.billing.conflict || keep)

  return <div className="compound-builder"><div className="compound-builder-content">
    <Header title={t('Vincular con cuenta existente')} subtitle={t('Ficha: {0}', ficha.name)} onClose={close} />
    {step === 'pick' ? <AccountPicker ficha={ficha} users={users} onPick={u => setTarget(u)} /> : <>
      {!presetTarget && <><Button size="sm" icon="chevronLeft" onClick={() => { setTarget(null); setPlan(null); setError(null); setKeep(null) }}>{t('Volver')}</Button><div style={{ height: 10 }} /></>}
      {error ? <div className="form-error" role="alert">{error}</div>
        : !plan ? <div className="dim small">{t('Calculando…')}</div>
        : blocked ? <div className="form-error" role="alert">{t('La ficha y la cuenta tienen DNI distintos: no se pueden unir. Revisá cuál es el correcto y corregilo antes de vincular.')}</div>
        : <MergePreview plan={plan} keep={keep} setKeep={setKeep} />}
      {plan && !blocked && <>
        <div style={{ height: 12 }} />
        <Button variant="danger" disabled={!ready || saving} onClick={confirm}>{saving ? t('Uniendo…') : t('Unir ficha con {0}', plan.target.name)}</Button>
        {plan.billing.conflict && !keep && <div className="dim small" style={{ marginTop: 6, textAlign: 'center' }}>{t('Elegí qué plan queda para seguir.')}</div>}
      </>}
    </>}
  </div></div>
}

