import { useEffect, useState } from 'react'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { fmtDateDMY, fmtPesos } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button, Row, SearchField, SelectRow, Switch } from '../../components/ui.jsx'
import { useDesktop } from './useDesktop.js'
import { STATUS_ORDER, StatusBadge, openMemberBilling, statusLabel } from './billing/common.jsx'
import { PlansSheet } from './billing/PlansSheet.jsx'
import { SettingsSheet } from './billing/SettingsSheet.jsx'

// Tablero de Cuotas (GET /api/admin/billing). Las tarjetas resumen cuentan socios activos y no
// staff (así las calcula el servidor); la lista muestra también a los desactivados, con badge.
// Tocar una tarjeta filtra por ese estado; "Deuda total" filtra a quienes deben.

const DEBT = 'deuda'
const TILE_LABELS = { al_dia: 'Al día', por_vencer: 'Por vencer', vencido: 'Vencidos', bloqueado: 'Bloqueados', sin_plan: 'Sin plan' }

function MemberName({ m }) {
  return <>
    {m.name}
    {m.disabled && <span className="tag nocap" style={{ marginLeft: 6 }}>{t('Inactivo')}</span>}
    {m.admin && <span className="tag acc nocap" style={{ marginLeft: 6 }}>{t('Staff')}</span>}
  </>
}

export default function Cuotas() {
  const openSheet = useUI(s => s.openSheet)
  const desktop = useDesktop()
  const [data, setData] = useState(null)             // { today, settings, summary, members }
  const [plans, setPlans] = useState([])
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('')           // '' | estado | DEBT
  const [planFilter, setPlanFilter] = useState('')   // '' | 'none' | id de plan
  const [search, setSearch] = useState('')
  const [showStaff, setShowStaff] = useState(false)

  const load = () => Promise.all([api('/api/admin/billing'), api('/api/admin/billing/plans')])
    .then(([billing, planList]) => { setData(billing); setPlans(planList.plans || []); setError(null) })
    .catch(e => setError(e.message))
  useEffect(() => { load() }, [])

  const today = data?.today
  const openMember = m => openMemberBilling(openSheet, { userId: m.id, userName: m.name, today, onChanged: load })
  const payGlobal = () => openMemberBilling(openSheet, { startWith: 'pick', members: (data?.members || []).filter(m => showStaff || !m.admin), today, onChanged: load })
  const openPlans = () => openSheet((close, { setOnBack }) => <PlansSheet close={close} setOnBack={setOnBack} onChanged={load} />)
  const openSettings = () => openSheet(close => <SettingsSheet close={close} onChanged={load} />)
  const pickStatus = value => setStatus(cur => cur === value ? '' : value)

  const needle = search.trim().toLocaleLowerCase()
  const members = (data?.members || []).filter(m =>
    (showStaff || !m.admin)
    && (!status || (status === DEBT ? m.debt > 0 : m.status === status))
    && (!planFilter || (planFilter === 'none' ? m.planId == null : m.planId === planFilter))
    && (!needle || m.name.toLocaleLowerCase().includes(needle)))

  const summary = data?.summary
  const tile = (key, label, value) => <button key={key} type="button" className={'tile tappable' + (status === key ? ' on' : '')}
    aria-pressed={status === key} onClick={() => pickStatus(key)}>
    <div className="l">{label}</div><div className="v">{summary ? value : '—'}</div>
  </button>

  return <>
    <div className="hdr">
      <div style={{ flex: 1 }}><h1 style={{ margin: 0 }}>{t('Cuotas')}</h1>
        <div className="sub">{today ? t('Hoy {0}', fmtDateDMY(today)) : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={load} aria-label={t('Refresh')}>↻</button>
    </div>

    <div className="tiles billing-tiles">
      {STATUS_ORDER.map(key => tile(key, t(TILE_LABELS[key]), summary?.[key]))}
      {tile(DEBT, t('Deuda total'), fmtPesos(summary?.deuda_total))}
    </div>

    <div className="billing-actions">
      <Button variant="primary" size="sm" icon="plus" onClick={payGlobal} disabled={!data}>{t('Registrar pago')}</Button>
      <Button variant="tinted" size="sm" onClick={openPlans}>{t('Planes')}</Button>
      <Button variant="tinted" size="sm" onClick={openSettings}>{t('Configuración')}</Button>
    </div>

    <div className="billing-filters">
      <SearchField value={search} onChange={e => setSearch(e.target.value)} onClear={() => setSearch('')}
        placeholder={t('Buscar socio por nombre')} aria-label={t('Buscar socio por nombre')} />
      <div className="chips">
        <button className={'chip nocap' + (!status ? ' on' : '')} onClick={() => setStatus('')}>{t('Todos')}</button>
        {STATUS_ORDER.map(key => <button key={key} className={'chip nocap' + (status === key ? ' on' : '')} onClick={() => pickStatus(key)}>{statusLabel(key)}</button>)}
        <button className={'chip nocap' + (status === DEBT ? ' on' : '')} onClick={() => pickStatus(DEBT)}>{t('Con deuda')}</button>
      </div>
      <div className="sect-b">
        <SelectRow title={t('Plan')} value={planFilter} onChange={setPlanFilter} sheetTitle={t('Filtrar por plan')}
          options={[{ value: '', label: t('Todos') }, { value: 'none', label: t('Sin plan') }, ...plans.map(p => ({ value: p.id, label: p.name + (p.active ? '' : ' · ' + t('inactivo')) }))]} />
        <Row title={t('Mostrar staff')} subtitle={t('El staff no cuenta en el resumen')}>
          <Switch checked={showStaff} onChange={setShowStaff} />
        </Row>
      </div>
    </div>

    {error && <div className="form-error" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
    {!data ? <div className="dim small">{t('Loading…')}</div>
      : !members.length ? <div className="empty">{t('Ningún socio coincide con estos filtros.')}</div>
      : desktop ? <div className="billing-table-wrap">
        <table className="billing-table">
          <thead><tr>
            <th>{t('Socio')}</th><th>{t('Plan')}</th><th>{t('Vence')}</th><th>{t('Estado')}</th><th className="num">{t('Deuda')}</th><th />
          </tr></thead>
          <tbody>
            {members.map(m => <tr key={m.id} onClick={() => openMember(m)}>
              <td><MemberName m={m} /></td>
              <td>{m.planName || <span className="dim">{t('Sin plan')}</span>}</td>
              <td className="num" style={{ textAlign: 'left' }}>{m.dueDate ? fmtDateDMY(m.dueDate) : '—'}</td>
              <td><StatusBadge status={m.status} /></td>
              <td className="num">{m.debt > 0 ? fmtPesos(m.debt) : '—'}</td>
              <td className="num"><Button size="sm" variant="tinted" onClick={e => { e.stopPropagation(); openMember(m) }}>{t('Ver ficha')}</Button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      : <div className="list">
        {members.map(m => <div key={m.id} className="item" onClick={() => openMember(m)} style={m.disabled ? { opacity: .55 } : null}>
          <div className="grow">
            <div className="tt"><MemberName m={m} /></div>
            <div className="ss">{[m.planName || t('Sin plan'), m.dueDate && t('Vence el {0}', fmtDateDMY(m.dueDate))].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="billing-side">
            <StatusBadge status={m.status} />
            {m.debt > 0 && <span className="small muted">{fmtPesos(m.debt)}</span>}
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>)}
      </div>}
  </>
}
