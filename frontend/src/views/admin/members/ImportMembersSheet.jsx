import { useEffect, useMemo, useRef, useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { api } from '../../../lib/api.js'
import { fmtPesos } from '../../../lib/format.js'
import { t } from '../../../lib/i18n.js'
import Icon from '../../../components/Icon.jsx'
import { Button, NumberField, Row, Section, Segmented, SelectRow, TextField, usePickerStep, useSheetBack } from '../../../components/ui.jsx'
import { methodLabel } from '../billing/common.jsx'
import { useDesktop } from '../useDesktop.js'
import {
  FIELD_OPTIONS, buildRows, distinctPlans, downloadText, errorsCsv, fieldLabel, autodetectColumns,
  maskDni, mappingProblems, planKey, readImportFile, sampleValues, templateCsv
} from './import-parse.js'

// Importar socios desde Excel/CSV (solo owner). UN sheet a pantalla completa con pasos internos
// (atrás retrocede un paso, como MemberCreateSheet): archivo → columnas → planes (si se mapeó
// Plan y cuotas está encendido) → opciones → vista previa (dry_run del servidor) → resultado.
// Este chunk se descarga al abrir el sheet; el lector de .xlsx, recién al elegir un .xlsx.
// En escritorio (>= 1000px) columnas, planes y vista previa son tablas; en el celular, filas.

const IMPORT_URL = '/api/owner/members/import'
const PREVIEW_LIMIT = 300          // filas por pestaña en la vista previa; el CSV de errores las trae todas
const PREVIEW_TABS = [['nuevo', 'Nuevos'], ['existente', 'Ya existen'], ['error', 'Errores']]

function Header({ title, subtitle, onClose }) {
  return <div className="row between compound-builder-header">
    <div style={{ minWidth: 0 }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      {subtitle && <div className="t-sub" style={{ color: 'var(--label-2)', marginTop: 2 }}>{subtitle}</div>}
    </div>
    <button type="button" className="iconbtn" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
  </div>
}

// Selector de una celda de tabla: abre el mismo paso de lista (picker) que SelectRow.
function PickCell({ label, onClick, muted, ariaLabel }) {
  return <button type="button" className={'import-pick' + (muted ? ' muted' : '')} onClick={onClick} aria-label={ariaLabel}>
    <span>{label}</span><Icon name="chevronRight" />
  </button>
}

const columnName = (header, i) => header || t('Columna {0}', String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ''))

/* ---------------------------------- pasos --------------------------------- */

function FileStep({ file, error, reading, onPick }) {
  const input = useRef(null)
  return <>
    <Section footer={t('La primera fila tiene que ser el encabezado (Nombre y apellido, DNI, Celular…). Máximo 2000 socios por archivo.')}>
      <Row title={file ? file.name : t('Elegir archivo')} subtitle={file ? t('{0} filas con datos', file.data.length) : t('Excel (.xlsx) o CSV')}
        icon="upload" accessory="chevron" onClick={() => input.current?.click()} />
    </Section>
    <input ref={input} type="file" hidden accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
      data-testid="import-file" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f) }} />
    {reading && <div className="dim small">{t('Leyendo archivo…')}</div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <Button variant="tinted" size="sm" icon="download" onClick={() => downloadText('plantilla-socios.csv', templateCsv())}>{t('Descargar plantilla')}</Button>
    <p className="dim small import-note">{t('La plantilla abre bien en Excel. Completala y guardala como .xlsx o .csv.')}</p>
  </>
}

function ColumnsStep({ file, mapping, setMapping, picker, problems, desktop }) {
  const options = FIELD_OPTIONS.map(o => ({ value: o.value, label: t(o.label) }))
  const choose = (h, i) => picker({ title: columnName(h, i), options, value: mapping[i], onChange: v => setMapping(m => m.map((x, j) => j === i ? v : x)) })
  return <>
    <p className="small muted import-note">{t('Elegí qué dato tiene cada columna. Las que no sirven quedan en Ignorar.')}</p>
    {desktop ? <div className="billing-table-wrap import-table-wrap">
      <table className="billing-table import-table">
        <thead><tr><th>{t('Columna del archivo')}</th><th>{t('Ejemplos')}</th><th className="pick">{t('Campo')}</th></tr></thead>
        <tbody>
          {file.headers.map((h, i) => {
            const samples = sampleValues(file.data, i)
            return <tr key={i} className={'import-col' + (mapping[i] === 'ignore' ? ' ignored' : '')}>
              <td className="strong">{columnName(h, i)}</td>
              <td className="samples">{samples.length ? samples.map((v, j) => <div key={j}>{v}</div>) : <span className="dim">{t('(vacía)')}</span>}</td>
              <td className="pick"><PickCell label={t(fieldLabel(mapping[i]))} muted={mapping[i] === 'ignore'} ariaLabel={t('Campo de {0}', columnName(h, i))} onClick={() => choose(h, i)} /></td>
            </tr>
          })}
        </tbody>
      </table>
    </div> : <Section>
      {file.headers.map((h, i) => {
        const samples = sampleValues(file.data, i)
        return <Row key={i} title={columnName(h, i)} subtitle={samples.length ? samples.join(' · ') : t('(vacía)')}
          value={t(fieldLabel(mapping[i]))} accessory="chevron" className={'import-col' + (mapping[i] === 'ignore' ? ' ignored' : '')}
          onClick={() => choose(h, i)} />
      })}
    </Section>}
    {problems.map(p => <div key={p} className="form-error" role="alert">{t(p)}</div>)}
  </>
}

const planChoiceValue = c => c.action === 'existing' ? 'p:' + c.planId : c.action

function PlansStep({ plans, activePlans, choices, setChoice, picker, desktop }) {
  const options = [
    ...activePlans.map(p => ({ value: 'p:' + p.id, label: p.name, subtitle: `${fmtPesos(p.price)} · ${t('{0} días', p.durationDays)}` })),
    { value: 'create', label: t('Crear plan nuevo') },
    { value: 'none', label: t('Sin plan') },
  ]
  const pick = (key, v) => setChoice(key, v.startsWith('p:') ? { action: 'existing', planId: Number(v.slice(2)) } : { action: v })
  const open = p => picker({ title: p.value, options, value: planChoiceValue(choices[p.key]), onChange: v => pick(p.key, v) })
  const labelOf = c => options.find(o => o.value === planChoiceValue(c))?.label || ''
  const intro = <p className="small muted import-note">{t('Cada plan del archivo con cuántos socios lo tienen. Elegí a qué plan corresponde.')}</p>
  if (desktop) return <>
    {intro}
    <div className="billing-table-wrap import-table-wrap">
      <table className="billing-table import-table import-plans">
        <thead><tr><th>{t('Valor del archivo')}</th><th className="num">{t('Socios')}</th><th className="pick">{t('Acción')}</th><th>{t('Plan nuevo: nombre · precio ($) · días')}</th></tr></thead>
        <tbody>
          {plans.map(p => {
            const c = choices[p.key]
            const existing = c.action === 'existing' && activePlans.find(x => x.id === c.planId)
            return <tr key={p.key}>
              <td className="strong">{p.value}</td>
              <td className="num">{p.count}</td>
              <td className="pick"><PickCell label={labelOf(c)} muted={c.action === 'none'} ariaLabel={t('Plan para {0}', p.value)} onClick={() => open(p)} /></td>
              <td>{c.action === 'create' ? <div className="import-plan-inline">
                <TextField type="text" inputMode="text" className="import-plan-name" value={c.name} maxLength={60} aria-label={t('Nombre del plan')}
                  onChange={e => setChoice(p.key, { ...c, name: e.target.value })} />
                <NumberField className="row-num wide" value={c.price} decimal={false} nullable aria-label={t('Precio del plan')} placeholder="$" onChange={v => setChoice(p.key, { ...c, price: v })} />
                <NumberField className="row-num" value={c.durationDays} decimal={false} nullable aria-label={t('Duración del plan')} onChange={v => setChoice(p.key, { ...c, durationDays: v })} />
              </div> : existing ? <span className="dim">{`${fmtPesos(existing.price)} · ${t('{0} días', existing.durationDays)}`}</span>
                : <span className="dim">—</span>}</td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
  </>
  return <>
    {intro}
    {plans.map(p => {
      const c = choices[p.key]
      return <Section key={p.key} title={t(p.count === 1 ? '"{0}" · 1 socio' : '"{0}" · {1} socios', p.value, p.count)}>
        <SelectRow title={t('Plan')} value={planChoiceValue(c)} options={options} sheetTitle={p.value} picker={picker} onChange={v => pick(p.key, v)} />
        {c.action === 'create' && <>
          <Row title={t('Nombre')}>
            <TextField type="text" inputMode="text" className="import-plan-name" value={c.name} maxLength={60} aria-label={t('Nombre del plan')}
              onChange={e => setChoice(p.key, { ...c, name: e.target.value })} />
          </Row>
          <Row title={t('Precio ($)')}>
            <NumberField className="row-num wide" value={c.price} decimal={false} nullable aria-label={t('Precio del plan')} onChange={v => setChoice(p.key, { ...c, price: v })} />
          </Row>
          <Row title={t('Duración (días)')}>
            <NumberField className="row-num" value={c.durationDays} decimal={false} nullable aria-label={t('Duración del plan')} onChange={v => setChoice(p.key, { ...c, durationDays: v })} />
          </Row>
        </>}
      </Section>
    })}
  </>
}

const choiceOk = c => c.action !== 'create'
  || (!!String(c.name || '').trim() && Number.isInteger(c.price) && c.price >= 0 && Number.isInteger(c.durationDays) && c.durationDays >= 1)

function OptionsStep({ options, setOptions, methods, showMethod, dniEnabled }) {
  const dup = [
    ['skip', 'Saltearlos', 'No se cambia nada de esos socios.'],
    ['fill_empty', 'Completar solo datos vacíos', 'Suma nombre, celular o mail si la ficha no los tiene.'],
  ]
  return <>
    {dniEnabled
      ? <Section title={t('Socios que ya existen (mismo DNI)')} footer={t('Nunca se pisan datos cargados ni se toca la cuota de un socio existente.')}>
        {dup.map(([value, label, sub]) => <Row key={value} title={t(label)} subtitle={t(sub)} accessory={options.duplicates === value ? 'check' : 'none'}
          onClick={() => setOptions(o => ({ ...o, duplicates: value }))} />)}
      </Section>
      : <div className="member-warn small import-note" role="note">{t('El DNI está desactivado: no se pueden detectar socios que ya existen. Todas las filas se cargan como nuevas.')}</div>}
    {showMethod && <section className="sect">
      <h2 className="sect-t">{t('Método de los pagos importados')}</h2>
      <Segmented options={methods.map(m => ({ value: m, label: methodLabel(m) }))} value={options.paymentMethod} onChange={m => setOptions(o => ({ ...o, paymentMethod: m }))} />
      <p className="sect-f">{t('El último pago de cada socio queda en su historial como "Importado". No se puede anular.')}</p>
    </section>}
  </>
}

const STATUS_LABELS = { nuevo: 'Nuevo', existente: 'Ya existe', error: 'Error' }

function PreviewStep({ preview, rows, tab, setTab, desktop }) {
  const s = preview.summary
  const counts = { nuevo: s.nuevos, existente: s.existentes, error: s.errores }
  const list = preview.rows.filter(r => r.status === tab)
  const source = useMemo(() => new Map(rows.map(r => [r.rowNumber, r])), [rows])
  const names = { get: n => source.get(n)?.fullName }
  return <>
    {preview.warnings.map(w => <div key={w} className="member-warn small import-warning" role="note">{t(w)}</div>)}
    <div className="import-totals">
      <div><span className="v">{s.nuevos}</span><span className="l">{t('Nuevos')}</span></div>
      <div><span className="v">{s.existentes}</span><span className="l">{t('Ya existen')}</span></div>
      <div className={s.errores ? 'bad' : ''}><span className="v">{s.errores}</span><span className="l">{t('Con error')}</span></div>
      <div><span className="v">{s.warnings}</span><span className="l">{t('Con avisos')}</span></div>
    </div>
    <Segmented options={PREVIEW_TABS.map(([value, label]) => ({ value, label: `${t(label)} (${counts[value]})` }))} value={tab} onChange={setTab} className="import-tabs" />
    {s.errores > 0 && tab === 'error' && <Button size="sm" variant="tinted" icon="download" className="import-errors-dl"
      onClick={() => downloadText('errores-importacion.csv', errorsCsv(preview.rows, rows))}>{t('Descargar errores')}</Button>}
    {desktop ? <div className="billing-table-wrap import-table-wrap">
      <table className="billing-table import-table import-preview">
        <thead><tr><th className="num">{t('Fila')}</th><th>{t('Nombre')}</th><th>DNI</th><th>{t('Estado')}</th><th>{t('Motivo')}</th></tr></thead>
        <tbody>
          {list.slice(0, PREVIEW_LIMIT).map(r => <tr key={r.rowNumber}>
            <td className="num">{r.rowNumber}</td>
            <td className="strong">{names.get(r.rowNumber) || <span className="dim">—</span>}</td>
            <td className="num">{maskDni(source.get(r.rowNumber)?.dni) || <span className="dim">—</span>}</td>
            <td><span className={'tag nocap import-st ' + r.status}>{t(STATUS_LABELS[r.status])}</span></td>
            <td className="why">{r.messages.map((m, i) => <div key={i} className={'import-msg ' + m.level}>{t(m.text)}</div>)}</td>
          </tr>)}
          {!list.length && <tr><td colSpan={5} className="empty">{t('Nada en esta pestaña.')}</td></tr>}
        </tbody>
      </table>
    </div> : <div className="sect-b import-rows" role="list">
      {list.slice(0, PREVIEW_LIMIT).map(r => <div key={r.rowNumber} role="listitem" className="lrow import-row">
        <span className="lrow-m">
          <span className="lrow-t">{t('Fila {0}', r.rowNumber)}{names.get(r.rowNumber) ? ' · ' + names.get(r.rowNumber) : ''}</span>
          {r.messages.map((m, i) => <span key={i} className={'lrow-s import-msg ' + m.level}>{t(m.text)}</span>)}
        </span>
      </div>)}
      {!list.length && <div className="empty" style={{ padding: 20 }}>{t('Nada en esta pestaña.')}</div>}
    </div>}
    {list.length > PREVIEW_LIMIT && <div className="dim small import-note">{t('Y {0} filas más.', list.length - PREVIEW_LIMIT)}</div>}
  </>
}

function ResultStep({ result }) {
  return <Section>
    <Row title={t('Creados')} value={String(result.created)} />
    <Row title={t('Completados')} value={String(result.updated)} />
    <Row title={t('Salteados')} value={String(result.skipped)} />
    <Row title={t('Con error (no se importaron)')} value={String(result.errors)} />
  </Section>
}

/* ---------------------------------- sheet --------------------------------- */

export function ImportMembersSheet({ billingEnabled, close, setOnBack, onImported, onShowMembers }) {
  const toast = useUI(s => s.toast)
  const picker = usePickerStep()
  const desktop = useDesktop()
  const [step, setStep] = useState('archivo')
  const [fields, setFields] = useState(null)
  const [plans, setPlans] = useState(billingEnabled ? null : [])
  const [methods, setMethods] = useState(billingEnabled ? null : [])
  const [file, setFile] = useState(null)             // { name, headers, data }
  const [reading, setReading] = useState(false)
  const [mapping, setMapping] = useState([])
  const [choices, setChoices] = useState({})         // planKey → { action, planId | name, price, durationDays }
  const [options, setOptions] = useState({ duplicates: 'skip', paymentMethod: null })
  const [preview, setPreview] = useState(null)
  const [tab, setTab] = useState('nuevo')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('/api/admin/members/settings').then(d => setFields(d.fields)).catch(e => setError(e.message))
    if (!billingEnabled) return
    Promise.all([api('/api/admin/billing/plans'), api('/api/admin/billing/settings')]).then(([p, s]) => {
      setPlans(p.plans)
      setMethods(s.settings.payment_methods)
      setOptions(o => ({ ...o, paymentMethod: s.settings.payment_methods[0] }))
    }).catch(e => setError(e.message))
  }, [])

  const dniEnabled = !!fields?.dni?.enabled
  const rows = useMemo(() => file ? buildRows(file.data, mapping) : [], [file, mapping])
  const planValues = useMemo(() => billingEnabled && mapping.includes('planValue') ? distinctPlans(rows) : [], [rows, billingEnabled, mapping])
  const activePlans = (plans || []).filter(p => p.active)
  const steps = ['archivo', 'columnas', ...(planValues.length ? ['planes'] : []), 'opciones', 'preview', 'resultado']
  const index = steps.indexOf(step)
  const problems = file ? mappingProblems(mapping, { dniEnabled }) : []

  // Cada valor de plan nuevo arranca en el plan con el mismo nombre, o en "crear" con ese nombre.
  useEffect(() => {
    setChoices(cur => {
      const next = {}
      for (const p of planValues) {
        const same = activePlans.find(x => planKey(x.name) === p.key)
        next[p.key] = cur[p.key] || (same ? { action: 'existing', planId: same.id } : { action: 'create', name: p.value.slice(0, 60), price: null, durationDays: 30 })
      }
      return next
    })
  }, [planValues, plans])

  const go = to => { setError(null); setStep(to) }
  const back = () => {
    if (picker.isOpen) return picker.close()
    if (step === 'resultado' || index <= 0) return close()
    go(steps[index - 1])
  }
  useSheetBack(setOnBack, back)

  const pickFile = async f => {
    setReading(true); setError(null)
    const read = await readImportFile(f).catch(() => ({ error: t('No se pudo leer el archivo') }))
    setReading(false)
    if (read.error) { setFile(null); setError(t(read.error)); return }
    setFile({ name: f.name, headers: read.headers, data: read.data })
    setMapping(autodetectColumns(read.headers))
    setPreview(null)
  }

  const body = dryRun => ({
    rows,
    planMap: planValues.map(p => {
      const c = choices[p.key]
      return c.action === 'create'
        ? { value: p.value, action: 'create', name: c.name.trim(), price: c.price, durationDays: c.durationDays }
        : { value: p.value, action: c.action, ...(c.action === 'existing' ? { planId: c.planId } : {}) }
    }),
    options: { duplicates: options.duplicates, ...(options.paymentMethod ? { paymentMethod: options.paymentMethod } : {}) },
    ...(dryRun ? { dry_run: true } : {}),
  })

  const runPreview = () => {
    setBusy(true); setError(null)
    api(IMPORT_URL, { method: 'POST', body: JSON.stringify(body(true)) })
      .then(p => { setPreview(p); setTab(p.summary.nuevos ? 'nuevo' : p.summary.errores ? 'error' : 'existente'); go('preview') })
      .catch(e => setError(e.data?.message || e.message))
      .finally(() => setBusy(false))
  }
  const runImport = () => {
    setBusy(true); setError(null)
    api(IMPORT_URL, { method: 'POST', body: JSON.stringify(body(false)) })
      .then(r => { setResult(r); go('resultado'); onImported?.(); toast(t(r.created === 1 ? '1 socio importado' : '{0} socios importados', r.created)) })
      .catch(e => setError(e.data?.message || e.message))
      .finally(() => setBusy(false))
  }

  const loading = !fields || !plans || !methods
  // Se importan los nuevos y, con "completar", los existentes que tienen algo para completar.
  const importable = preview ? preview.summary.nuevos + (options.duplicates === 'fill_empty' ? preview.summary.completar || 0 : 0) : 0
  const showMethod = billingEnabled && mapping.includes('lastPaymentDate')
  const next = {
    archivo: { label: t('Siguiente'), ok: !!file && !reading, run: () => go('columnas') },
    columnas: { label: t('Siguiente'), ok: !problems.length && rows.length > 0, run: () => go(steps[index + 1]) },
    planes: { label: t('Siguiente'), ok: planValues.every(p => choices[p.key] && choiceOk(choices[p.key])), run: () => go('opciones') },
    opciones: { label: busy ? t('Revisando…') : t('Ver vista previa'), ok: !busy && (!showMethod || !!options.paymentMethod), run: runPreview },
    preview: { label: busy ? t('Importando…') : t(importable === 1 ? 'Importar 1 socio' : 'Importar {0} socios', importable), ok: !busy && importable > 0, run: runImport },
    resultado: { label: t('Ver socios'), ok: true, run: () => { close(); onShowMembers?.() } },
  }[step]
  const titles = { archivo: 'Archivo', columnas: 'Columnas', planes: 'Planes', opciones: 'Opciones', preview: 'Vista previa', resultado: 'Resultado' }
  const subtitle = step === 'resultado' ? t('Listo') : t('Paso {0} de {1} · {2}', index + 1, steps.length - 1, t(titles[step]))

  return <div className="compound-builder"><div className="compound-builder-content import-members">
    {picker.view}
    <div hidden={picker.isOpen}>
      <Header title={t('Importar socios')} subtitle={subtitle} onClose={close} />
      {loading && !error ? <div className="dim small">{t('Loading…')}</div> : <>
        {index > 0 && step !== 'resultado' && <><Button size="sm" icon="chevronLeft" onClick={back}>{t('Volver')}</Button><div style={{ height: 10 }} /></>}
        {step === 'archivo' && <FileStep file={file} error={error} reading={reading} onPick={pickFile} />}
        {step === 'columnas' && <ColumnsStep file={file} mapping={mapping} setMapping={setMapping} picker={picker.open} problems={problems} desktop={desktop} />}
        {step === 'planes' && <PlansStep plans={planValues} activePlans={activePlans} choices={choices} picker={picker.open} desktop={desktop}
          setChoice={(key, c) => setChoices(cur => ({ ...cur, [key]: c.action === 'create' && cur[key]?.action !== 'create' ? { name: planValues.find(p => p.key === key).value.slice(0, 60), price: null, durationDays: 30, ...c } : c }))} />}
        {step === 'opciones' && <OptionsStep options={options} setOptions={setOptions} methods={methods} showMethod={showMethod} dniEnabled={dniEnabled} />}
        {step === 'preview' && preview && <PreviewStep preview={preview} rows={rows} tab={tab} setTab={setTab} desktop={desktop} />}
        {step === 'resultado' && result && <ResultStep result={result} />}
        {step !== 'archivo' && error && <div className="form-error" role="alert">{error}</div>}
        <div style={{ height: 12 }} />
        <Button variant="primary" disabled={!next.ok} onClick={next.run}>{next.label}</Button>
      </>}
    </div>
  </div></div>
}
