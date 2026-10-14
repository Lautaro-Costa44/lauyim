// Suplementos de un socio para el staff (docs/superpowers/specs/2026-10-13-suplementos-etapa-2-design.md):
// en Administrar → Nutrición, con "Ver suplementos". Activos con racha y cumplimiento, heatmap combinado,
// días con exceso de los últimos 30 y, con "Deshabilitar suplementos", el interruptor con motivo.
// No muestra si aceptó el aviso (si tiene algo cargado, lo aceptó).
import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { todayISO } from '../../lib/format.js'
import { can } from '../../lib/permissions.js'
import { SLOTS } from '../../lib/suplementos-data.js'
import { sinceOf, streakOf, adherence30, dayLevel, isDueOn, doseLabel, itemName, proteinPerTake, excessDays, excessDayCount } from '../../lib/suplementos.js'
import { HeatmapGrid } from '../Heatmap.jsx'
import { Button, Row, Section, Switch } from '../ui.jsx'

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const dayShort = iso => `${DIAS[new Date(iso + 'T12:00:00').getDay()]} ${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`
const num = n => String(n).replace('.', ',')
const UNIT = { g: 'g', mg: 'mg', ml: 'ml', caps: 'cáps.', ui: 'UI', dosis: 'dosis' }

// Día de entreno del socio con su plan (misma regla que isTrainingDay del cliente y del servidor).
export const trainingDayFromPlan = plan => iso => {
  const ov = plan?.dayPlan?.[iso]
  const trained = (plan?.workoutDates || []).includes(iso)
  if (ov === 'rest' || (ov && typeof ov === 'object' && ['descanso', 'completado'].includes(ov.estado))) return trained
  const planned = (ov && typeof ov === 'object' && ov.estado === 'rutina' && ov.rutinaId) || (typeof ov === 'string' && ov)
    || plan?.week?.[new Date(iso + 'T12:00:00').getDay()]
  return !!planned || trained
}

// Confirmación al deshabilitar: motivo opcional (lo ve el socio, máx. 120).
function DisableSheet({ userName, onConfirm, close }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return <div className="supp-disable">
    <h3>{t('¿Deshabilitar suplementos para {0}?', userName)}</h3>
    <p className="small dim">{t('No va a ver la guía ni el seguimiento, y los recordatorios dejan de salir. No se borra nada: al volver a habilitarlo, todo sigue como estaba.')}</p>
    <label className="supp-field"><span className="supp-label">{t('Motivo (opcional, lo ve el socio)')}</span>
      <input className="input" name="supp-reason" maxLength={120} value={reason} placeholder={t('Ej.: por indicación médica')} onChange={e => setReason(e.target.value)} /></label>
    <Button variant="danger" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(reason.trim()); setBusy(false); close() }}>{t('Deshabilitar')}</Button>
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancelar')}</Button>
  </div>
}

export default function AdminSupplementsCard({ userId, userName }) {
  const me = useStore(s => s.user)
  const [data, setData] = useState(null)
  const toast = msg => useUI.getState().toast(msg)
  useEffect(() => {
    api('/api/admin/users/' + encodeURIComponent(userId) + '/supplements').then(setData).catch(e => toast(errorText(e, t('Failed to load'))))
  }, [userId])
  if (!data?.enabled) return null
  const canManage = can(me, 'supplements.manage')
  const today = todayISO()
  const train = trainingDayFromPlan(data.plan)
  const active = data.items.filter(i => i.status === 'active')
  const archived = data.items.filter(i => i.status === 'archived').length
  const excess = excessDays({ items: data.items, logs: data.logs, caffeine: data.caffeine, today })
  const nExcess = excessDayCount(excess)
  const combined = iso => { const due = active.filter(i => isDueOn({ ...i, createdAt: sinceOf(i, data.logs) }, iso, train(iso))); return due.length ? Math.min(...due.map(i => dayLevel(i, data.logs, iso, train))) : 0 }

  const setAccess = async (enabled, reason = '') => {
    try {
      const r = await api('/api/admin/users/' + encodeURIComponent(userId) + '/supplements/access', { method: 'PUT', body: JSON.stringify(enabled ? { enabled } : { enabled, reason }) })
      setData(d => ({ ...d, access: r.access }))
      toast(enabled ? t('Suplementos habilitados') : t('Suplementos deshabilitados'))
    } catch (e) { toast(errorText(e, t('No se pudo guardar. Probá de nuevo.'))) }
  }
  const toggle = v => v ? setAccess(true)
    : useUI.getState().openSheet(close => <DisableSheet userName={userName} close={close} onConfirm={reason => setAccess(false, reason)} />, { overlay: true })

  // Mismo estilo que el resto de Administrar → Nutrición: secciones con título grande y filas. El
  // interruptor es la primera fila.
  const big = txt => <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--label)' }}>{txt}</span>
  const accessSubtitle = data.access.disabled
    ? t('Deshabilitado para este socio') + (data.access.reason ? ' · ' + data.access.reason : '')
    : t('Habilitado para este socio')
  return <div className="supp-admin">
    <Section title={big(t('Suplementos'))}>
      <Row title={t('Guía y seguimiento')} subtitle={accessSubtitle}>
        {canManage && <Switch checked={!data.access.disabled} onChange={toggle} label={t('Guía y seguimiento')} />}
      </Row>
      {nExcess > 0 && <Row title={<span className="supp-warnb">⚠️ {nExcess === 1 ? t('1 día con exceso') : t('{0} días con exceso', nExcess)}</span>} subtitle={t('En los últimos 30 días')} />}
      {data.items.length === 0 && <Row title={t('No registra suplementos.')} />}
      {active.map(i => {
        const adh = adherence30(i, data.logs, today, train)
        const slot = SLOTS.find(s => s.id === (i.slot || 'any'))
        return <Row key={i.id} title={<>{itemName(i)} <span className="supp-streak">🔥 {streakOf(i, data.logs, today, train)}</span></>}
          subtitle={`${doseLabel(i)}${proteinPerTake(i) != null ? ` · ${num(proteinPerTake(i))} g ${t('de proteína')}` : ''} · ${t(slot?.label || '').toLowerCase()}`}
          value={adh == null ? '—' : `${adh} %`} />
      })}
      {data.items.length > 0 && <div className="small dim supp-foot">{t('% = cumplimiento de los últimos 30 días')}{archived > 0 && ` · ${archived === 1 ? t('1 archivado') : t('{0} archivados', archived)}`}</div>}
    </Section>
    {data.items.length > 0 && <Section title={big(t('Últimas 26 semanas'))}>
      <div className="supp-admin-heat"><HeatmapGrid weeks={26} levelOf={combined} titleOf={iso => iso} legend={[t('Menos'), t('Cumplido')]} /></div>
    </Section>}
    {excess.length > 0 && <Section title={big(t('Días con exceso (últimos 30)'))}>
      {excess.map((r, k) => <Row key={k} title={`${dayShort(r.date)} · ${r.name}`} value={`${num(r.amount)} ${UNIT[r.unit] || r.unit} / ${num(r.max)}`} className="supp-ex" />)}
    </Section>}
  </div>
}
