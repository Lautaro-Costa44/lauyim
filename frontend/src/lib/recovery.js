import { EXIDX } from './exercises.js'
import { MUSCLES, musclesOf } from './muscles.js'
import { isWarmupRow, dropsOf, clustersOf, isRestPauseSet } from './workout-model.js'
import { workoutTime } from './format.js'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/**
 * Every tunable of the per-muscle fatigue model, in one place. Each value names its source, or
 * says it is a calibration heuristic when no study pins it down.
 */
export const FATIGUE_MODEL = Object.freeze({
  // Heurística de calibración: effective sets that bring one muscle's session to v0 = 1. Chosen
  // so 6 near-failure sets of quads read fatigued -> recovering at 24 h -> ready at 48 h (see
  // the calibration tests), and small muscles clear faster than large ones.
  K: 4.5,
  // Half-life of a session's stimulus by muscle size. The large-muscle value follows the
  // knee-extension vs leg-press recovery study on the quadriceps (isolation recovered by 24 h,
  // compound by 48 h); the small and medium values are a heurística de calibración.
  HALF_LIFE_MS: Object.freeze({
    small: 14 * HOUR_MS,
    medium: 16 * HOUR_MS,
    large: 21 * HOUR_MS,
  }),
  // Morán-Navarro et al. 2017, Eur J Appl Physiol: training to failure delays recovery by
  // 24-48 h. A session whose effective sets are all at RIR 0 gets a half-life x (1 + 0.5); the
  // 0.5 magnitude itself is a heurística de calibración.
  FAILURE_HALF_LIFE_FACTOR: 0.5,
  // Robinson et al. 2024, Sports Med: stimulus rises with proximity to failure. The linear ramp
  // s(RIR) = clamp((5 - RIR) / 4, 0, 1) - zero at RIR 5, full from RIR 1 - is a heurística de
  // calibración of that dose-response.
  STIMULUS_ZERO_RIR: 5,
  STIMULUS_FULL_RIR: 1,
  // Heurística de calibración: each drop of a drop-set and each burst of a rest-pause set after
  // the activation burst adds half an effective set on top of the row's own set.
  DROP_STIMULUS: 0.5,
  CLUSTER_STIMULUS: 0.5,
  // Heurística de calibración: cardio counts one effective set per 20 minutes, capped at two
  // effective sets per session across all cardio exercises.
  CARDIO_MIN_PER_SET: 20,
  CARDIO_MAX_SETS: 2,
  // Heurística de calibración: an estimated RIR compares a set against the best e1RM of the same
  // exercise in the 60 days before its session; older strength is not today's capacity.
  E1RM_WINDOW_MS: 60 * DAY_MS,
  // Epley rep cap, matching onerm.js so high-rep sets do not inflate the estimate.
  E1RM_REP_CAP: 12,
  // Zourdos et al. 2016: RIR = 10 - RPE.
  RPE_MAX: 10,
  // Heurística de calibración: RIR assumed when a set has no rating and no usable estimate (no
  // prior e1RM, unknown external load, or a timed set) - the typical working set (RIR 2 / RPE 8).
  FALLBACK_RIR: 2,
  // Heurística de calibración: upper clamp for manual and estimated RIR (the stepper's max).
  MAX_RIR: 10,
})

// Recovery group of each drawable muscle. Medium: chest, deltoids, trapezius, upper-back,
// adductors. Abductors have no slug of their own: muscles.js maps them onto 'gluteal', so they
// recover as a large muscle. Slugs the model does not name (serratus, hip-flexors, tibialis)
// default to the medium group.
const SMALL_MUSCLES = ['biceps', 'triceps', 'forearm', 'calves', 'abs', 'obliques']
const LARGE_MUSCLES = ['quadriceps', 'hamstring', 'gluteal', 'lower-back']

/** Recovery group ('small' | 'medium' | 'large') keyed by every drawable muscle slug. */
export const MUSCLE_RECOVERY_GROUP = Object.freeze(Object.fromEntries(MUSCLES.map(slug => [
  slug,
  SMALL_MUSCLES.includes(slug) ? 'small' : LARGE_MUSCLES.includes(slug) ? 'large' : 'medium',
])))

// Computational bound for the stimulus scan, not a semantic cliff: after 30 days (over 22
// half-lives even at the longest failure-extended half-life) a session contributes below 1e-6.
export const FATIGUE_SCAN_MS = 30 * DAY_MS
export const BODYWEIGHT_REF_LOAD = 75  // kg assumed for bodyweight exercises when no load is logged

/** Period after training during which retained strength remains at full value. */
export const STRENGTH_FULL_MS = 1209600000

/** Exponential half-life for retained strength after the full-retention period. */
export const STRENGTH_HALF_LIFE_MS = 2419200000

/** Minimum retained-strength value for an untrained or fully detrained muscle. */
export const STRENGTH_FLOOR = 0.5

/**
 * Stable labels for consumer fatigue buckets: values below 0.25 are ready, values from 0.25
 * through 0.5 are recovering, and values above 0.5 are fatigued.
 */
export const FATIGUE_STATES = Object.freeze({
  READY: 'ready',
  RECOVERING: 'recovering',
  FATIGUED: 'fatigued',
})

/**
 * Return exponential decay expressed as a fraction of one half-life.
 *
 * @param {number} ageMs Elapsed age of the stimulus in milliseconds.
 * @param {number} halfLifeMs Duration of one half-life in milliseconds.
 * @returns {number} Remaining fraction, using the exact `0.5 ** (age / halfLife)` formula.
 */
export function halfLifeDecay(ageMs, halfLifeMs) {
  return 0.5 ** (ageMs / halfLifeMs)
}

function emptyMuscleMap(value) {
  return Object.fromEntries(MUSCLES.map(slug => [slug, value]))
}

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value))

// Epley one-rep-max estimate, matching onerm.js (rep cap included).
const epley1RM = (load, reps) => load * (1 + Math.min(reps, FATIGUE_MODEL.E1RM_REP_CAP) / 30)

export const LB_TO_KG = 0.45359237

function numeric(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function isPounds(unit) {
  return /^(?:lb|lbs|pound|pounds)$/i.test(String(unit ?? '').trim())
}

function unitOf(...records) {
  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    for (const key of ['unit', 'u', 'weightUnit', 'weight_unit', 'loadUnit']) {
      if (record[key] !== undefined && record[key] !== null && String(record[key]).trim() !== '') return record[key]
    }
  }
  return 'kg'
}

function kgOf(value, unit) {
  const n = numeric(value)
  if (n === null) return 0
  return Math.max(0, n) * (isPounds(unit) ? LB_TO_KG : 1)
}

// A bodyweight value stamped on a workout is the best historical value. When old records do not
// carry one, use the current profile's canonical bodyweight supplied by Stats, then the stable
// fallback used by the original fatigue model. `bodyweightKg` is already canonical; `bodyweight`
// is accepted for callers that provide a display-unit value explicitly.
function bodyweightKgFor(workout, opts = {}, stampedLoadUnit) {
  const stamped = numeric(workout?.bw) ?? numeric(workout?.bodyweight)
  if (stamped !== null) {
    return kgOf(stamped, unitOf(
      { unit: workout?.bwUnit },
      { unit: workout?.bodyweightUnit },
      workout,
      stampedLoadUnit && { unit: stampedLoadUnit },
      opts,
    ))
  }
  const canonical = numeric(opts.bodyweightKg)
  if (canonical !== null) return Math.max(0, canonical)
  const display = numeric(opts.bodyweight)
  if (display !== null) return kgOf(display, opts.bodyweightUnit || opts.unit || opts.profileUnit)
  return BODYWEIGHT_REF_LOAD
}

function bodyweightTarget(entry) {
  const target = entry?.target
  if (target && Object.prototype.hasOwnProperty.call(target, 'bodyweight')) return !!target.bodyweight
  if (entry && Object.prototype.hasOwnProperty.call(entry, 'bodyweight')) return !!entry.bodyweight
  return null
}

function hasUnitStamp(...records) {
  return records.some(record => record && typeof record === 'object'
    && ['unit', 'u', 'weightUnit', 'weight_unit', 'loadUnit'].some(key => Object.prototype.hasOwnProperty.call(record, key)
      && record[key] !== undefined && record[key] !== null && String(record[key]).trim() !== ''))
}

function bodyweightConfigured(ex, entry, set, workout, opts = {}) {
  const configured = bodyweightTarget(entry)
  if (configured !== null) return configured
  // Before target.bodyweight was persisted, a positive `w` on a catalogue bodyweight exercise
  // already meant an explicitly entered load. Keep those rows compatible when no body-mass
  // context is available; a stamped workout or a profile bodyweight makes the intended total-load
  // semantics unambiguous even for old entries.
  const added = kgOf(set?.w, unitOf(set, entry?.target, entry, workout, opts))
  const hasBodyweightContext = numeric(workout?.bw) !== null
    || numeric(workout?.bodyweight) !== null
    || numeric(opts.bodyweightKg) !== null
    || numeric(opts.bodyweight) !== null
    || hasUnitStamp(set, entry?.target, entry, workout)
  return ex?.eq === 'body weight' && (added === 0 || hasBodyweightContext)
}

function loadKgFor(ex, entry, set, workout, opts = {}) {
  const setUnit = unitOf(set, entry?.target, entry, workout, opts)
  const addedKg = kgOf(set?.w, setUnit)
  const loadUnit = hasUnitStamp(set, entry?.target, entry) ? setUnit : undefined
  return bodyweightConfigured(ex, entry, set, workout, opts)
    ? bodyweightKgFor(workout, opts, loadUnit) + addedKg
    : addedKg
}

/** Effective-set stimulus of one set at the given RIR: clamp((5 - RIR) / 4, 0, 1). */
export function stimulusOfRir(rir) {
  const { STIMULUS_ZERO_RIR: zero, STIMULUS_FULL_RIR: full } = FATIGUE_MODEL
  return clamp((zero - rir) / (zero - full), 0, 1)
}

const isWorkSet = set => set?.done === true && !isWarmupRow(set)

// Reps that describe the row's own effort. A rest-pause row's `r` is the total across every
// burst, so its first cluster (the activation burst) is the set the estimate compares.
function effortReps(set) {
  const clusters = clustersOf(set)
  const reps = isRestPauseSet(set) && clusters.length ? numeric(clusters[0]?.r) : numeric(set?.r)
  return reps !== null && reps > 0 ? reps : 0
}

// Priority: manual RIR (fractions allowed), then manual RPE, then an estimate from the best
// e1RM of this exercise before the session, then the fallback.
function rirOfSet(ex, entry, set, workout, prevE1rm, opts) {
  const rir = numeric(set?.rir)
  if (rir !== null) return clamp(rir, 0, FATIGUE_MODEL.MAX_RIR)
  const rpe = numeric(set?.rpe)
  if (rpe !== null) return clamp(FATIGUE_MODEL.RPE_MAX - rpe, 0, FATIGUE_MODEL.MAX_RIR)
  const load = loadKgFor(ex, entry, set, workout, opts)
  const reps = effortReps(set)
  if (!(load > 0) || !(reps > 0) || !(prevE1rm > 0)) return FATIGUE_MODEL.FALLBACK_RIR
  const repsMax = 30 * (prevE1rm / load - 1)
  return clamp(repsMax - reps, 0, FATIGUE_MODEL.MAX_RIR)
}

// Best e1RM per exercise inside one session, from completed work sets with load and reps.
function sessionE1rms(workout, opts = {}) {
  const best = new Map()
  for (const entry of workout?.entries || []) {
    const ex = EXIDX[entry.id]
    if (ex?.bp === 'cardio') continue
    for (const set of entry.sets || []) {
      if (!isWorkSet(set)) continue
      const load = loadKgFor(ex, entry, set, workout, opts)
      const reps = effortReps(set)
      if (!(load > 0) || !(reps > 0)) continue
      const est = epley1RM(load, reps)
      if (!(best.get(entry.id) >= est)) best.set(entry.id, est)
    }
  }
  return best
}

// Sliding-window maximum of e1RM per exercise, fed in chronological order: one monotonic deque
// per exercise, so each session reads its prior best in amortised O(1) instead of rescanning.
function e1rmWindow() {
  const byExercise = new Map()
  return {
    best(id, time) {
      const q = byExercise.get(id)
      if (!q) return null
      while (q.head < q.items.length && q.items[q.head].time <= time - FATIGUE_MODEL.E1RM_WINDOW_MS) q.head += 1
      return q.head < q.items.length ? q.items[q.head].value : null
    },
    add(id, time, value) {
      let q = byExercise.get(id)
      if (!q) byExercise.set(id, q = { head: 0, items: [] })
      while (q.items.length > q.head && q.items[q.items.length - 1].value <= value) q.items.pop()
      q.items.push({ time, value })
    },
  }
}

// One session's effective sets per muscle, and how many of them were at RIR 0. Warm-ups and
// incomplete sets are skipped. Cardio is pooled across the session, capped, and then split in
// proportion to each cardio exercise's minutes.
function sessionStimulus(workout, prevE1rmOf, opts = {}) {
  const effective = emptyMuscleMap(0)
  const failure = emptyMuscleMap(0)
  const add = (weights, amount, atFailure) => {
    for (const [slug, weight] of Object.entries(weights)) {
      if (!Object.prototype.hasOwnProperty.call(MUSCLES_BY_SLUG, slug)) continue
      effective[slug] += amount * weight
      if (atFailure) failure[slug] += amount * weight
    }
  }
  const cardio = []
  for (const entry of workout?.entries || []) {
    const ex = EXIDX[entry.id]
    const weights = musclesOf(ex)
    for (const set of entry.sets || []) {
      if (!isWorkSet(set)) continue
      if (ex?.bp === 'cardio') {
        const minutes = Math.max(numeric(set?.min) || 0, (numeric(set?.sec) || 0) / 60)
        if (minutes > 0) cardio.push({ weights, minutes })
        continue
      }
      const rir = rirOfSet(ex, entry, set, workout, prevE1rmOf(entry.id), opts)
      const amount = stimulusOfRir(rir)
        + FATIGUE_MODEL.DROP_STIMULUS * dropsOf(set).length
        + FATIGUE_MODEL.CLUSTER_STIMULUS * Math.max(0, clustersOf(set).length - 1)
      // A row's drops/bursts share the row's own effort, so they count as failure work only
      // when the row itself was at RIR 0.
      add(weights, amount, rir <= 0)
    }
  }
  const cardioMinutes = cardio.reduce((sum, item) => sum + item.minutes, 0)
  if (cardioMinutes > 0) {
    const sets = Math.min(cardioMinutes / FATIGUE_MODEL.CARDIO_MIN_PER_SET, FATIGUE_MODEL.CARDIO_MAX_SETS)
    for (const item of cardio) add(item.weights, sets * item.minutes / cardioMinutes, false)
  }
  return { effective, failure }
}

/** Half-life of a muscle's session stimulus, extended by the session's fraction of RIR 0 work. */
export function fatigueHalfLifeMs(slug, failureFraction = 0) {
  const base = FATIGUE_MODEL.HALF_LIFE_MS[MUSCLE_RECOVERY_GROUP[slug] || 'medium']
  return base * (1 + FATIGUE_MODEL.FAILURE_HALF_LIFE_FACTOR * clamp(failureFraction, 0, 1))
}

// Per-muscle events in workout order. The e1RM history reaches one window further back than the
// scan so every scanned session sees its full 60-day prior; anything older is exactly
// irrelevant. Sessions sharing a timestamp never see each other's e1RM.
function fatigueEvents(workouts, current, opts = {}) {
  const scanCutoff = current - FATIGUE_SCAN_MS
  const historyCutoff = scanCutoff - FATIGUE_MODEL.E1RM_WINDOW_MS
  const ordered = (workouts || [])
    .map((workout, index) => ({ workout, index, timestamp: workoutTime(workout) }))
    .filter(item => Number.isFinite(item.timestamp) && item.timestamp > historyCutoff)
    .sort((a, b) => a.timestamp - b.timestamp || a.index - b.index)
  const window = e1rmWindow()
  const byMuscle = Object.fromEntries(MUSCLES.map(slug => [slug, []]))

  for (let i = 0; i < ordered.length;) {
    const timestamp = ordered[i].timestamp
    let j = i
    while (j < ordered.length && ordered[j].timestamp === timestamp) j += 1
    const group = ordered.slice(i, j)
    if (timestamp > scanCutoff) {
      const prevE1rmOf = id => window.best(id, timestamp)
      for (const { workout } of group) {
        const { effective, failure } = sessionStimulus(workout, prevE1rmOf, opts)
        for (const slug of MUSCLES) {
          if (!(effective[slug] > 0)) continue
          byMuscle[slug].push({
            timestamp,
            stimulus: effective[slug] / FATIGUE_MODEL.K,
            halfLifeMs: fatigueHalfLifeMs(slug, failure[slug] / effective[slug]),
          })
        }
      }
    }
    for (const { workout } of group) {
      for (const [id, value] of sessionE1rms(workout, opts)) window.add(id, timestamp, value)
    }
    i = j
  }
  return byMuscle
}

const MUSCLES_BY_SLUG = Object.fromEntries(MUSCLES.map(slug => [slug, true]))

// Each session decays on its own half-life; a future-dated session never decays below age 0.
// The saturation curve 1 - exp(-v) raises the starting level with volume without pinning it.
function fatigueValue(events, now) {
  let value = 0
  for (const event of events) {
    value += event.stimulus * halfLifeDecay(Math.max(0, now - event.timestamp), event.halfLifeMs)
  }
  return 1 - Math.exp(-value)
}

/**
 * Calculate current per-muscle fatigue from completed sets in the recent window.
 *
 * Stimulus time is `workoutTime()`: `workout.start` when it falls on the workout's local day
 * `workout.d`, otherwise local noon of `workout.d`. Each completed non-warm-up set is scored in
 * effective sets from its RIR (manual RIR, manual RPE, an estimate against the exercise's best
 * e1RM in the 60 days before the session, or the fallback), plus half a set per drop or extra
 * rest-pause burst, and spread over the exercise's `musclesOf` weights. A muscle's session
 * stimulus is v0 = effective sets / K; it decays with the muscle group's half-life, extended by
 * the session's share of RIR 0 work, and the decayed sum is normalised with 1 - exp(-v). The
 * scan is bounded to FATIGUE_SCAN_MS for performance, not semantics. See FATIGUE_MODEL.
 * The result always contains every drawable muscle slug.
 *
 * @param {Array<object>} workouts Workout history with `start`/`d` and entry set arrays.
 * @param {number} now Current time in milliseconds; injected to keep this function deterministic.
 * @param {{unit?: string, bodyweightKg?: number}} options Profile-level unit and bodyweight.
 * @returns {Record<string, number>} Fatigue values keyed by every drawable muscle slug.
 */
export function fatigueOf(workouts, now, opts = {}) {
  const current = Number(now)
  const result = emptyMuscleMap(0)
  if (!Number.isFinite(current)) return result
  const byMuscle = fatigueEvents(workouts, current, opts)
  for (const slug of MUSCLES) result[slug] = fatigueValue(byMuscle[slug], current)
  return result
}

/**
 * Calculate retained per-muscle strength from the latest completed stimulus in all history.
 *
 * A muscle with no completed set starts at the 0.5 floor. After a completed set, strength is
 * 1.0 through 14 days old, then decays toward the floor with a 28-day half-life. Any later
 * completed set becomes the new latest stimulus and resets the 14-day full-retention period.
 * The result always contains every drawable muscle slug.
 *
 * @param {Array<object>} workouts Workout history with `start`/`d` and entry set arrays.
 * @param {number} now Current time in milliseconds; injected to keep this function deterministic.
 * @returns {Record<string, number>} Retained-strength values keyed by every drawable muscle slug.
 */
export function strengthOf(workouts, now, opts = {}) {
  const current = Number(now)
  const latest = Object.fromEntries(MUSCLES.map(slug => [slug, -Infinity]))
  for (const workout of workouts || []) {
    const timestamp = workoutTime(workout)
    if (!Number.isFinite(timestamp)) continue
    for (const entry of workout.entries || []) {
      if (!(entry.sets || []).some(set => set?.done === true && !isWarmupRow(set))) continue
      for (const slug of Object.keys(musclesOf(EXIDX[entry.id]))) {
        if (Object.prototype.hasOwnProperty.call(MUSCLES_BY_SLUG, slug) && timestamp > latest[slug]) {
          latest[slug] = timestamp
        }
      }
    }
  }

  const result = emptyMuscleMap(STRENGTH_FLOOR)
  if (!Number.isFinite(current)) return result
  for (const slug of MUSCLES) {
    const lastTimestamp = latest[slug]
    if (!Number.isFinite(lastTimestamp)) continue
    const age = current - lastTimestamp
    if (age <= STRENGTH_FULL_MS) {
      result[slug] = 1
    } else {
      result[slug] = Math.max(
        STRENGTH_FLOOR,
        halfLifeDecay(age - STRENGTH_FULL_MS, STRENGTH_HALF_LIFE_MS),
      )
    }
  }
  return result
}

/**
 * List muscles currently above the fatigued threshold.
 *
 * @param {Array<object>} workouts Workout history passed to {@link fatigueOf}.
 * @param {number} now Current time in milliseconds passed to {@link fatigueOf}.
 * @returns {string[]} Muscle slugs whose fatigue value is greater than 0.5, in `MUSCLES`
 * head-to-toe order.
 * @example
 * const avoid = fatiguedMuscles(workouts, now)
 */
export function fatiguedMuscles(workouts, now, opts = {}) {
  return Object.entries(fatigueOf(workouts, now, opts))
    .filter(([, value]) => value > 0.5)
    .map(([slug]) => slug)
}

/**
 * List muscles whose retained strength is below full retention.
 *
 * @param {Array<object>} workouts Workout history passed to {@link strengthOf}.
 * @param {number} now Current time in milliseconds passed to {@link strengthOf}.
 * @returns {string[]} Muscle slugs whose retained strength is less than 1.0, in `MUSCLES`
 * head-to-toe order; never-trained muscles are included at the 0.5 floor.
 * @example
 * const targets = detrainedMuscles(workouts, now)
 */
export function detrainedMuscles(workouts, now, opts = {}) {
  return Object.entries(strengthOf(workouts, now, opts))
    .filter(([, value]) => value < 1)
    .map(([slug]) => slug)
}
