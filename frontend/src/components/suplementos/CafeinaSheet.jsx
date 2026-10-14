// Cafeína del día (spec, "Cafeína del día"): cada toque suma un consumo (el mate es ½ termo), con
// "Eliminar último consumo", la lista de hoy y consejos del mate.
import { useState } from 'react'
import { useUI } from '../../store/useUI.js'
import { useSupplements, addLog, removeLog } from '../../store/useSupplements.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { todayISO } from '../../lib/format.js'
import { CAFFEINE_SOURCES, MATE_TIPS } from '../../lib/suplementos-data.js'
import { caffeineTotal, isOverCaffeine, itemName } from '../../lib/suplementos.js'
import { Button, NumberField } from '../ui.jsx'

const hhmm = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

function Cafeina() {
  const st = useSupplements()
  const today = st.today || todayISO()
  const [ask, setAsk] = useState(null)   // 'capsula' | 'preentreno' | 'otro': piden los mg
  const [mg, setMg] = useState(null)
  const toast = e => useUI.getState().toast(errorText(e, t('No se pudo guardar. Probá de nuevo.')))
  const caffeineItems = new Set(st.items.filter(i => i.catalogId === 'cafeina').map(i => i.id))
  const todays = st.logs.filter(l => l.date === today && (l.source || caffeineItems.has(l.itemId))).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  const total = caffeineTotal(st.logs, st.items, today), over = isOverCaffeine(total)
  const src = id => CAFFEINE_SOURCES.find(s => s.id === id)
  const labelOf = l => l.source ? `${src(l.source)?.emoji} ${t(src(l.source)?.label)}` : `💊 ${itemName(st.items.find(i => i.id === l.itemId) || {})}`
  const add = (source, amount) => addLog({ source, date: today, amount }).catch(toast)
  const tap = s => {
    if (s.mg != null) return add(s.id, s.mg)
    setAsk(s.id)
    // Cápsula y pre-entreno: los mg de la última vez (suele ser la misma).
    setMg(s.id === 'otro' ? null : (st.logs.filter(l => l.source === s.id).at(-1)?.amount ?? (s.id === 'capsula' ? 100 : null)))
  }
  const last = todays.at(-1)
  return <div className="supp-caffeine-sheet">
    <h3>{t('Cafeína de hoy')}</h3>
    <div className="row"><b className="supp-big">≈ {total} mg</b><span className="small dim grow">{t('de 400 · estimado')}</span></div>
    <div className={'supp-bar' + (over ? ' over' : '')}><i style={{ width: Math.min(100, total / 4) + '%' }} /></div>
    <div className="small dim">{t('Tocá cada vez que tomás. Se suma solo.')}</div>
    <div className="supp-quick-grid">{CAFFEINE_SOURCES.map(s => {
      const n = todays.filter(l => l.source === s.id).length
      return <button key={s.id} type="button" className="supp-q" onClick={() => tap(s)}>
        {n > 0 && <span className="supp-q-n">×{n}</span>}
        <span className="supp-q-e" aria-hidden="true">{s.emoji}</span>{t(s.label)}
        <span className="small dim">{s.mg != null ? (s.id === 'mate' ? t('~{0} mg por ½ termo', s.mg) : `~${s.mg} mg`) : t(s.unitLabel)}</span>
      </button>
    })}</div>
    {ask && <div className="supp-ask row">
      <span className="small">{ask === 'preentreno' ? t('mg por scoop (de la etiqueta)') : ask === 'capsula' ? t('mg de la cápsula') : 'mg'}</span>
      <NumberField name="supp-mg" value={mg} nullable onChange={setMg} className="input supp-num" />
      <Button size="sm" variant="primary" disabled={!(mg > 0)} onClick={() => { add(ask, mg); setAsk(null) }}>{t('Sumar')}</Button>
    </div>}
    <button type="button" className="supp-undo" disabled={!last} onClick={() => last && removeLog(last.id).catch(toast)}>
      ↶ {t('Eliminar último consumo')}{last && <span className="small dim"> ({labelOf(last)} {hhmm(last.createdAt)})</span>}
    </button>
    {/* Debajo de los botones: si apareciera arriba, correría los botones en medio de los toques. */}
    {over && <div className="supp-warn">{t('Hoy vas {0} mg: más de lo recomendado para un día. Si te cuesta dormir, cortá la cafeína unas 6 h antes.', total)}</div>}
    {todays.length > 0 && <>
      <div className="supp-sec">{t('Consumos de hoy')}</div>
      {todays.slice().reverse().map(l => <div key={l.id} className="supp-row">
        <span className="grow">{labelOf(l)} · {hhmm(l.createdAt)}</span>
        <span className="small dim">~{Math.round(l.amount)} mg</span>
        <button type="button" className="link danger" onClick={() => removeLog(l.id).catch(toast)}>{t('Eliminar')}</button>
      </div>)}
    </>}
    <div className="supp-sec">{t('Sobre el mate')}</div>
    {MATE_TIPS.map(tip => <div key={tip} className="supp-tip">{tip}</div>)}
  </div>
}

export const openCaffeine = () => useUI.getState().openSheet(() => <Cafeina />, { kind: 'panel' })
