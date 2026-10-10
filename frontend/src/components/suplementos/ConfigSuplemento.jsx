// Alta y edición de un suplemento (spec, "Alta y configuración"): un solo formulario con lo sugerido ya
// cargado. Creatina nueva: cartel de fase de carga. Proteína: macros por scoop desde la etiqueta.
import { useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { useSupplements, saveItem, archiveItem, deleteItem, newId } from '../../store/useSupplements.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { lastBW } from '../../lib/history.js'
import { fichaById, SLOTS, UNITS } from '../../lib/suplementos-data.js'
import { caffeineRange, doseLabel, itemName, proteinPerTake } from '../../lib/suplementos.js'
import { Button, NumberField, Segmented, Switch, TextField } from '../ui.jsx'

const openGuide = id => import('./GuiaSheet.jsx').then(m => m.openGuide(id))
// Horas sugeridas para los recordatorios según en cuántas dosis se separa.
const DEFAULT_TIMES = { 1: ['09:00'], 2: ['09:00', '20:00'], 3: ['09:00', '14:00', '20:00'], 4: ['08:00', '12:00', '16:00', '20:00'],
  5: ['08:00', '11:00', '14:00', '17:00', '20:00'], 6: ['08:00', '10:30', '13:00', '15:30', '18:00', '20:30'] }
const fitTimes = (times, n) => Array.from({ length: n }, (_, i) => times[i] || DEFAULT_TIMES[n][i])

function Config({ catalogId, itemId, close }) {
  const S = useStore(s => s.S)
  const items = useSupplements(s => s.items)
  const f = catalogId ? fichaById(catalogId) : null
  const editing = itemId ? items.find(i => i.id === itemId) : null
  const weight = lastBW(S)?.w
  const range = catalogId === 'cafeina' ? caffeineRange(weight) : null
  const first = catalogId === 'creatina' && !items.some(i => i.catalogId === 'creatina')
  const [name, setName] = useState(editing?.name || '')
  const [dose, setDose] = useState(editing?.dose ?? (catalogId === 'cafeina' ? (range?.min || 100) : f?.dose?.suggested ?? null))
  const [unit, setUnit] = useState(editing?.unit || f?.unit || 'g')
  const [scoopG, setScoopG] = useState(editing?.scoopG ?? null)
  const [doses, setDoses] = useState(editing?.doses || f?.doses || 1)
  const [slot, setSlot] = useState(editing?.slot || f?.slot || 'any')
  const [days, setDays] = useState(editing?.days || f?.days || 'daily')
  const [remind, setRemind] = useState((editing?.reminderTimes || []).length > 0)
  const [times, setTimes] = useState(fitTimes(editing?.reminderTimes || [], editing?.doses || f?.doses || 1))
  const [macros, setMacros] = useState(editing?.meta?.macros || f?.macrosPerScoop || null)
  const [busy, setBusy] = useState(false)
  const lo = range ? range.min : f?.dose?.min, hi = range ? range.max : f?.dose?.max
  const outOfRange = dose != null && lo != null && (dose < lo || dose > hi)
  const draft = { id: editing?.id || 'preview', catalogId, name: catalogId ? null : name.trim(), dose, unit, scoopG: unit === 'g' ? scoopG : null, doses, slot, days, reminderTimes: remind ? fitTimes(times, doses) : [],
    meta: catalogId === 'proteina' && macros ? { macros: { proteina: macros.proteina, calorias: macros.calorias, carbos: macros.carbos, grasas: macros.grasas } } : null }
  const title = (editing ? t('Editar {0}', itemName(draft)) : t('Agregar {0}', f ? f.name.toLowerCase() : t('un suplemento')))
  const toast = msg => useUI.getState().toast(msg)
  const save = async () => {
    setBusy(true)
    try { await saveItem({ ...draft, id: editing?.id || newId() }); close(); toast(editing ? t('Guardado') : t('Agregado')) }
    catch (e) { toast(errorText(e, t('No se pudo guardar. Probá de nuevo.'))) }
    setBusy(false)
  }
  // Al prender un recordatorio sin avisos activos: el pedido en contexto de siempre (NotifAskSheet).
  const toggleRemind = v => { setRemind(v); if (v) import('../notif/NotifAskSheet.jsx').then(m => m.maybeAskNotif('supplement')).catch(() => {}) }
  const archive = async () => { try { await archiveItem(editing.id, true); close(); toast(t('Lo archivamos. Tu historial queda guardado.')) } catch (e) { toast(errorText(e, t('No se pudo guardar. Probá de nuevo.'))) } }
  const remove = () => import('../../sheets.jsx').then(({ confirmSheet }) => confirmSheet({
    title: t('¿Eliminar {0}?', itemName(editing)), message: t('Se borra también su historial. No se puede deshacer.'), confirmText: t('Eliminar'), danger: true,
    onConfirm: async () => { try { await deleteItem(editing.id); close(); toast(t('Eliminado')) } catch (e) { toast(errorText(e, t('No se pudo eliminar'))) } }
  }))
  const field = (label, children, hint) => <div className="supp-field"><div className="supp-label">{t(label)}</div>{children}{hint && <div className="small dim">{hint}</div>}</div>
  const fixedUnit = f && f.level !== 'indicacion'
  return <div className="supp-config">
    <h3>{title}</h3>
    {first && <div className="supp-lock">⚡ <b>{t('¿Recién empezás?')}</b> {t('Mirá la fase de carga en la guía: saturás en alrededor de 1 semana en vez de 3 a 4. Es opcional.')} <button type="button" className="link" onClick={() => openGuide('creatina')}>{t('Ver en la guía ›')}</button></div>}
    <div className="supp-form-cols">
      <div>
        {!catalogId && field('Nombre', <TextField name="supp-name" maxLength={40} value={name} onChange={e => setName(e.target.value)} placeholder={t('Ej.: ashwagandha')} />)}
        {field('Cantidad por día', <div className="row">
          <NumberField name="supp-dose" value={dose} nullable onChange={setDose} className="input supp-num" />
          {fixedUnit ? <span className="dim">{UNITS.find(u => u.id === unit)?.label}</span>
            : <div className="chips">{UNITS.map(u => <button key={u.id} type="button" className={'chip nocap' + (unit === u.id ? ' on' : '')} onClick={() => setUnit(u.id)}>{u.label}</button>)}</div>}
        </div>, f?.level === 'indicacion' ? t('La que te indicó tu profesional') : lo != null ? `${t('sugerido')} ${lo}–${hi} ${UNITS.find(u => u.id === unit)?.label}` : null)}
        {outOfRange && <div className="supp-warn">{t('Está fuera de lo sugerido en la guía.')}</div>}
        {unit === 'g' && field('Mi scoop', <div className="row"><span className="dim">{t('1 scoop =')}</span><NumberField name="supp-scoop" value={scoopG} nullable onChange={setScoopG} className="input supp-num" /><span className="dim">g</span></div>,
          '📦 ' + t('Mirá la etiqueta de tu marca: dice cuántos gramos trae el scoop. Sin scoop, dejalo vacío.'))}
        {catalogId === 'proteina' && macros && field('Por scoop (de la etiqueta)', <div className="supp-macros">
          {[['proteina', 'Proteína (g)'], ['calorias', 'Calorías'], ['carbos', 'Carbos (g)'], ['grasas', 'Grasas (g)']].map(([k, l]) =>
            <label key={k}><span className="small dim">{t(l)}</span><NumberField name={'supp-' + k} className="input" value={macros[k]} onChange={v => setMacros(m => ({ ...m, [k]: v }))} /></label>)}
        </div>)}
      </div>
      <div>
        {field('Separar en dosis', <Segmented options={[1, 2, 3, 4, 5, 6].map(n => ({ value: n, label: String(n) }))} value={doses} onChange={n => { setDoses(n); setTimes(ts => fitTimes(ts, n)) }} />,
          t('En cuántas veces por día la tomás.'))}
        {field('Cuándo', <div className="chips">{SLOTS.map(s => <button key={s.id} type="button" className={'chip nocap' + (slot === s.id ? ' on' : '')} onClick={() => setSlot(s.id)}>{t(s.label)}</button>)}</div>)}
        {field('Qué días', <Segmented options={[{ value: 'daily', label: t('Todos los días') }, { value: 'training', label: t('Solo de entreno') }]} value={days} onChange={setDays} />,
          catalogId === 'creatina' ? t('La creatina va todos los días, también los de descanso.') : null)}
        {field(doses > 1 ? 'Recordatorios' : 'Recordatorio', <>
          <Switch checked={remind} onChange={toggleRemind} label={t('Recordatorio')} />
          {/* Uno por dosis, cada uno con su hora. */}
          {remind && <div className="supp-times">{fitTimes(times, doses).map((tm, i) => <label key={i} className="supp-time-row">
            <span className="small dim">{doses > 1 ? t('Dosis {0}', i + 1) : t('Hora')}</span>
            <input className="input supp-time" type="time" name={'supp-time-' + i} value={tm}
              onChange={e => { const v = e.target.value || DEFAULT_TIMES[doses][i]; setTimes(ts => fitTimes(ts, doses).map((x, j) => j === i ? v : x)) }} />
          </label>)}</div>}
        </>)}
      </div>
    </div>
    <div className="small dim supp-preview">{t('En la tarjeta vas a ver:')} <b>{doseLabel(draft)}{proteinPerTake(draft) != null && ` · ${String(proteinPerTake(draft)).replace('.', ',')} g ${t('de proteína')}`}</b></div>
    {catalogId === 'proteina' && <div className="small dim supp-preview">{t('Se suma en Nutrición como "Extra" (proteína, calorías, carbos y grasas del scoop).')}</div>}
    <Button variant="primary" disabled={busy || (!catalogId && !name.trim()) || !(dose > 0) && f?.level !== 'indicacion'} onClick={save}>{editing ? t('Guardar') : t('Agregar')}</Button>
    {editing && <div className="supp-edit-actions">
      <Button variant="ghost" onClick={archive}>{t('Dejar de tomar')}</Button>
      <Button variant="ghost" className="danger" onClick={remove}>{t('Eliminar')}</Button>
    </div>}
  </div>
}

export const openConfig = (catalogId, itemId) => useUI.getState().openSheet(close => <Config catalogId={catalogId} itemId={itemId} close={close} />, { kind: 'panel' })
