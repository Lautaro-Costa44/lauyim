// Tarjeta "Suplementos" en Nutrición (spec, "Vista en Nutrición"): lo que toca hoy agrupado por momento,
// con un check por dosis, la racha y la cafeína del día. Entre Peso corporal y Resumen nutricional.
import { Fragment, useEffect } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { useSupplements, loadSupplements, addLog, removeLog, noticeAccepted } from '../../store/useSupplements.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { todayISO } from '../../lib/format.js'
import { fichaById, CAFFEINE_SOURCES } from '../../lib/suplementos-data.js'
import { isTrainingDay, isDueOn, takenOn, streakOf, groupBySlot, doseLabel, perTake, itemName, caffeineTotal, isOverCaffeine, overDose } from '../../lib/suplementos.js'
import { Button, Check } from '../ui.jsx'
import Icon from '../Icon.jsx'
import { openNotice, withNotice } from './AvisoInicial.jsx'

const open = (mod, fn, ...args) => withNotice(() => import(`./${mod}.jsx`).then(m => m[fn](...args)))
export const openGuide = id => open('GuiaSheet', 'openGuide', id)
export const openCaffeine = () => open('CafeinaSheet', 'openCaffeine')
export const openMine = () => open('MisSuplementos', 'openMine')

// Mate y café suman con un toque (los más comunes); cápsula y "Otra" piden los mg en la hoja.
const ONE_TAP = ['mate', 'cafe']
export function CaffeineToday({ items, logs, today, onError }) {
  const total = caffeineTotal(logs, items, today)
  const over = isOverCaffeine(total)
  const count = id => logs.filter(l => l.date === today && l.source === id).length
  const tap = s => withNotice(() => addLog({ source: s.id, date: today, amount: s.mg }).catch(onError))
  return <div className="supp-caffeine">
    <div className="row between"><div className="supp-sec">{t('Cafeína del día')}</div>
      <button type="button" className="link" onClick={openCaffeine}>{t('Ver detalle ›')}</button></div>
    <div className="row"><b>≈ {total} mg</b><span className="small dim grow">{t('de 400 · estimado')}</span></div>
    <div className={'supp-bar' + (over ? ' over' : '')}><i style={{ width: Math.min(100, total / 4) + '%' }} /></div>
    <div className="chips supp-quick">
      {ONE_TAP.map(id => CAFFEINE_SOURCES.find(s => s.id === id)).map(s => <button key={s.id} type="button" className="chip nocap" onClick={() => tap(s)}
        aria-label={t('Sumar {0}', t(s.id === 'mate' ? 'medio termo de mate' : 'un café'))}>
        {s.emoji} {t(s.label)}{count(s.id) > 0 && <span className="supp-chip-n">×{count(s.id)}</span>}</button>)}
      <button type="button" className="chip nocap" onClick={openCaffeine}>💊 {t('Cápsula')}</button>
      <button type="button" className="chip nocap" onClick={openCaffeine} aria-label={t('Otra cafeína')}>＋ {t('Otra')}</button>
    </div>
    {over && <div className="supp-warn">{t('Hoy vas {0} mg: más de lo recomendado para un día. Si te cuesta dormir, cortá la cafeína unas 6 h antes.', total)}</div>}
  </div>
}

function TakeButtons({ item, taken, onAdd, onRemove }) {
  const name = itemName(item)
  if ((item.doses || 1) === 1) return <Check checked={taken > 0} onChange={v => v ? onAdd() : onRemove()} aria-label={t('Marcar {0}', name)} />
  return <div className="supp-dots">{Array.from({ length: item.doses }, (_, i) => <button key={i} type="button" className={'supp-dot' + (i < taken ? ' on' : '')}
    aria-label={t('Dosis {0} de {1}', i + 1, name)} onClick={() => i < taken ? onRemove() : onAdd()} />)}</div>
}

export default function SuplementosCard() {
  const S = useStore(s => s.S)
  const off = useStore(s => s.config?.supplements_enabled === false)
  const st = useSupplements()
  useEffect(() => { loadSupplements() }, [])
  if (off || !st.loaded || !st.enabled) return null
  const today = st.today || todayISO()
  const trainingDayOf = iso => isTrainingDay(S, iso)
  const toast = e => useUI.getState().toast(errorText(e, t('No se pudo guardar. Probá de nuevo.')))
  const header = <h2>{t('Suplementos')}</h2>

  if (!noticeAccepted(st)) return <div className="card supp-card">
    {header}
    <div className="supp-lock supp-lock-row"><Icon name="lock" /><span>{t('Para ver la guía y registrar suplementos, leé y aceptá el aviso.')}</span></div>
    <Button variant="primary" onClick={() => openNotice()}>{t('Leer el aviso')}</Button>
  </div>

  if (st.adult === 'minor') return <div className="card supp-card">
    {header}
    <div className="small dim">{t('La guía es solo informativa: no recomendamos suplementos a menores de 18 sin supervisión profesional.')}</div>
    <Button onClick={() => openGuide(null)}>{t('Ver la guía')}</Button>
  </div>

  const due = st.items.filter(i => isDueOn(i, today, trainingDayOf(today)))
  const totalDoses = due.reduce((n, i) => n + (i.doses || 1), 0)
  const doneDoses = due.reduce((n, i) => n + Math.min(i.doses || 1, takenOn(st.logs, i.id, today)), 0)
  const add = item => addLog({ itemId: item.id, date: today, amount: perTake(item) }).catch(toast)
  const remove = item => { const last = st.logs.filter(l => l.itemId === item.id && l.date === today).at(-1); if (last) removeLog(last.id).catch(toast) }
  const markAll = () => { for (const i of due) for (let k = takenOn(st.logs, i.id, today); k < (i.doses || 1); k++) add(i) }
  // Para agregar se elige en la guía: no hay otro botón de "Agregar".
  const footer = <div className="supp-actions">
    <button type="button" className="link" onClick={() => openGuide(null)}>📖 {t('Guía')}</button>
    <button type="button" className="link" onClick={openMine}>{t('Mis suplementos')}</button>
  </div>
  const caffeine = <CaffeineToday items={st.items} logs={st.logs} today={today} onError={toast} />

  if (!st.items.some(i => i.status === 'active')) return <div className="card supp-card">
    {header}
    <div className="small dim">{t('¿Tomás suplementos? Mirá qué dice la ciencia: qué funciona, cuánto y cómo prepararlo.')}</div>
    <Button variant="primary" onClick={() => openGuide(null)}>📖 {t('Ver la guía')}</Button>
    <div className="small dim supp-hint">{t('Para agregar un suplemento, elegilo en la guía.')}</div>
    {caffeine}
  </div>

  return <div className="card supp-card">
    <div className="row between">
      <div>{header}{totalDoses > 0 && <div className="small dim">{t('Hoy: {0} de {1} dosis', doneDoses, totalDoses)}</div>}</div>
      {doneDoses < totalDoses && <button type="button" className="link" onClick={markAll}>{t('Marcar todos')}</button>}
    </div>
    <div className="supp-card-cols">
      <div>
        {due.length === 0 && <div className="small dim supp-none">{t('Hoy no toca ningún suplemento.')}</div>}
        {groupBySlot(due).map(g => <div key={g.slot.id}>
          <div className="supp-sec">{t(g.slot.label)}</div>
          {g.items.map(item => {
            const taken = takenOn(st.logs, item.id, today)
            const streak = streakOf(item, st.logs, today, trainingDayOf)
            return <Fragment key={item.id}><div className="supp-row">
              <div className="grow"><b>{itemName(item)}</b>{fichaById(item.catalogId)?.level === 'indicacion' && <span className="supp-pill">{t('indicación')}</span>}
                <div className="small dim">{doseLabel(item)}</div></div>
              {streak >= 2 && <span className="supp-streak">🔥 {streak}</span>}
              <TakeButtons item={item} taken={taken} onAdd={() => add(item)} onRemove={() => remove(item)} />
            </div>
            {overDose(item, st.logs, today) != null && <div className="supp-warn">{t('Hoy marcaste {0} {1}: más de lo recomendado para un día.', overDose(item, st.logs, today), item.unit)}</div>}</Fragment>
          })}
        </div>)}
      </div>
      {caffeine}
    </div>
    {footer}
  </div>
}
