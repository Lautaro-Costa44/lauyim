// What a preset routine (and a whole program of them) trains, read off its plan alone: series
// and the muscles it loads. Used by the admin's Rutinas cards, which show all of this without
// opening the routine.
import { loadOf, rankOf } from './muscles.js'
import { isCardio } from './exercises.js'

// Presets store cardio as { min, speed } without a mode (the column defaults to 'reps').
const isCardioItem = item => item.mode === 'cardio' || isCardio(item.id) || (item.min > 0 && !item.reps && !item.sec)

/** Planned series, all exercises. */
export const totalSets = ex => (ex || []).reduce((sum, item) => sum + Math.max(0, Math.round(+item?.sets || 0)), 0)

/**
 * Effective series per muscle for a list of exercises (cardio excluded, like RoutineEditor).
 * `defs`: { id: exercise } for exercises this device doesn't know yet — the gym's custom ones in
 * a program the member hasn't loaded (GET /api/presets' customExercises).
 */
export function muscleLoad(ex, defs = {}) {
  return loadOf((ex || []).filter(item => item && item.id && !isCardioItem(item))
    .map(item => ({ id: item.id, ex: defs[item.id], sets: Math.max(0, Math.round(+item.sets || 0)) })))
}

/** { id: exercise } from a list of exercise definitions. */
export const defsById = list => Object.fromEntries((list || []).filter(d => d?.id).map(d => [String(d.id), d]))

/** Stats for one preset routine. */
export function presetStats(preset, defs) {
  const ex = preset?.ex || []
  const load = muscleLoad(ex, defs)
  return { exercises: ex.length, sets: totalSets(ex), load, top: rankOf(load).worked }
}

/** Stats for a program: weekly series and load add up every day in it. */
export function programStats(presets, defs) {
  const days = presets || []
  const ex = days.flatMap(p => p.ex || [])
  const load = muscleLoad(ex, defs)
  return {
    days: days.length,
    sets: totalSets(ex),
    load,
    top: rankOf(load).worked,
  }
}

// Weekly effective series per muscle on a fixed scale, so two programs' maps can be compared
// side by side (a relative scale would paint every program's busiest muscle the same).
// Bands roughly follow the usual weekly-volume landmarks: a few series maintain, ~10 build,
// 16+ is a high-volume week.
export const COVERAGE_LEVELS = Object.freeze([
  Object.freeze({ at: 0.01, level: 1 }),
  Object.freeze({ at: 4, level: 2 }),
  Object.freeze({ at: 10, level: 3 }),
  Object.freeze({ at: 16, level: 4 }),
])
