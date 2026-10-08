// Un día marcado como entrenado después del hecho (la hoja del día): el workout que se guarda y
// el borrador del editor de series. Puro: sin store ni React.
//
// Un marcado lleva `marked: true` y solo las series que la persona cargó de verdad. Sin series no
// se inventa nada (antes se copiaban las metas de la rutina como hechas, y la sesión siguiente
// arrancaba en 0 kg): cuenta para la racha porque es un workout en ese día, y la recuperación usa
// `muscleLoad`, igual que una clase. El servidor guarda `marked` y `muscleLoad` en `meta`.
import { localDayStartOf, localNoonOf, workoutTime } from './format.js'
import { modeOf, isBw, isEmptySet, workoutVolume, setLabel, EFFORT, capEffort } from './history.js'
import { loadOfRoutine } from './muscles.js'

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
    const muscles = Object.keys(load).filter(s => load[s] > 0).sort((a, b) => load[b] - load[a])
    if (muscles.length) w.muscleLoad = { muscles, intensity: 'medium' }
  }
  return w
}

let seq = 0
const keyOf = () => 'mi' + (++seq)
const emptyRows = n => Array.from({ length: Math.max(1, n || 1) }, () => ({}))

/** Borrador del editor: las series de un marcado que ya las tiene, o la rutina con filas vacías. */
export function markedDraft({ routine = null, workout = null } = {}) {
  if (workout?.entries?.length) {
    return workout.entries.map(e => ({ key: keyOf(), id: e.id, cfg: { ...(e.target || {}), id: e.id }, rows: (e.sets || []).map(markedRowOf) }))
  }
  return (routine?.ex || []).map(c => ({ key: keyOf(), id: c.id, cfg: { ...c }, rows: emptyRows(c.sets) }))
}

/** Lo que dice la fila cerrada de un ejercicio: cuántas series completas y cuáles. */
export function itemSummary(item, effort = 'none') {
  const sets = (item.rows || []).map(r => markedSetOf(r, item.cfg, effort)).filter(Boolean)
  return { count: sets.length, text: sets.map(s => setLabel(item.id, s, item.cfg)).join(', ') }
}

/**
 * Guarda `w` en la lista de workouts: si ya está (mismo id) lo reemplaza, conservando su nota;
 * si no, lo inserta en orden por hora (un día pasado no va al final: "la última vez" lee la
 * lista en orden). Muta `list`.
 */
export function putWorkout(list, w) {
  const i = list.findIndex(x => x.id === w.id)
  if (i >= 0) {
    const note = list[i].note
    list[i] = note && !w.note ? { ...w, note } : w
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
