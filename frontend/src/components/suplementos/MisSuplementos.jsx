// Mis suplementos (spec, "Seguimiento"): heatmap combinado, y por suplemento racha, cumplimiento de 30
// días, su heatmap y los últimos 7 días para marcar lo que te olvidaste. Archivados con "Volver a tomar".
import { useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { useSupplements, addLog, removeLog, archiveItem } from '../../store/useSupplements.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { todayISO } from '../../lib/format.js'
import { sinceOf, streakOf, adherence30, dayLevel, takenOn, isDueOn, isTrainingDay, canLogDate, addDays, doseLabel, itemName, perTake } from '../../lib/suplementos.js'
import { HeatmapGrid } from '../Heatmap.jsx'
import { Button, Check } from '../ui.jsx'
import Icon from '../Icon.jsx'

const openConfig = (c, id) => import('./ConfigSuplemento.jsx').then(m => m.openConfig(c, id))
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
// "Hoy", "Ayer" o "mié 7/10".
const dayLabel = (iso, today) => iso === today ? t('Hoy') : iso === addDays(today, -1) ? t('Ayer') : `${DIAS[new Date(iso + 'T12:00:00').getDay()]} ${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`

function Detalle({ item, onBack }) {
  const S = useStore(s => s.S)
  const st = useSupplements()
  const today = st.today || todayISO()
  const train = iso => isTrainingDay(S, iso)
  const toast = e => useUI.getState().toast(errorText(e, t('No se pudo guardar. Probá de nuevo.')))
  const streak = streakOf(item, st.logs, today, train), adh = adherence30(item, st.logs, today, train)
  const name = itemName(item)
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, -i)).filter(iso => canLogDate(iso, today) && isDueOn({ ...item, status: 'active', createdAt: addDays(today, -7) }, iso, train(iso)))
  return <div className="supp-detail">
    {onBack && <button type="button" className="link supp-back" onClick={onBack}>‹ {t('Mis suplementos')}</button>}
    <h3>{name}</h3>
    <div className="small dim">{doseLabel(item)}</div>
    <div className="supp-stats"><span>🔥 {t('Racha: {0} días', streak)}</span><span>{adh == null ? t('Sin días todavía') : t('Últimos 30 días: {0} %', adh)}</span></div>
    <HeatmapGrid weeks={52} levelOf={iso => dayLevel(item, st.logs, iso, train)} titleOf={iso => `${iso} · ${takenOn(st.logs, item.id, iso)}/${item.doses || 1}`} legend={[t('Menos'), t('Cumplido')]} />
    {item.status === 'active' && <>
      <div className="supp-sec">{t('Últimos 7 días')}</div>
      {days.map(iso => {
        const taken = takenOn(st.logs, item.id, iso)
        return <div key={iso} className="supp-row">
          <span className="grow">{dayLabel(iso, today)}</span>
          {Array.from({ length: item.doses || 1 }, (_, k) => <Check key={k} checked={k < taken}
            aria-label={(item.doses || 1) === 1 ? t('Marcar {0} el {1}', name.split(' ')[0].toLowerCase(), iso) : t('Toma {0} de {1} el {2}', k + 1, name, iso)}
            onChange={v => v ? addLog({ itemId: item.id, date: iso, amount: perTake(item) }).catch(toast)
              : removeLog(st.logs.filter(l => l.itemId === item.id && l.date === iso).at(-1).id).catch(toast)} />)}
        </div>
      })}
      <Button onClick={() => openConfig(item.catalogId, item.id)}>{t('Configurar')}</Button>
    </>}
  </div>
}

function Mis({ close }) {
  const S = useStore(s => s.S)
  const st = useSupplements()
  const [sel, setSel] = useState(null)
  const today = st.today || todayISO()
  const train = iso => isTrainingDay(S, iso)
  const active = st.items.filter(i => i.status === 'active'), archived = st.items.filter(i => i.status === 'archived')
  const combined = iso => { const due = active.filter(i => isDueOn({ ...i, createdAt: sinceOf(i, st.logs) }, iso, train(iso))); return due.length ? Math.min(...due.map(i => dayLevel(i, st.logs, iso, train))) : 0 }
  const item = st.items.find(i => i.id === sel)
  const toast = e => useUI.getState().toast(errorText(e, t('No se pudo guardar. Probá de nuevo.')))
  return <div className="supp-guide-cols">
    <button type="button" className="iconbtn supp-close" onClick={close} aria-label={t('Cerrar')}><Icon name="xmark" /></button>
    <div className={item ? 'supp-hide-phone' : ''}>
      <h3>{t('Mis suplementos')}</h3>
      {active.length > 0 && <HeatmapGrid weeks={26} levelOf={combined} titleOf={iso => iso} legend={[t('Menos'), t('Cumplido')]} />}
      <div className="supp-sec">{t('Activos')}</div>
      {active.length ? active.map(i => <button key={i.id} type="button" className={'supp-item' + (sel === i.id ? ' sel' : '')} onClick={() => setSel(i.id)}>
        <div className="grow"><b>{itemName(i)}</b><div className="small dim">{doseLabel(i)}</div></div>
        <span className="supp-streak">🔥 {streakOf(i, st.logs, today, train)}</span>
      </button>) : <div className="small dim">{t('Todavía no agregaste suplementos.')}</div>}
      {archived.length > 0 && <>
        <div className="supp-sec">{t('Archivados')}</div>
        {archived.map(i => <div key={i.id} className="supp-item">
          <button type="button" className="grow link" onClick={() => setSel(i.id)}><b>{itemName(i)}</b></button>
          <Button size="sm" onClick={() => archiveItem(i.id, false).catch(toast)}>{t('Volver a tomar')}</Button>
        </div>)}
      </>}
    </div>
    <div className={item ? '' : 'supp-hide-phone'}>{item ? <Detalle item={item} onBack={() => setSel(null)} /> : <div className="dim supp-empty-pc">{t('Elegí un suplemento para ver su historial.')}</div>}</div>
  </div>
}

export const openMine = () => useUI.getState().openSheet(close => <Mis close={close} />, { fullScreen: true })
