// Historial de entrenamientos: reglas puras compartidas por la vista del socio y la del staff.
// Todo recibe los datos por parámetro (los entrenos del socio y su unidad), nunca el store, así
// la misma lógica sirve para "mis entrenos" y para "los entrenos de este socio".
//
// Unidades: la app nunca convierte pesos (un entreno no guarda en qué unidad se anotó). Todo se
// muestra y se compara en la unidad actual del socio.
import { workoutTime } from './format.js'
import { isWarmupRow, dropsOf, extraVolumeOf } from './workout-model.js'
import { modeOf, isBw } from './history.js'
import { estimate1RM } from './onerm.js'

// "Sentadilla" = "sentadilla" = "SENTADILLA"; "press inclinado" encuentra "Press Inclinado".
export const foldText = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const doneWork = entry => (entry?.sets || []).filter(s => s.done && !isWarmupRow(s))
export const entryVolume = entry => doneWork(entry).reduce((v, s) => v + (s.w || 0) * (s.r || 0) + extraVolumeOf(s), 0)
export const workoutDuration = w => Math.max(0, (w.end || w.start || 0) - (w.start || 0))

/**
 * Entrenos filtrados por rutina y por nombre de ejercicio (sin mayúsculas ni tildes).
 * @param {(entry) => string} nameOf  nombre visible de un ejercicio de un entreno
 */
// kind: 'all' | 'workouts' | 'classes' (clases: kind === 'class').
export const isClassWorkout = w => w?.kind === 'class'
export function filterWorkouts(workouts, { routineId = null, query = '', nameOf = e => e.n || e.id, kind = 'all' } = {}) {
  const q = foldText(query)
  return (workouts || []).filter(w => (kind === 'all' || (kind === 'classes') === isClassWorkout(w))
    && (!routineId || w.routineId === routineId)
    && (!q || (w.entries || []).some(e => foldText(nameOf(e)).includes(q))))
}

/** Más nuevo primero, agrupado por mes: [{ key: 'YYYY-MM', workouts, count, vol, ms }]. */
export function groupByMonth(workouts) {
  const sorted = [...(workouts || [])].sort((a, b) => workoutTime(b) - workoutTime(a))
  const groups = []
  for (const w of sorted) {
    const key = String(w.d || '').slice(0, 7)
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) groups.push(g = { key, workouts: [], count: 0, vol: 0, ms: 0 })
    g.workouts.push(w); g.count++; g.vol += Number(w.vol) || 0; g.ms += workoutDuration(w)
  }
  return groups
}

// Serie de trabajo más pesada (a igual peso, más reps) de un ejercicio de un entreno.
export function topSet(entry) {
  let best = null
  for (const s of doneWork(entry)) {
    if (!best || (s.w || 0) > (best.w || 0) || ((s.w || 0) === (best.w || 0) && (s.r || 0) > (best.r || 0))) best = s
  }
  return best
}

/**
 * La vez anterior que se hizo el ejercicio ANTES del entreno abierto (no la última de todas):
 * cualquier rutina, con al menos una serie de trabajo hecha. → { workout, entry } o null.
 */
export function previousEntry(workouts, workout, exId) {
  const t = workoutTime(workout)
  let best = null
  for (const w of workouts || []) {
    if (w === workout || w.id === workout.id || workoutTime(w) >= t) continue
    const entry = (w.entries || []).find(e => e.id === exId)
    if (!entry || !doneWork(entry).length) continue
    if (!best || workoutTime(w) > workoutTime(best.workout)) best = { workout: w, entry }
  }
  return best
}

/**
 * Diferencia contra la vez anterior, en la serie más pesada y en el volumen del ejercicio.
 * → null si no hay anterior; si no, { date, weight, reps, volume } con cada delta en número
 * (0 = igual). El texto ("+2.5 kg") lo arma la vista, así se lee también sin color.
 */
export function compareWithPrevious(workouts, workout, entry) {
  const prev = previousEntry(workouts, workout, entry.id)
  if (!prev) return null
  const a = topSet(entry), b = topSet(prev.entry)
  if (!a || !b) return null
  return {
    date: prev.workout.d,
    weight: round1((a.w || 0) - (b.w || 0)),
    reps: (a.r || 0) - (b.r || 0),
    volume: round1(entryVolume(entry) - entryVolume(prev.entry)),
  }
}
const round1 = n => Math.round(n * 10) / 10

/**
 * Evolución de un ejercicio para el mini gráfico: un punto por entreno.
 *   - con peso: 1RM estimado de la mejor serie;
 *   - peso corporal: más reps en una serie; tiempo: más segundos; cardio: más minutos.
 * → { kind: 'e1rm' | 'reps' | 'sec' | 'min', points: [{ t, d, y }] } (más viejo primero).
 */
export function exerciseSeries(workouts, exId, cfg = { id: exId }) {
  const mode = modeOf(cfg)
  const kind = mode === 'cardio' ? 'min' : mode === 'time' ? 'sec' : isBw(cfg) ? 'reps' : 'e1rm'
  const points = []
  for (const w of workouts || []) {
    const entry = (w.entries || []).find(e => e.id === exId)
    if (!entry) continue
    let y = 0
    for (const s of doneWork(entry)) {
      const v = kind === 'e1rm' ? estimate1RM(s.w || 0, s.r || 0) || 0 : kind === 'reps' ? s.r || 0 : kind === 'sec' ? s.sec || 0 : s.min || 0
      if (v > y) y = v
    }
    if (y > 0) points.push({ t: workoutTime(w), d: w.d, y: Math.round(y * 10) / 10 })
  }
  points.sort((a, b) => a.t - b.t)
  return { kind, points }
}

// Una fila de la tabla de series: número (o "C" de calentamiento), peso, reps, esfuerzo y extras.
export function setRows(entry) {
  let n = 0
  return (entry?.sets || []).filter(s => s.done).map(s => {
    const warm = isWarmupRow(s)
    return {
      label: warm ? 'C' : String(++n), warm, w: s.w || 0, r: s.r || 0, sec: s.sec || 0, min: s.min || 0, speed: s.speed || 0,
      effort: s.rir != null ? { kind: 'RIR', v: s.rir } : s.rpe != null ? { kind: 'RPE', v: s.rpe } : null,
      drops: dropsOf(s), clusters: Array.isArray(s.clusters) && s.type === 'restpause' ? s.clusters : [],
      type: s.type === 'dropset' || s.type === 'restpause' ? s.type : null,
    }
  })
}

/* ---------- cumplimiento del plan semanal ---------- */

// Días YYYY-MM-DD en UTC al mediodía (calendario del gym, sin husos).
const shift = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const weekdayOf = iso => new Date(iso + 'T12:00:00Z').getUTCDay()

// Rutina planeada un día (mismas reglas que el calendario del socio: history.js effectiveRoutineId).
function plannedOn(plan, iso) {
  const ov = (plan.dayPlan || {})[iso]
  if (ov === 'rest') return null
  if (ov && typeof ov === 'object') {
    if (ov.estado === 'descanso' || ov.estado === 'completado') return null
    if (ov.estado === 'rutina') return ov.rutinaId || null
  }
  if (ov && typeof ov === 'string') return ov
  return (plan.week || {})[weekdayOf(iso)] || null
}

/**
 * Cumplimiento de la semana del gym (lunes a domingo) que contiene `today`.
 *   day.state: 'done' (entrenó; `extra` si no estaba planeado) · 'missed' (planeado, día pasado,
 *   no entrenó) · 'pending' (planeado, hoy o después) · 'closed' (gimnasio cerrado y no entrenó: no
 *   cuenta como planeado) · 'rest'. closures: cierres del gimnasio ([{ from, to }]).
 * → { hasPlan, planned, done, pending, closed, days: [{ iso, state, extra, today }] }
 */
export function weekAdherence({ workouts, week, dayPlan, closures = [] }, today) {
  const offset = (weekdayOf(today) + 6) % 7                 // lunes = 0
  const monday = shift(today, -offset)
  const trained = new Set((workouts || []).map(w => w.d))
  const plan = { week, dayPlan }
  const hasPlan = Object.values(week || {}).some(Boolean) || Object.keys(dayPlan || {}).length > 0
  let planned = 0, done = 0, pending = 0, closed = 0
  const days = []
  for (let i = 0; i < 7; i++) {
    const iso = shift(monday, i)
    const isPlanned = !!plannedOn(plan, iso)
    const didTrain = trained.has(iso)
    const isClosed = (closures || []).some(c => c.from <= iso && iso <= c.to)
    if (isClosed && !didTrain) { closed++; days.push({ iso, state: 'closed', extra: false, today: iso === today }); continue }
    let state = 'rest', extra = false
    if (isPlanned) planned++
    if (didTrain) { state = 'done'; extra = !isPlanned; if (isPlanned) done++ }
    else if (isPlanned) { if (iso < today) state = 'missed'; else { state = 'pending'; pending++ } }
    days.push({ iso, state, extra, today: iso === today })
  }
  return { hasPlan, planned, done, pending, closed, days }
}
