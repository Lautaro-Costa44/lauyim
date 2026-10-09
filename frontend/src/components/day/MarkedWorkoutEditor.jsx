// Cargar series de un día marcado, o corregir las de un entreno ya hecho con la app (la hoja del
// día y el detalle del entreno). Celular: acordeón a pantalla completa, un ejercicio abierto a la
// vez; abrir uno lo sube arriba de todo para que su tabla quede sobre el teclado. Desde 700px: panel
// centrado con lista + detalle. En un marcado nada es obligatorio: un ejercicio sin series no se
// guarda, y guardar todo vacío es marcar el día.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t, exerciseNameFor } from '../../lib/i18n.js'
import { exOr } from '../../lib/exercises.js'
import { fmtDate, uid, workoutTime } from '../../lib/format.js'
import { dateLocale } from '../../lib/i18n-core.js'
import { defaultConfig, effortOf, lastEntryFor, isBw, setLabel, EFFORT } from '../../lib/history.js'
import { buildEditedWorkout, buildMarkedWorkout, columnsFor, emptyRows, itemSummary, markedDraft, markedItem, markedRowOf, modeTag, putWorkout } from '../../lib/marked-workout.js'
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

// El peso va en la unidad del perfil (kg o lb), como en el entreno.
const HEAD = { r: 'reps', sec: 'seg', min: 'min', speed: 'km/h' }
const DECIMAL = new Set(['w', 'speed', 'rir', 'rpe'])
const nameOf = id => exerciseNameFor(exOr(id))
const newItem = id => markedItem(id, defaultConfig(id))
// Un número como se escribe en el idioma de la app (62,5): solo el separador decimal. fmtNum no
// sirve acá: agrega separador de miles (1.200) y eso, leído de vuelta, sería 1,2.
const decimalSep = () => (1.5).toLocaleString(dateLocale()).charAt(1)
const asTyped = v => String(v).replace('.', decimalSep())
// sheets.jsx importa este archivo (detalle de un entreno): la biblioteca y el diálogo de confirmar
// se traen al usarlos. La biblioteca se cierra al elegir, como al reemplazar un ejercicio mientras
// se entrena (Workout.jsx).
const pickExercise = onPick => import('../../sheets.jsx').then(({ exercisePicker }) => {
  const picker = exercisePicker(ex => { picker?.close(); onPick(ex) })
})
const confirm = opts => import('../../sheets.jsx').then(({ confirmSheet }) => confirmSheet(opts))

export default function MarkedWorkoutEditor({ iso, routine = null, workout = null, close }) {
  const st = useStore(s => s.S)
  const wide = useWide()
  const effort = effortOf(st)
  const effortHd = EFFORT[effort]?.hd
  const [initial] = useState(() => { const draft = markedDraft({ routine, workout }); return { draft, open: isWide() ? draft[0]?.key ?? null : null } })
  const [items, setItems] = useState(initial.draft)
  const [openKey, setOpenKey] = useState(initial.open)
  const [typing, setTyping] = useState(false)
  const listRef = useRef(null)
  const scrollTo = useRef(null)   // el ejercicio recién abierto, para subirlo cuando ya está en pantalla
  const name = workout?.name || routine?.name || t('Freestyle')
  // Un entreno ya hecho con la app (no marcado): se corrige lo cargado, sin tocar lo demás.
  const editing = !!workout && !workout.marked
  // "La última vez" es la sesión anterior a ese día: ni este entreno ni una posterior.
  const history = useMemo(() => ({ workouts: st.workouts.filter(w => w.d < iso) }), [st.workouts, iso])
  const unit = st.unit || 'kg'
  // Un resumen por ejercicio, una vez por render: la fila, las confirmaciones y el botón Guardar.
  const sums = new Map(items.map(it => [it.key, itemSummary(it, effort)]))
  // Al quitar o cambiar sin series perdidas: qué no cambia.
  const untouched = editing ? t('Solo cambia este entreno.') : t('La rutina no cambia.')

  const patch = (key, fn) => setItems(list => list.map(it => (it.key === key ? fn(it) : it)))
  const setRows = (key, fn) => patch(key, it => ({ ...it, rows: fn(it.rows) }))
  const open = key => {
    const next = !wide && openKey === key ? null : key
    setOpenKey(next)
    if (next && !wide) scrollTo.current = next
  }
  // Celular: el ejercicio abierto sube arriba de todo, así su tabla queda sobre el teclado. Después
  // del render, cuando la tabla (o el ejercicio recién agregado) ya existe.
  useEffect(() => {
    const key = scrollTo.current
    if (!key) return
    scrollTo.current = null
    listRef.current?.querySelector(`[data-key="${key}"]`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [openKey, items])
  const remove = key => {
    const rest = items.filter(it => it.key !== key)
    setItems(rest)
    if (openKey === key) setOpenKey(wide ? rest[0]?.key ?? null : null)
  }
  const swap = (key, to) => patch(key, it => ({ ...newItem(to.id), key, rows: emptyRows(it.rows.length) }))
  // Quitar y cambiar se confirman con el diálogo de toda la app; dice cuántas series se pierden.
  const lostOf = it => sums.get(it.key)?.count || 0
  const askRemove = it => {
    const n = lostOf(it)
    confirm({
      title: t('¿Quitar {0}?', nameOf(it.id)),
      message: [n === 1 ? t('Se pierde la serie que cargaste.') : n > 1 ? t('Se pierden las {0} series que cargaste.', n) : null, untouched].filter(Boolean).join(' '),
      confirmText: t('Quitar'), danger: true, onConfirm: () => remove(it.key),
    })
  }
  const askSwap = it => pickExercise(ex => {
    if (ex.id === it.id) return
    const n = lostOf(it)
    confirm({
      title: t('¿Cambiar {0} por {1}?', nameOf(it.id), nameOf(ex.id)),
      message: n === 1 ? t('La serie que cargaste se borra: era de otro ejercicio.') : n > 1 ? t('Las {0} series que cargaste se borran: eran de otro ejercicio.', n) : untouched,
      confirmText: t('Cambiar'), onConfirm: () => swap(it.key, ex),
    })
  })
  const add = () => pickExercise(ex => { const it = newItem(ex.id); setItems(list => [...list, it]); open(it.key) })
  const save = () => {
    // Los récords se recalculan contra los entrenos anteriores a este, como al terminarlo.
    const w = editing ? buildEditedWorkout(workout, items, effort, { before: st.workouts.filter(x => x.id !== workout.id && workoutTime(x) < workoutTime(workout)) })
      : buildMarkedWorkout(iso, { routine, routineId: workout ? workout.routineId ?? null : undefined, name, items, effort },
        { id: workout?.id || uid(), start: workout?.start })
    useStore.getState().update(s => { putWorkout(s.workouts, w) })
    close()
    useUI.getState().toast(editing ? t('Cambios guardados') : workout ? t('Series guardadas') : t('Marcado como entrenado'))
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
    const head = f => (f === effort ? effortHd : f === 'w' ? (cols.includes('r') && isBw(it.cfg) ? '+' + unit : unit) : HEAD[f])
    return <div className="mwe-table" style={{ '--cols': cols.length }}>
      {last && <div className="mwe-last">{t('Última vez: {0}', last.sets.map(s => setLabel(it.id, s, it.cfg)).join(', '))}</div>}
      {it.keep?.length > 0 && <div className="mwe-last">{it.keep.length === 1 ? t('1 serie de calentamiento o sin completar: se conserva.') : t('{0} series de calentamiento o sin completar: se conservan.', it.keep.length)}</div>}
      <div className="mwe-tr"><span />{cols.map(f => <span key={f} className="mwe-th">{head(f)}</span>)}<span /></div>
      {it.rows.map((row, i) => <div key={i} className="mwe-tr">
        <span className="mwe-n">{i + 1}</span>
        {cols.map((f, j) => <input key={f} className="input mwe-cell" data-f={f} type="text"
          inputMode={DECIMAL.has(f) ? 'decimal' : 'numeric'} enterKeyHint={i * cols.length + j === total - 1 ? 'done' : 'next'}
          aria-label={t('Serie {0} · {1}', i + 1, head(f))} value={row[f] ?? ''}
          placeholder={last?.sets[i]?.[f] != null ? asTyped(last.sets[i][f]) : ''}
          onChange={e => { const v = e.target.value; setRows(it.key, rows => rows.map((r, k) => (k === i ? { ...r, [f]: v } : r))) }}
          onKeyDown={onKey} />)}
        <button type="button" className="iconbtn mwe-x" aria-label={t('Borrar serie {0}', i + 1)}
          onClick={() => setRows(it.key, rows => rows.filter((_, k) => k !== i))}><Icon name="trash" /></button>
      </div>)}
      <div className="mwe-tools">
        <Button size="sm" variant="plain" icon="plus" onClick={() => setRows(it.key, rows => [...rows, {}])}>{t('Serie')}</Button>
        {last && <Button size="sm" variant="plain" icon="copy" onClick={() => setRows(it.key, () => last.sets.map(s => Object.fromEntries(Object.entries(markedRowOf(s)).map(([f, v]) => [f, asTyped(v)]))))}>{t('Igual que la última vez')}</Button>}
      </div>
    </div>
  }

  const actions = it => <>
    <button type="button" className="iconbtn" aria-label={t('Cambiar {0}', nameOf(it.id))} onClick={() => askSwap(it)}><Icon name="swap" /></button>
    <button type="button" className="iconbtn" aria-label={t('Quitar {0}', nameOf(it.id))} onClick={() => askRemove(it)}><Icon name="trash" /></button>
  </>

  const row = it => {
    const sum = sums.get(it.key)
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
        <div className="small muted">{editing ? t('Corregí lo que cargaste. Los drop sets y las notas se conservan.') : effortHd ? t('Series opcionales · {0} según tus ajustes', effortHd) : t('Series opcionales')}</div>
      </div>
    </div>
    <div className="mwe-body">
      <div className="mwe-list" ref={listRef}>
        {items.map(row)}
        {!items.length && <div className="empty small">{editing ? t('Sin ejercicios. Agregá uno.') : t('Sin ejercicios. Agregá uno, o guardá así: cuenta para tu racha.')}</div>}
        <Button variant="plain" icon="plus" className="mwe-add" onClick={add}>{t('Agregar ejercicio')}</Button>
      </div>
      {wide && <div className="mwe-detail">{current ? <>
        <div className="mwe-detail-head">
          <b className="grow capitalize">{nameOf(current.id)}</b>
          {actions(current)}
        </div>
        {table(current)}
        <div className="small muted mwe-keys">{t('Tab: celda siguiente · Enter: serie siguiente')}</div>
      </> : <div className="empty small">{t('Elegí un ejercicio de la lista.')}</div>}</div>}
    </div>
    {!wide && <div className="mwe-spacer" aria-hidden="true" />}
    <div className={'mwe-foot' + (typing && !wide ? ' hidden' : '')}>
      {wide && <Button variant="ghost" className="dim" onClick={close}>{t('Cancelar')}</Button>}
      <Button variant="primary" disabled={editing && ![...sums.values()].some(sm => sm.count)} onClick={save}>{editing ? t('Guardar cambios') : t('Guardar entrenamiento')}</Button>
    </div>
  </div>
}

/** Abre el editor: pantalla completa en el celular, panel centrado desde 700px. */
export function workoutEditorSheet({ iso, routine = null, workout = null }) {
  // locked: un deslizón no tira lo cargado; atrás del sistema y la X del panel siguen cerrando.
  return useUI.getState().openSheet(close => <MarkedWorkoutEditor iso={iso} routine={routine} workout={workout} close={close} />,
    { kind: 'panel', fullScreen: !isWide(), locked: true, backGesture: true })
}
