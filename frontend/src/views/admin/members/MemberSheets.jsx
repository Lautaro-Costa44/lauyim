import { useEffect, useRef, useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { api } from '../../../lib/api.js'
import { addDaysISO, fmtDateDMY, fmtPesos, todayISO } from '../../../lib/format.js'
import { t } from '../../../lib/i18n.js'
import { confirmSheet } from '../../../sheets.jsx'
import Icon from '../../../components/Icon.jsx'
import QrCanvas from '../../../components/QrCanvas.jsx'
import { Button, Row, SearchField, Section, SelectRow, TextField } from '../../../components/ui.jsx'
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

// Back de un sheet con pasos: un solo registro, lo variable se lee por ref (ver MemberBillingSheet).
function useSheetBack(setOnBack, goBack) {
  const ref = useRef(goBack)
  ref.current = goBack
  useEffect(() => {
    if (!setOnBack) return
    setOnBack(() => ref.current())
    return () => setOnBack(null)
  }, [setOnBack])
}

// Otra persona ya tiene ese DNI (lookup o 409 dni_duplicado del servidor).
const duplicateFrom = e => e?.data?.error === 'dni_duplicado' ? { userId: e.data.userId, name: e.data.name, hasApp: !!e.data.hasApp } : null

const INPUTS = {
  full_name: { type: 'text', inputMode: 'text', maxLength: 80 },
  dni: { type: 'text', inputMode: 'numeric', maxLength: 12 },
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
        onChange={e => onChange(f.prop, e.target.value)} onBlur={f.key === 'dni' ? onDniBlur : undefined}
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

// Nuevo socio sin app. Con cuotas encendido, plan y vencimiento opcionales. Un DNI repetido
// (al salir del campo o al guardar) ofrece abrir a esa persona en vez de crear otra.
export function MemberCreateSheet({ billingEnabled, close, onCreated, onOpenExisting }) {
  const toast = useUI(s => s.toast)
  const [fields, setFields] = useState(null)
  const [plans, setPlans] = useState(billingEnabled ? null : [])
  const [values, setValues] = useState({})
  const [planId, setPlanId] = useState(null)
  const [dueDate, setDueDate] = useState('')
  const [dateTouched, setDateTouched] = useState(false)
  const [duplicate, setDuplicate] = useState(null)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const today = todayISO()

  useEffect(() => {
    api('/api/admin/members/settings').then(d => setFields(d.fields)).catch(e => setErrors({ general: e.message }))
    if (billingEnabled) api('/api/admin/billing/plans').then(d => setPlans(d.plans.filter(p => p.active))).catch(() => setPlans([]))
  }, [])

  const change = (prop, value) => {
    setValues(v => ({ ...v, [prop]: value }))
    if (prop === 'dni') setDuplicate(null)
  }
  const checkDni = () => lookupDni(values.dni).then(found => setDuplicate(found))
  const changePlan = id => {
    setPlanId(id)
    const plan = (plans || []).find(p => p.id === id)
    if (plan && !dateTouched) setDueDate(addDaysISO(today, plan.durationDays))
  }
  const needsName = fields && !fields.full_name?.enabled
  const save = () => {
    const body = {}
    for (const f of MEMBER_FIELDS) {
      const v = (values[f.prop] || '').trim()
      if (fields[f.key]?.enabled && v) body[f.prop] = v
    }
    if (needsName) body.name = (values.name || '').trim()
    if (planId != null) { body.planId = planId; body.dueDate = dueDate }
    setSaving(true); setErrors({})
    api('/api/admin/members', { method: 'POST', body: JSON.stringify(body) })
      .then(({ member }) => { toast(t('Socio creado')); close(); onCreated(member.userId) })
      .catch(e => {
        setSaving(false)
        const dup = duplicateFrom(e)
        if (dup) setDuplicate(dup)
        else setErrors(fieldError(e))
      })
  }
  const openExisting = id => { close(); onOpenExisting(id) }

  return <div className="compound-builder"><div className="compound-builder-content">
    <Header title={t('Nuevo socio')} subtitle={t('Sin app: lo carga el gimnasio')} onClose={close} />
    {!fields || !plans ? <div className="dim small">{t('Loading…')}</div> : <>
      <MemberFields fields={fields} values={values} onChange={change} errors={errors} onDniBlur={checkDni}
        extra={needsName ? { label: 'Nombre del socio', required: true } : null} />
      {duplicate && <DuplicateNotice other={duplicate} onOpen={openExisting} />}
      {billingEnabled && plans.length > 0 && <Section title={t('Cuota (opcional)')}>
        <SelectRow title={t('Plan')} value={planId} onChange={changePlan} sheetTitle={t('Plan')}
          options={[{ value: null, label: t('Sin plan') }, ...plans.map(p => ({ value: p.id, label: p.name, subtitle: `${fmtPesos(p.price)} · ${t('{0} días', p.durationDays)}` }))]} />
        {planId != null && <Row title={t('Vence')}>
          <input name="app-member-due-date" type="date" className="timef" aria-label={t('Vence')} value={dueDate}
            onChange={e => { setDateTouched(true); setDueDate(e.target.value) }} />
        </Row>}
      </Section>}
      {errors.general && <div className="form-error" role="alert">{errors.general}</div>}
      <div style={{ height: 12 }} />
      <Button variant="primary" disabled={saving || !!duplicate || (planId != null && !dueDate)} onClick={save}>{saving ? t('Guardando…') : t('Crear socio')}</Button>
      <p className="dim small member-privacy">{t(PRIVACY_NOTE)}</p>
    </>}
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

// Genera el código al abrirse (el servidor revoca el anterior) y lo muestra una sola vez.
export function LinkCodeSheet({ user, close }) {
  const toast = useUI(s => s.toast)
  const [data, setData] = useState(null)     // { code, link, expiresAt }
  const [error, setError] = useState(null)
  const asked = useRef(false)                // StrictMode monta dos veces: un solo código
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    api(userUrl(user.id, '/link-code'), { method: 'POST', body: '{}' }).then(setData).catch(e => setError(e.message))
  }, [])
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
const planLine = b => b ? [b.planName || t('Plan'), b.dueDate && t('vence el {0}', fmtDateDMY(b.dueDate))].filter(Boolean).join(' · ') : null

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

