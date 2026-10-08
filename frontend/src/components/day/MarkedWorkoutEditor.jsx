// Cargar series de un día marcado (la hoja del día y el detalle de un marcado). Celular: acordeón
// a pantalla completa, un ejercicio abierto a la vez; abrir uno lo sube arriba de todo para que su
// tabla quede sobre el teclado. Desde 700px: panel centrado con lista + detalle. Nada es
// obligatorio: un ejercicio sin series no se guarda, y guardar todo vacío es marcar el día.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t, exerciseNameFor } from '../../lib/i18n.js'
import { exOr } from '../../lib/exercises.js'
import { fmtDate, uid } from '../../lib/format.js'
import { defaultConfig, effortOf, lastEntryFor, isBw, setLabel, EFFORT } from '../../lib/history.js'
import { buildMarkedWorkout, columnsFor, itemSummary, markedDraft, markedRowOf, modeTag, putWorkout } from '../../lib/marked-workout.js'
import { Button } from '../ui.jsx'
import Icon from '../Icon.jsx'

// El mismo corte que el panel centrado (Modals.jsx).
const WIDE = '(min-width: 700px)'
const isWide = () => !!window.matchMedia?.(WIDE).matches
function useWide() {
  const [wide, setWide] = useState(isWide)
  useEffect(() => {
    const mql = window.matchMedia?.(WIDE)
    if (!mql) return
    const on = () => setWide(mql.matches)
    mql.addEventListener?.('change', on)
    return () => mql.removeEventListener?.('change', on)
  }, [])
  return wide
}

const HEAD = { w: 'kg', r: 'reps', sec: 'seg', min: 'min', speed: 'km/h' }
const DECIMAL = new Set(['w', 'speed', 'rir', 'rpe'])
const nameOf = id => exerciseNameFor(exOr(id))
const emptyRows = n => Array.from({ length: Math.max(1, n || 1) }, () => ({}))
const newItem = id => { const cfg = { ...defaultConfig(id), id }; return { key: uid(), id, cfg, rows: emptyRows(cfg.sets) } }
// sheets.jsx importa este archivo (detalle de un marcado): la biblioteca se trae al usarla. Al
// elegir se cierra, como al reemplazar un ejercicio en el entreno en vivo (Workout.jsx).
const pickExercise = onPick => import('../../sheets.jsx').then(({ exercisePicker }) => {
  const picker = exercisePicker(ex => { picker?.close(); onPick(ex) })
})

export default function MarkedWorkoutEditor({ iso, routine = null, workout = null, close }) {
  const st = useStore(s => s.S)
  const wide = useWide()
  const effort = effortOf(st)
  const effortHd = EFFORT[effort]?.hd
  const [initial] = useState(() => { const draft = markedDraft({ routine, workout }); return { draft, open: isWide() ? draft[0]?.key ?? null : null } })
  const [items, setItems] = useState(initial.draft)
  const [openKey, setOpenKey] = useState(initial.open)
  const [confirm, setConfirm] = useState(null)   // { key, type: 'remove' } | { key, type: 'swap', to }
  const [typing, setTyping] = useState(false)
  const listRef = useRef(null)
  const name = workout?.name || routine?.name || t('Freestyle')
  // "La última vez" sin el marcado que se está editando: si no, se lee a sí mismo.
  const history = workout ? { ...st, workouts: st.workouts.filter(w => w.id !== workout.id) } : st

  const patch = (key, fn) => setItems(list => list.map(it => (it.key === key ? fn(it) : it)))
  const setRows = (key, fn) => patch(key, it => ({ ...it, rows: fn(it.rows) }))
  const open = key => {
    setConfirm(null)
    const next = !wide && openKey === key ? null : key
    setOpenKey(next)
    if (next && !wide) requestAnimationFrame(() => listRef.current?.querySelector(`[data-key="${next}"]`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }))
  }
  const remove = key => {
    const rest = items.filter(it => it.key !== key)
    setItems(rest)
    setConfirm(null)
    if (openKey === key) setOpenKey(wide ? rest[0]?.key ?? null : null)
  }
  const swap = (key, to) => {
    patch(key, it => ({ ...newItem(to.id), key, rows: emptyRows(it.rows.length) }))
    setConfirm(null)
  }
  const askSwap = it => pickExercise(ex => { if (ex.id !== it.id) setConfirm({ key: it.key, type: 'swap', to: ex }) })
  const add = () => pickExercise(ex => { const it = newItem(ex.id); setItems(list => [...list, it]); open(it.key) })
  const save = () => {
    const w = buildMarkedWorkout(iso, { routine, routineId: workout ? workout.routineId ?? null : undefined, name, items, effort },
      { id: workout?.id || uid(), start: workout?.start })
    useStore.getState().update(s => { putWorkout(s.workouts, w) })
    close()
    useUI.getState().toast(workout ? t('Series guardadas') : t('Marcado como entrenado'))
  }
  // Enter: la celda siguiente (kg → reps → esfuerzo → serie siguiente); en la última, cerrar el teclado.
  const onKey = e => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const all = [...e.currentTarget.closest('.mwe-table').querySelectorAll('input')]
    const next = all[all.indexOf(e.currentTarget) + 1]
    if (next) next.focus(); else e.currentTarget.blur()
  }

  const table = it => {
    const cols = columnsFor(it.cfg, effort)
    const last = lastEntryFor(history, it.id)
    const total = it.rows.length * cols.length
    const head = f => (f === effort ? effortHd : f === 'w' && cols.includes('r') && isBw(it.cfg) ? '+kg' : HEAD[f])
    return <div className="mwe-table" style={{ '--cols': cols.length }}>
      {last && <div className="mwe-last">{t('Última vez: {0}', last.sets.map(s => setLabel(it.id, s, it.cfg)).join(', '))}</div>}
      <div className="mwe-tr"><span />{cols.map(f => <span key={f} className="mwe-th">{head(f)}</span>)}<span /></div>
      {it.rows.map((row, i) => <div key={i} className="mwe-tr">
        <span className="mwe-n">{i + 1}</span>
        {cols.map((f, j) => <input key={f} className="input mwe-cell" data-f={f} type="text"
          inputMode={DECIMAL.has(f) ? 'decimal' : 'numeric'} enterKeyHint={i * cols.length + j === total - 1 ? 'done' : 'next'}
          aria-label={t('Serie {0} · {1}', i + 1, head(f))} value={row[f] ?? ''}
          placeholder={last?.sets[i]?.[f] != null ? String(last.sets[i][f]) : ''}
          onChange={e => { const v = e.target.value; setRows(it.key, rows => rows.map((r, k) => (k === i ? { ...r, [f]: v } : r))) }}
          onKeyDown={onKey} />)}
        <button type="button" className="iconbtn mwe-x" aria-label={t('Borrar serie {0}', i + 1)}
          onClick={() => setRows(it.key, rows => rows.filter((_, k) => k !== i))}><Icon name="trash" /></button>
      </div>)}
      <div className="mwe-tools">
        <Button size="sm" variant="plain" icon="plus" onClick={() => setRows(it.key, rows => [...rows, {}])}>{t('Serie')}</Button>
        {last && <Button size="sm" variant="plain" icon="copy" onClick={() => setRows(it.key, () => last.sets.map(markedRowOf))}>{t('Igual que la última vez')}</Button>}
      </div>
    </div>
  }

  const confirmBox = it => {
    if (confirm?.key !== it.key) return null
    const n = itemSummary(it, effort).count
    if (confirm.type === 'remove') {
      const lost = n === 1 ? t('Se pierde la serie que cargaste.') : n > 1 ? t('Se pierden las {0} series que cargaste.', n) : null
      return <div className="mwe-confirm danger" role="alert">
        <b>{t('¿Quitar {0}?', nameOf(it.id))}</b>
        <div className="small muted">{[lost, t('La rutina no cambia.')].filter(Boolean).join(' ')}</div>
        <div className="row"><Button size="sm" onClick={() => setConfirm(null)}>{t('Cancelar')}</Button><Button size="sm" variant="danger" onClick={() => remove(it.key)}>{t('Quitar')}</Button></div>
      </div>
    }
    return <div className="mwe-confirm" role="alert">
      <b>{t('¿Cambiar {0} por {1}?', nameOf(it.id), nameOf(confirm.to.id))}</b>
      <div className="small muted">{n === 1 ? t('La serie que cargaste se borra: era de otro ejercicio.') : n > 1 ? t('Las {0} series que cargaste se borran: eran de otro ejercicio.', n) : t('La rutina no cambia.')}</div>
      <div className="row"><Button size="sm" onClick={() => setConfirm(null)}>{t('Cancelar')}</Button><Button size="sm" variant="primary" onClick={() => swap(it.key, confirm.to)}>{t('Cambiar')}</Button></div>
    </div>
  }

  const actions = it => <>
    <button type="button" className="iconbtn" aria-label={t('Cambiar {0}', nameOf(it.id))} onClick={() => askSwap(it)}><Icon name="reset" /></button>
    <button type="button" className="iconbtn" aria-label={t('Quitar {0}', nameOf(it.id))} onClick={() => setConfirm({ key: it.key, type: 'remove' })}><Icon name="trash" /></button>
  </>

  const row = it => {
    const sum = itemSummary(it, effort)
    const tag = modeTag(it.cfg)
    const isOpen = openKey === it.key
    return <div key={it.key} data-key={it.key} className={'mwe-item' + (isOpen ? ' open' : '')}>
      <div className="mwe-item-head">
        <button type="button" className="mwe-item-main" aria-expanded={isOpen} onClick={() => open(it.key)}>
          <span className="tt capitalize">{nameOf(it.id)}</span>
          {tag && <span className="tag nocap">{t(tag)}</span>}
          <span className={'mwe-sum' + (sum.count ? ' ok' : '')}>{sum.count ? `✓ ${sum.count === 1 ? t('1 serie') : t('{0} series', sum.count)} · ${sum.text}` : t('Sin series')}</span>
        </button>
        {!wide && actions(it)}
      </div>
      {!wide && confirmBox(it)}
      {!wide && isOpen && table(it)}
    </div>
  }

  const current = items.find(it => it.key === openKey)
  return <div className={'mwe' + (wide ? ' wide' : '')}
    onFocus={e => { if (e.target.matches?.('input')) setTyping(true) }}
    onBlur={e => { if (e.target.matches?.('input')) setTyping(false) }}>
    <div className="mwe-head">
      {!wide && <button type="button" className="iconbtn" aria-label={t('Volver')} onClick={close}><Icon name="chevronLeft" /></button>}
      <div className="grow">
        <h3>{name} · {fmtDate(iso)}</h3>
        <div className="small muted">{effortHd ? t('Series opcionales · {0} según tus ajustes', effortHd) : t('Series opcionales')}</div>
      </div>
    </div>
    <div className="mwe-body">
      <div className="mwe-list" ref={listRef}>
        {items.map(row)}
        {!items.length && <div className="empty small">{t('Sin ejercicios. Agregá uno, o guardá así: cuenta para tu racha.')}</div>}
        <Button variant="plain" icon="plus" className="mwe-add" onClick={add}>{t('Agregar ejercicio')}</Button>
      </div>
      {wide && <div className="mwe-detail">{current ? <>
        <div className="mwe-detail-head">
          <b className="grow capitalize">{nameOf(current.id)}</b>
          {actions(current)}
        </div>
        {confirmBox(current)}
        {table(current)}
        <div className="small muted mwe-keys">{t('Tab: celda siguiente · Enter: serie siguiente')}</div>
      </> : <div className="empty small">{t('Elegí un ejercicio de la lista.')}</div>}</div>}
    </div>
    {!wide && <div className="mwe-spacer" aria-hidden="true" />}
    <div className={'mwe-foot' + (typing && !wide ? ' hidden' : '')}>
      {wide && <Button variant="ghost" className="dim" onClick={close}>{t('Cancelar')}</Button>}
      <Button variant="primary" onClick={save}>{t('Guardar entrenamiento')}</Button>
    </div>
  </div>
}

/** Abre el editor: pantalla completa en el celular, panel centrado desde 700px. */
export function markedEditorSheet({ iso, routine = null, workout = null }) {
  // locked: un deslizón no tira lo cargado; atrás del sistema y la X del panel siguen cerrando.
  return useUI.getState().openSheet(close => <MarkedWorkoutEditor iso={iso} routine={routine} workout={workout} close={close} />,
    { kind: 'panel', fullScreen: !isWide(), locked: true, backGesture: true })
}
