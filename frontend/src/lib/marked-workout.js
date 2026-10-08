// Un día marcado como entrenado después del hecho (la hoja del día): el workout que se guarda y
// el borrador del editor de series. Puro: sin store ni React.
//
// Un marcado lleva `marked: true` y solo las series que la persona cargó de verdad. Sin series no
// se inventa nada (antes se copiaban las metas de la rutina como hechas, y la sesión siguiente
// arrancaba en 0 kg): cuenta para la racha porque es un workout en ese día, y la recuperación usa
// `muscleLoad`, igual que una clase. El servidor guarda `marked` y `muscleLoad` en `meta`.
import { localDayStartOf, localNoonOf, workoutTime } from './format.js'
import { modeOf, isBw, isEmptySet, workoutVolume, setLabel, EFFORT, capEffort } from './history.js'
import { loadOfRoutine, musclesOf } from './muscles.js'
import { isWarmupRow } from './workout-model.js'
import { EXIDX } from './exercises.js'

/** 'past' | 'today' | 'future': qué ofrece la hoja de ese día. */
export const dayMode = (iso, today) => (iso < today ? 'past' : iso === today ? 'today' : 'future')

/** Columnas de la tabla de un ejercicio, en orden: según su modo y el esfuerzo del perfil. */
export function columnsFor(cfg, effort = 'none') {
  const mode = modeOf(cfg)
  if (mode === 'cardio') return ['min', 'speed']
  const cols = mode === 'time' ? ['sec', 'w'] : ['w', 'r']
  return EFFORT[effort] ? [...cols, effort] : cols
}

// '' o un texto que no es un número >= 0: nada. Acepta coma decimal.
const num = v => {
  if (v == null || v === '') return null
  const n = Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Una fila del editor como serie guardable, o null si quedó vacía (no se guarda). */
export function markedSetOf(row, cfg, effort = 'none') {
  const set = { done: true }
  for (const f of columnsFor(cfg, effort)) {
    const n = num(row?.[f])
    if (n != null) set[f] = f === effort ? capEffort(effort, n) : n
  }
  // Un esfuerzo cargado en la otra escala (o con el ajuste apagado) se conserva tal cual: una serie
  // lleva rir o rpe y nunca se reescribe (effort.js). Solo si no se cargó uno en la escala de ahora.
  if (set.rir == null && set.rpe == null) {
    for (const k of ['rir', 'rpe']) {
      const n = k === effort ? null : num(row?.[k])
      if (n != null) { set[k] = capEffort(k, n); break }
    }
  }
  if (modeOf(cfg) === 'reps' && isBw(cfg) && set.w == null) set.w = 0
  return isEmptySet(set, cfg) ? null : set
}

const FIELDS = ['w', 'r', 'sec', 'min', 'speed', 'rir', 'rpe']
/** Una serie guardada como fila del editor: solo los campos con valor, como texto. */
export const markedRowOf = set => Object.fromEntries(FIELDS.filter(f => set?.[f] != null).map(f => [f, String(set[f])]))

/**
 * Workout de un día marcado.
 * items: [{ id, cfg, rows }] del editor ([] = marcar sin series). `start` (al editar uno que ya
 * existía) conserva su hora; si no, mediodía del día, o una hora antes de ahora si es hoy y todavía
 * no es mediodía, nunca antes de la medianoche local. Sin duración inventada: end = start.
 */
export function buildMarkedWorkout(iso, { routine = null, routineId = routine ? routine.id : null, name, items = [], effort = 'none' } = {}, { id, now = Date.now(), start } = {}) {
  const entries = []
  for (const it of items) {
    const sets = (it.rows || []).map(r => markedSetOf(r, it.cfg, effort)).filter(Boolean)
    if (sets.length) entries.push({ id: it.id, target: { ...it.cfg, id: it.id }, sets })
  }
  const at = start ?? Math.max(localDayStartOf(iso), Math.min(localNoonOf(iso), now - 3600000))
  const w = { id, d: iso, start: at, end: at, name, routineId, marked: true, entries, vol: 0 }
  w.vol = workoutVolume(w)
  if (!entries.length && routine) {
    const load = loadOfRoutine(routine)
    const muscles = [...primaryMuscles(routine)].sort((a, b) => (load[b] || 0) - (load[a] || 0))
    if (muscles.length) w.muscleLoad = { muscles, intensity: 'medium' }
  }
  return w
}

// Los músculos principales de una rutina: en cada ejercicio, el de más peso. Un músculo de apoyo
// (tríceps en un press de banca) no entra: muscleLoad le da a cada uno la carga entera.
function primaryMuscles(routine) {
  const out = new Set()
  for (const c of routine?.ex || []) {
    const m = musclesOf(c.muscleWeights ? c : (EXIDX[c.id] || c))
    const top = Math.max(0, ...Object.values(m))
    for (const slug in m) if (top > 0 && m[slug] === top) out.add(slug)
  }
  return out
}

/**
 * Un entreno ya hecho (con la app), corregido en el editor. Se pisan solo los valores que el editor
 * muestra: una serie conserva lo demás (drops, rest-pause, notas), un valor vaciado se borra, y los
 * calentamientos y las series sin completar vuelven tal cual. Un ejercicio sin series de trabajo
 * sale. El resto del entreno (hora, nota, récords festejados, objetivo de la semana) no cambia.
 */
export function buildEditedWorkout(workout, items, effort = 'none') {
  const entries = []
  for (const it of items) {
    const edited = (it.rows || []).map(r => {
      const set = markedSetOf(r, it.cfg, effort)
      if (!set || !r.orig) return set
      const merged = { ...r.orig, ...set }
      for (const f of FIELDS) if (set[f] == null) delete merged[f]
      return merged
    }).filter(Boolean)
    if (!edited.length) continue
    const keep = it.orig ? it.keep || [] : []
    const sets = [...keep.filter(isWarmupRow), ...edited, ...keep.filter(s => !isWarmupRow(s))]
    entries.push(it.orig ? { ...it.orig, sets } : { id: it.id, target: { ...it.cfg, id: it.id }, sets })
  }
  const w = { ...workout, entries }
  w.vol = workoutVolume(w)
  return w
}

let seq = 0
const keyOf = () => 'mi' + (++seq)
/** n filas vacías del editor (mínimo una). */
export const emptyRows = n => Array.from({ length: Math.max(1, n || 1) }, () => ({}))
/** Un ejercicio del editor: su config (con el id) y una fila vacía por serie. */
export const markedItem = (id, cfg = {}) => ({ key: keyOf(), id, cfg: { ...cfg, id }, rows: emptyRows(cfg.sets) })

/**
 * Borrador del editor: las series de un entreno que ya las tiene, o la rutina con filas vacías.
 * De un entreno se muestran solo las series de trabajo hechas; cada fila guarda su serie original
 * (`orig`) y lo que no se muestra (calentamientos, series sin completar) queda en `keep`, para
 * devolverlo tal cual al guardar.
 */
export function markedDraft({ routine = null, workout = null } = {}) {
  if (workout?.entries?.length) {
    return workout.entries.map(e => {
      const { sets = [], ...orig } = e
      const shown = s => s?.done && !isWarmupRow(s)
      return { key: keyOf(), id: e.id, cfg: { ...(e.target || {}), id: e.id }, orig,
        rows: sets.filter(shown).map(s => ({ ...markedRowOf(s), orig: s })), keep: sets.filter(s => !shown(s)) }
    })
  }
  return (routine?.ex || []).map(c => markedItem(c.id, c))
}

/** Lo que dice la fila cerrada de un ejercicio: cuántas series completas y cuáles. */
export function itemSummary(item, effort = 'none') {
  const sets = (item.rows || []).map(r => markedSetOf(r, item.cfg, effort)).filter(Boolean)
  return { count: sets.length, text: sets.map(s => setLabel(item.id, s, item.cfg)).join(', ') }
}

/**
 * Guarda `w` en la lista de workouts. Si ya está (mismo id), le pisa lo que arma el editor y conserva
 * el resto (la nota, el objetivo de la semana que guardó la racha); la carga muscular solo queda si
 * `w` la trae. Si no, lo inserta en orden por hora (un día pasado no va al final: "la última vez" lee la
 * lista en orden). Muta `list`.
 */
export function putWorkout(list, w) {
  const i = list.findIndex(x => x.id === w.id)
  if (i >= 0) {
    const next = { ...list[i], ...w }
    if (!w.muscleLoad) delete next.muscleLoad
    list[i] = next
    return list
  }
  const at = list.findIndex(x => workoutTime(x) > workoutTime(w))
  list.splice(at < 0 ? list.length : at, 0, w)
  return list
}

/** Etiqueta del tipo de ejercicio en la lista del editor (sin traducir), o null. */
export function modeTag(cfg) {
  const mode = modeOf(cfg)
  if (mode === 'cardio') return 'cardio'
  if (mode === 'time') return 'tiempo'
  return isBw(cfg) ? 'peso corporal' : null
}
