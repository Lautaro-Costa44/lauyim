import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BODYWEIGHT_REF_LOAD,
  FATIGUE_MODEL,
  FATIGUE_SCAN_MS,
  FATIGUE_STATES,
  LB_TO_KG,
  MUSCLE_RECOVERY_GROUP,
  STRENGTH_FLOOR,
  STRENGTH_FULL_MS,
  STRENGTH_HALF_LIFE_MS,
  detrainedMuscles,
  fatigueHalfLifeMs,
  fatiguedMuscles,
  fatigueOf,
  halfLifeDecay,
  stimulusOfRir,
  strengthOf,
} from './recovery.js'
import { EXDB, EXIDX, registerCustom } from './exercises.js'
import { MUSCLES, musclesOf } from './muscles.js'
import { fatigueStateOf } from './recovery-view.js'
import { isoOf, localNoonOf, workoutTime } from './format.js'
import { markedDoneWorkout } from './history.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 0, 1, 12)
const { K, FALLBACK_RIR } = FATIGUE_MODEL

// Keep fixtures tied to the shipped catalogue while making the expected stimulus explicit.
const SINGLE = EXDB.find(ex => {
  const weights = musclesOf(ex)
  return ex.bp !== 'cardio' && Object.keys(weights).length === 1 && Object.values(weights)[0] === 1
})
const WEIGHTED = EXDB.find(ex => {
  const weights = musclesOf(ex)
  return ex.bp !== 'cardio' && Object.values(weights).includes(0.4)
})
if (!SINGLE || !WEIGHTED) throw new Error('recovery tests require single- and secondary-weight fixtures')

const SINGLE_WEIGHTS = musclesOf(SINGLE)
const WEIGHTED_WEIGHTS = musclesOf(WEIGHTED)
const SINGLE_SLUG = Object.keys(SINGLE_WEIGHTS)[0]
const WEIGHTED_PRIMARY_SLUG = Object.keys(WEIGHTED_WEIGHTS).find(slug => WEIGHTED_WEIGHTS[slug] === 1)
const SECONDARY_SLUG = Object.keys(WEIGHTED_WEIGHTS).find(slug => WEIGHTED_WEIGHTS[slug] === 0.4)
if (!WEIGHTED_PRIMARY_SLUG || !SECONDARY_SLUG) throw new Error('recovery tests require weighted primary and secondary fixtures')

// Single-muscle custom fixtures for the calibration scenarios, one per recovery group.
const FIXTURES = [
  { id: 'fx-quads', n: 'Quad fixture', bp: 'upper legs', tg: 'quadriceps', eq: 'machine', sm: [] },
  { id: 'fx-chest', n: 'Chest fixture', bp: 'chest', tg: 'chest', eq: 'machine', sm: [] },
  { id: 'fx-biceps', n: 'Biceps fixture', bp: 'upper arms', tg: 'biceps', eq: 'machine', sm: [] },
]
const withFixtures = () => {
  beforeEach(() => registerCustom(FIXTURES))
  afterEach(() => registerCustom([]))
}

const workoutAt = (id, start, sets = [{ done: true }]) => ({
  d: new Date(start).toISOString(),
  start,
  entries: [{ id, sets: sets.map(set => ({ ...set })) }],
})
const repeat = (count, set) => Array.from({ length: count }, () => ({ ...set }))
const ratedWorkoutAt = (id, start, count, rir) => workoutAt(id, start, repeat(count, { done: true, w: 100, r: 8, rir }))
// Unrated 80x8 sets with no prior e1RM: every set falls back to RIR 2.
const doneWorkoutAt = (id, start, count = 1) => workoutAt(id, start, repeat(count, { done: true, w: 80, r: 8 }))
const FALLBACK_SETS = stimulusOfRir(FALLBACK_RIR)

const HL = slug => FATIGUE_MODEL.HALF_LIFE_MS[MUSCLE_RECOVERY_GROUP[slug]]
// Closed-form reading for `sets` effective sets of one session, `age` ms old, on half-life `hl`.
const expectedFatigue = (sets, age = 0, hl = HL(SINGLE_SLUG)) => 1 - Math.exp(-sets / K * 0.5 ** (age / hl))
// Effective sets a single set contributes to one muscle, read back from the fatigue value.
const setsOf = value => -K * Math.log(1 - value)

const zeroFatigue = () => Object.fromEntries(MUSCLES.map(slug => [slug, 0]))
const floorStrength = () => Object.fromEntries(MUSCLES.map(slug => [slug, STRENGTH_FLOOR]))
const stableFloat = value => Number(value.toFixed(12))

describe('recovery constants', () => {
  it('exports the model table, windows, floor, and state labels', () => {
    expect(FATIGUE_MODEL).toEqual({
      K: 4.5,
      HALF_LIFE_MS: { small: 14 * HOUR, medium: 16 * HOUR, large: 21 * HOUR },
      FAILURE_HALF_LIFE_FACTOR: 0.5,
      STIMULUS_ZERO_RIR: 5,
      STIMULUS_FULL_RIR: 1,
      DROP_STIMULUS: 0.5,
      CLUSTER_STIMULUS: 0.5,
      CARDIO_MIN_PER_SET: 20,
      CARDIO_MAX_SETS: 2,
      E1RM_WINDOW_MS: 60 * DAY,
      E1RM_REP_CAP: 12,
      RPE_MAX: 10,
      FALLBACK_RIR: 2,
      MAX_RIR: 10,
    })
    expect(Object.isFrozen(FATIGUE_MODEL)).toBe(true)
    expect(FATIGUE_SCAN_MS).toBe(30 * DAY)
    expect(BODYWEIGHT_REF_LOAD).toBe(75)
    expect(STRENGTH_FULL_MS).toBe(14 * DAY)
    expect(STRENGTH_HALF_LIFE_MS).toBe(28 * DAY)
    expect(STRENGTH_FLOOR).toBe(0.5)
    expect(FATIGUE_STATES).toEqual({ READY: 'ready', RECOVERING: 'recovering', FATIGUED: 'fatigued' })
    expect(halfLifeDecay(16 * HOUR, 16 * HOUR)).toBe(0.5)
  })

  it('assigns every drawable slug to a recovery group', () => {
    expect(MUSCLE_RECOVERY_GROUP).toEqual({
      trapezius: 'medium', deltoids: 'medium', chest: 'medium', 'upper-back': 'medium', serratus: 'medium',
      biceps: 'small', triceps: 'small', forearm: 'small',
      abs: 'small', obliques: 'small', 'lower-back': 'large',
      gluteal: 'large', quadriceps: 'large', hamstring: 'large', adductors: 'medium', 'hip-flexors': 'medium',
      calves: 'small', tibialis: 'medium',
    })
  })

  it('maps RIR onto the clamped (5 - RIR) / 4 stimulus curve', () => {
    expect([-1, 0, 0.5, 1, 2, 2.5, 3, 4, 5, 8].map(stimulusOfRir))
      .toEqual([1, 1, 1, 1, 0.75, 0.625, 0.5, 0.25, 0, 0])
  })
})

describe('calibration scenarios', () => {
  withFixtures()
  const stateAt = (workouts, slug, hours) => fatigueStateOf(fatigueOf(workouts, NOW + hours * HOUR)[slug])
  const firstReadyHour = (workouts, slug) => {
    for (let hour = 0; hour <= 240; hour += 1) {
      if (stateAt(workouts, slug, hour) === FATIGUE_STATES.READY) return hour
    }
    return Infinity
  }

  it('6 quad sets at RIR 1: fatigued at the end, recovering at 24 h, ready at 48 h', () => {
    const workouts = [ratedWorkoutAt('fx-quads', NOW, 6, 1)]
    expect(stateAt(workouts, 'quadriceps', 0)).toBe(FATIGUE_STATES.FATIGUED)
    expect(stateAt(workouts, 'quadriceps', 24)).toBe(FATIGUE_STATES.RECOVERING)
    expect(stateAt(workouts, 'quadriceps', 48)).toBe(FATIGUE_STATES.READY)
  })

  it('the same 6 quad sets at RIR 0: not ready at 48 h, ready before 72 h', () => {
    const workouts = [ratedWorkoutAt('fx-quads', NOW, 6, 0)]
    expect(stateAt(workouts, 'quadriceps', 48)).not.toBe(FATIGUE_STATES.READY)
    expect(firstReadyHour(workouts, 'quadriceps')).toBeLessThan(72)
  })

  it('6 chest sets at RIR 1: ready at 36 h or earlier', () => {
    expect(firstReadyHour([ratedWorkoutAt('fx-chest', NOW, 6, 1)], 'chest')).toBeLessThanOrEqual(36)
  })

  it('4 biceps sets at RIR 1: ready at 24 h or earlier', () => {
    expect(firstReadyHour([ratedWorkoutAt('fx-biceps', NOW, 4, 1)], 'biceps')).toBeLessThanOrEqual(24)
  })
})

describe('RIR per set', () => {
  withFixtures()
  const one = set => setsOf(fatigueOf([workoutAt('fx-chest', NOW, [{ done: true, w: 100, r: 5, ...set }])], NOW).chest)
  // A prior 100x8 session with RIR 5: it adds no stimulus of its own, only an e1RM of 126.67 kg.
  const prior = (start = NOW - DAY, w = 100) => workoutAt('fx-chest', start, [{ done: true, w, r: 8, rir: 5 }])
  const estimated = (history, set = { done: true, w: 100, r: 5 }, at = NOW) =>
    setsOf(fatigueOf([...history, workoutAt('fx-chest', NOW, [set])], at).chest)

  it('accepts a fractional manual RIR', () => {
    expect(one({ rir: 2.5 })).toBeCloseTo(0.625, 10)
    // RIR 0.5 is full stimulus but not failure: the half-life stays at the group's base
    const value = fatigueOf([workoutAt('fx-chest', NOW, [{ done: true, w: 100, r: 5, rir: 0.5 }])], NOW + HL('chest')).chest
    expect(value).toBeCloseTo(expectedFatigue(1, HL('chest'), HL('chest')), 10)
  })

  it('converts a manual RPE to RIR = 10 - RPE, with a manual RIR taking priority', () => {
    expect(one({ rpe: 8 })).toBeCloseTo(0.75, 10)
    expect(one({ rpe: 7.5 })).toBeCloseTo(0.625, 10)
    expect(one({ rir: 4, rpe: 10 })).toBeCloseTo(0.25, 10)
  })

  it('keeps a manual RIR 0 / RPE 10 instead of falling through to the estimate', () => {
    // with this prior, an unrated 100x5 estimates RIR 3 (0.5 sets) and the fallback is RIR 2
    // (0.75): only a manual 0 read as 0 scores a full set on the failure half-life
    const failureHl = HL('chest') * (1 + FATIGUE_MODEL.FAILURE_HALF_LIFE_FACTOR)
    for (const rating of [{ rir: 0 }, { rpe: 10 }, { rir: 0, rpe: 6 }]) {
      const set = { done: true, w: 100, r: 5, ...rating }
      expect(estimated([prior()], set)).toBeCloseTo(1, 10)
      const later = fatigueOf([prior(), workoutAt('fx-chest', NOW, [set])], NOW + failureHl).chest
      expect(later).toBeCloseTo(expectedFatigue(1, failureHl, failureHl), 10)
    }
    // an empty or null rating is "not logged", not 0
    expect(estimated([prior()], { done: true, w: 100, r: 5, rir: null, rpe: '' })).toBeCloseTo(0.5, 10)
  })

  it('estimates RIR from the best e1RM of earlier sessions only', () => {
    // alone: its own e1RM is not "previous", so the set falls back to RIR 2
    expect(estimated([])).toBeCloseTo(FALLBACK_SETS, 10)
    // after 100x8: repsMax = 30 x (126.67 / 100 - 1) = 8, RIR = 8 - 5 = 3
    expect(estimated([prior()])).toBeCloseTo(0.5, 10)
    // a heavier session after this one never reweights it
    const later = workoutAt('fx-chest', NOW + HOUR, [{ done: true, w: 200, r: 8, rir: 5 }])
    expect(estimated([prior(), later], undefined, NOW + HOUR)).toBeCloseTo(estimated([prior()], undefined, NOW + HOUR), 10)
    // a session at the same timestamp is not earlier either
    expect(estimated([prior(NOW)])).toBeCloseTo(FALLBACK_SETS, 10)
    // outside the 60-day window the prior is gone
    expect(estimated([prior(NOW - 61 * DAY)])).toBeCloseTo(FALLBACK_SETS, 10)
    expect(estimated([prior(NOW - 59 * DAY)])).toBeCloseTo(0.5, 10)
    // the best prior wins
    expect(estimated([prior(NOW - 3 * DAY, 60), prior()])).toBeCloseTo(0.5, 10)
  })

  it('ignores warm-ups and zero-load sets when building the prior e1RM', () => {
    const warm = workoutAt('fx-chest', NOW - DAY, [{ done: true, warmup: true, w: 200, r: 8 }])
    const unloaded = workoutAt('fx-chest', NOW - DAY, [{ done: true, w: 0, r: 8, rir: 5 }])
    expect(estimated([warm])).toBeCloseTo(FALLBACK_SETS, 10)
    expect(estimated([unloaded])).toBeCloseTo(FALLBACK_SETS, 10)
  })

  it('clamps a negative estimated RIR to 0, which counts as failure', () => {
    // 130 kg against a 126.67 kg prior e1RM: repsMax < 0
    const set = { done: true, w: 130, r: 8 }
    expect(estimated([prior()], set)).toBeCloseTo(1, 10)
    const hl = HL('chest') * (1 + FATIGUE_MODEL.FAILURE_HALF_LIFE_FACTOR)
    const later = fatigueOf([prior(), workoutAt('fx-chest', NOW, [set])], NOW + hl).chest
    expect(later).toBeCloseTo(expectedFatigue(1, hl, hl), 10)
  })

  it('falls back to RIR 2 with no history, unknown external load, or a timed set', () => {
    expect(one({})).toBeCloseTo(FALLBACK_SETS, 10)
    expect(estimated([prior()], { done: true, w: 0, r: 10 })).toBeCloseTo(FALLBACK_SETS, 10)
    expect(estimated([prior()], { done: true, r: 10 })).toBeCloseTo(FALLBACK_SETS, 10)
    expect(estimated([prior()], { done: true, sec: 60 })).toBeCloseTo(FALLBACK_SETS, 10)
  })

  it('reads an old markDone record (w 0, r 10) as RIR 2 sets', () => {
    const iso = isoOf(new Date(NOW))
    const marked = markedDoneWorkout(iso, { id: 'r', ex: [{ id: 'fx-chest', sets: 3 }] }, { id: 'm', name: 'r', now: NOW + 2 * HOUR })
    expect(marked.entries[0].sets[0]).toEqual({ done: true, w: 0, r: 10 })
    const at = workoutTime(marked)
    const history = [prior(at - DAY), marked]
    expect(setsOf(fatigueOf(history, at).chest)).toBeCloseTo(3 * FALLBACK_SETS, 10)
  })

  it('estimates a bodyweight set from body mass plus added load', () => {
    const bwEx = EXDB.find(ex => ex.eq === 'body weight' && ex.bp !== 'cardio')
    if (!bwEx) throw new Error('test requires a bodyweight exercise fixture')
    const slug = Object.keys(musclesOf(bwEx)).find(key => musclesOf(bwEx)[key] === 1)
    const at = (start, sets, extra = {}) => ({ d: new Date(start).toISOString(), start, ...extra, entries: [{ id: bwEx.id, sets }] })
    // prior: 80 kg x 12 at RIR 5 (no stimulus) -> e1RM 112 kg
    const history = [at(NOW - DAY, [{ done: true, r: 12, rir: 5 }], { bw: 80, unit: 'kg' })]
    const unloaded = setsOf(fatigueOf([...history, at(NOW, [{ done: true, r: 8 }], { bw: 80, unit: 'kg' })], NOW)[slug])
    const loaded = setsOf(fatigueOf([...history, at(NOW, [{ done: true, w: 10, r: 8 }], { bw: 80, unit: 'kg' })], NOW)[slug])
    // 80x8: repsMax 12, RIR 4 -> 0.25; 90x8: repsMax 7.33, RIR 0 -> 1
    expect(unloaded).toBeCloseTo(0.25, 10)
    expect(loaded).toBeCloseTo(1, 10)
    // an unstamped session uses the profile bodyweight: heavier body, closer to failure
    const light = fatigueOf([...history, at(NOW, [{ done: true, r: 8 }])], NOW, { bodyweightKg: 80 })[slug]
    const heavy = fatigueOf([...history, at(NOW, [{ done: true, r: 8 }])], NOW, { bodyweightKg: 90 })[slug]
    expect(heavy).toBeGreaterThan(light)
  })
})

describe('drops, clusters, failure, and cardio', () => {
  withFixtures()
  const setsFor = (sets, slug = 'chest', id = 'fx-chest') => setsOf(fatigueOf([workoutAt(id, NOW, sets)], NOW)[slug])

  it('adds half an effective set per drop on top of the main set', () => {
    const row = { done: true, type: 'dropset', w: 100, r: 8, rir: 1, drops: [{ w: 80, r: 6 }, { w: 60, r: 6 }] }
    expect(setsFor([row])).toBeCloseTo(1 + 2 * FATIGUE_MODEL.DROP_STIMULUS, 10)
    // a drops array on a straight row is not a drop-set
    expect(setsFor([{ ...row, type: 'straight' }])).toBeCloseTo(1, 10)
  })

  it('adds half an effective set per rest-pause burst after the activation burst', () => {
    const row = { done: true, type: 'restpause', w: 100, r: 18, rir: 1, clusters: [{ r: 10 }, { r: 5 }, { r: 3 }] }
    expect(setsFor([row])).toBeCloseTo(1 + 2 * FATIGUE_MODEL.CLUSTER_STIMULUS, 10)
  })

  it('estimates a rest-pause row from its activation burst, not its total reps', () => {
    const prior = workoutAt('fx-chest', NOW - DAY, [{ done: true, w: 100, r: 8, rir: 5 }])
    const row = { done: true, type: 'restpause', w: 100, r: 20, clusters: [{ r: 5 }, { r: 10 }, { r: 5 }] }
    // RIR = 8 - 5 = 3 -> 0.5, plus two extra bursts
    const value = fatigueOf([prior, workoutAt('fx-chest', NOW, [row])], NOW).chest
    expect(setsOf(value)).toBeCloseTo(0.5 + 2 * FATIGUE_MODEL.CLUSTER_STIMULUS, 10)
  })

  it('extends the half-life by 1 + 0.5 x the fraction of effective sets at RIR 0', () => {
    const sets = [...repeat(4, { done: true, w: 100, r: 8, rir: 0 }), ...repeat(4, { done: true, w: 100, r: 8, rir: 2 })]
    const effective = 4 + 4 * 0.75
    const hl = HL('chest') * (1 + FATIGUE_MODEL.FAILURE_HALF_LIFE_FACTOR * (4 / effective))
    expect(fatigueHalfLifeMs('chest', 4 / effective)).toBeCloseTo(hl, 6)
    const value = fatigueOf([workoutAt('fx-chest', NOW, sets)], NOW + HL('chest')).chest
    expect(value).toBeCloseTo(expectedFatigue(effective, HL('chest'), hl), 10)
    // no failure work: the base half-life
    expect(fatigueOf([workoutAt('fx-chest', NOW, sets.slice(4))], NOW + HL('chest')).chest)
      .toBeCloseTo(expectedFatigue(3, HL('chest'), HL('chest')), 10)
  })

  it('counts one effective set per 20 cardio minutes, capped at 2 per session and split by minutes', () => {
    const treadmill = EXIDX.cardio_treadmill
    const bike = EXIDX.cardio_bike
    if (!treadmill || !bike) throw new Error('test requires the treadmill and bike cardio fixtures')
    const quads = weights => weights.quadriceps || 0
    const cardio = entries => setsOf(fatigueOf([{
      d: new Date(NOW).toISOString(), start: NOW,
      entries: entries.map(([id, min]) => ({ id, sets: [{ done: true, min }] })),
    }], NOW).quadriceps)

    expect(cardio([['cardio_treadmill', 20]])).toBeCloseTo(1 * quads(musclesOf(treadmill)), 10)
    expect(cardio([['cardio_treadmill', 90]])).toBeCloseTo(2 * quads(musclesOf(treadmill)), 10)
    // 30 + 60 minutes = 4.5 sets, capped to 2, split 1/3 : 2/3
    expect(cardio([['cardio_treadmill', 30], ['cardio_bike', 60]]))
      .toBeCloseTo(2 * (quads(musclesOf(treadmill)) / 3 + quads(musclesOf(bike)) * 2 / 3), 10)
  })

  it('excludes warm-ups and unfinished sets', () => {
    const work = repeat(3, { done: true, w: 100, r: 8, rir: 1 })
    const noisy = [
      { done: true, warmup: true, w: 40, r: 8, rir: 0 },
      { done: true, phase: 'warmup', w: 60, r: 5 },
      ...work,
      { done: false, w: 100, r: 8, rir: 0 },
    ]
    expect(fatigueOf([workoutAt('fx-chest', NOW, noisy)], NOW)).toEqual(fatigueOf([workoutAt('fx-chest', NOW, work)], NOW))
    // a heavy warm-up does not become the next session's prior e1RM either
    const warmPrior = workoutAt('fx-chest', NOW - DAY, [{ done: true, warmup: true, w: 200, r: 8 }])
    const today = workoutAt('fx-chest', NOW, [{ done: true, w: 100, r: 5 }])
    expect(fatigueOf([warmPrior, today], NOW).chest).toBe(fatigueOf([today], NOW).chest)
  })
})

describe('fatigueOf and strengthOf', () => {
  it('returns every muscle, ready/floor defaults, and hook defaults for empty history', () => {
    const fatigue = fatigueOf([], NOW)
    const strength = strengthOf([], NOW)

    expect(Object.keys(fatigue)).toEqual(MUSCLES)
    expect(fatigue).toEqual(zeroFatigue())
    expect(Object.values(fatigue).map(fatigueStateOf)).toEqual(MUSCLES.map(() => FATIGUE_STATES.READY))
    expect(Object.keys(strength)).toEqual(MUSCLES)
    expect(strength).toEqual(floorStrength())
    expect(fatiguedMuscles([], NOW)).toEqual([])
    expect(detrainedMuscles([], NOW)).toEqual(MUSCLES)
  })

  it('spreads one set over the exercise muscle weights and decays each on its own half-life', () => {
    const age = 10 * HOUR
    const workouts = [doneWorkoutAt(WEIGHTED.id, NOW - age)]
    const fatigue = fatigueOf(workouts, NOW)
    const strength = strengthOf(workouts, NOW)
    for (const slug of MUSCLES) {
      const weight = WEIGHTED_WEIGHTS[slug] || 0
      expect(fatigue[slug]).toBeCloseTo(weight ? expectedFatigue(FALLBACK_SETS * weight, age, HL(slug)) : 0, 10)
      expect(strength[slug]).toBe(weight ? 1 : STRENGTH_FLOOR)
    }
    expect(fatiguedMuscles(workouts, NOW)).toEqual([])
  })

  it('raises starting fatigue with volume, never pins, and fades without a cliff', () => {
    const at0 = count => fatigueOf([doneWorkoutAt(SINGLE.id, NOW, count)], NOW)[SINGLE_SLUG]
    expect(at0(1)).toBeCloseTo(expectedFatigue(FALLBACK_SETS), 10)
    expect(at0(12)).toBeCloseTo(expectedFatigue(12 * FALLBACK_SETS), 10)
    expect(at0(12)).toBeGreaterThan(at0(5))
    expect(at0(5)).toBeGreaterThan(at0(1))
    expect(at0(12)).toBeLessThan(1)
    const old = fatigueOf([doneWorkoutAt(SINGLE.id, NOW - 72 * HOUR, 12)], NOW)[SINGLE_SLUG]
    expect(old).toBeGreaterThan(0)
    expect(old).toBeLessThan(0.25)
  })

  it('ignores sets whose done flag is false for both axes', () => {
    const workouts = [workoutAt(WEIGHTED.id, NOW, [{ done: false }])]
    expect(fatigueOf(workouts, NOW)).toEqual(zeroFatigue())
    expect(strengthOf(workouts, NOW)).toEqual(floorStrength())
    expect(fatiguedMuscles(workouts, NOW)).toEqual([])
    expect(detrainedMuscles(workouts, NOW)).toEqual(MUSCLES)
  })
})

describe('fatigue state boundaries', () => {
  // Age at which `sets` effective sets on one muscle land exactly on `target`.
  const ageAt = (sets, target, hl) => hl * Math.log2(sets / K / -Math.log(1 - target))
  const sets = 4
  const at = (slug, target) => {
    const hl = HL(slug)
    return [ratedWorkoutAt(slug === SINGLE_SLUG ? SINGLE.id : WEIGHTED.id, NOW - ageAt(slug === SINGLE_SLUG ? sets : sets * 0.4, target, hl), sets, 1)]
  }

  it('classifies exactly .25 as recovering and .2499 as ready', () => {
    const value = target => {
      const v = fatigueOf(at(SECONDARY_SLUG, target), NOW)[SECONDARY_SLUG]
      expect(v).toBeCloseTo(target, 10)
      return stableFloat(v)
    }
    expect(fatigueStateOf(value(0.25))).toBe(FATIGUE_STATES.RECOVERING)
    expect(fatigueStateOf(value(0.2499))).toBe(FATIGUE_STATES.READY)
  })

  it('classifies .4999 as recovering, .5001 as fatigued, and hooks only fatigued muscles', () => {
    const atHalf = at(SINGLE_SLUG, 0.4999)
    const aboveHalf = at(SINGLE_SLUG, 0.5001)
    const half = fatigueOf(atHalf, NOW)[SINGLE_SLUG]
    const above = fatigueOf(aboveHalf, NOW)[SINGLE_SLUG]

    expect(half).toBeCloseTo(0.4999, 10)
    expect(fatigueStateOf(stableFloat(half))).toBe(FATIGUE_STATES.RECOVERING)
    expect(fatiguedMuscles(atHalf, NOW)).toEqual([])
    expect(above).toBeCloseTo(0.5001, 10)
    expect(fatigueStateOf(stableFloat(above))).toBe(FATIGUE_STATES.FATIGUED)
    expect(fatiguedMuscles(aboveHalf, NOW)).toEqual([SINGLE_SLUG])
  })
})

describe('history edits and the scan window', () => {
  const loadedWorkout = (start, weight, count = 8, rir) => workoutAt(
    '1254',
    start,
    repeat(count, rir === undefined ? { done: true, w: weight, r: 8 } : { done: true, w: weight, r: 8, rir }),
  )

  it('keeps a three-session history non-increasing hour by hour as sessions leave the scan', () => {
    const base = Date.UTC(2026, 0, 31, 12)
    const workouts = [-20, -10, 0].map(days => loadedWorkout(base + days * DAY, 100))
    const observed = Array.from({ length: 31 * 24 + 1 }, (_, hour) => fatigueOf(workouts, base + hour * HOUR).chest)

    expect(observed[0]).toBeGreaterThan(0.5)
    expect(observed.at(-1)).toBe(0)
    for (let index = 1; index < observed.length; index += 1) {
      expect(observed[index]).toBeLessThanOrEqual(observed[index - 1] + Number.EPSILON)
    }
  })

  it('ignores imports older than 90 days (30-day scan + 60-day e1RM window)', () => {
    const today = loadedWorkout(NOW, 100, 5)
    const baseline = fatigueOf([today], NOW)
    expect(fatigueOf([loadedWorkout(NOW - 90 * DAY, 140, 10), today], NOW)).toEqual(baseline)
    expect(fatigueOf([loadedWorkout(NOW - 120 * DAY, 100, 20, 0), today], NOW)).toEqual(baseline)
    // inside the window, an older import is not in the scan but does feed the estimate
    expect(fatigueOf([loadedWorkout(NOW - 45 * DAY, 140, 10), today], NOW).chest).not.toBe(baseline.chest)
  })

  it('never increases fatigue when any one manually rated workout is deleted', () => {
    // Restricted to manual RIR: with an estimated RIR, deleting a session can lower a later
    // session's prior e1RM and raise its fatigue (see scripts/fatigue-monotonic-probe.mjs).
    const workouts = [
      loadedWorkout(NOW - 40 * DAY, 100, 15, 1),
      loadedWorkout(NOW - 3 * DAY, 100, 8, 2),
      loadedWorkout(NOW - 2 * DAY, 100, 8, 0),
      loadedWorkout(NOW - DAY, 60, 4, 3),
      loadedWorkout(NOW, 120, 10, 0.5),
    ]
    const before = fatigueOf(workouts, NOW)
    workouts.forEach((_, deletedIndex) => {
      const after = fatigueOf(workouts.filter((__, index) => index !== deletedIndex), NOW)
      for (const slug of MUSCLES) expect(after[slug]).toBeLessThanOrEqual(before[slug] + Number.EPSILON)
    })
  })

  it('rates a lighter current week below repeating the established load', () => {
    const prior = [-21, -14, -7].map(days => loadedWorkout(NOW + days * DAY, 100))
    const lighter = fatigueOf([...prior, loadedWorkout(NOW, 50)], NOW).chest
    const repeated = fatigueOf([...prior, loadedWorkout(NOW, 100)], NOW).chest
    expect(lighter).toBeLessThan(repeated)
  })

  it('computes 500 synthetic workouts in well under 200 ms', () => {
    const ids = EXDB.filter(ex => ex.bp !== 'cardio').slice(0, 20).map(ex => ex.id)
    const workouts = Array.from({ length: 500 }, (_, i) => ({
      d: new Date(NOW - i * 4 * HOUR).toISOString(),
      start: NOW - i * 4 * HOUR,
      entries: Array.from({ length: 5 }, (__, e) => ({
        id: ids[(i + e) % ids.length],
        sets: [
          { done: true, warmup: true, w: 40, r: 8 },
          ...Array.from({ length: 4 }, (___, s) => ({ done: true, w: 60 + ((i * 7 + s) % 40), r: 6 + (s % 5) })),
        ],
      })),
    }))
    fatigueOf(workouts, NOW)
    const times = Array.from({ length: 3 }, () => {
      const started = performance.now()
      fatigueOf(workouts, NOW)
      return performance.now() - started
    }).sort((a, b) => a - b)
    expect(times[1]).toBeLessThan(200)
  })
})

describe('strengthOf', () => {
  const strengthAt = age => strengthOf([doneWorkoutAt(SINGLE.id, NOW - age)], NOW)[SINGLE_SLUG]

  it('stays at full retention through 14 days and decays from 15 days by the 28-day half-life', () => {
    expect(strengthAt(STRENGTH_FULL_MS)).toBe(1)
    expect(strengthAt(15 * DAY)).toBeCloseTo(0.5 ** (1 / 28), 10)
  })

  it('clamps the 42-day half-life point and later 56-day value at the .5 floor', () => {
    expect(strengthAt(42 * DAY)).toBe(0.5)
    expect(strengthAt(56 * DAY)).toBe(STRENGTH_FLOOR)
  })

  it('resets retained strength when a later completed session retrains the muscle', () => {
    const workouts = [
      doneWorkoutAt(SINGLE.id, NOW - 20 * DAY),
      doneWorkoutAt(SINGLE.id, NOW),
    ]
    expect(strengthOf(workouts, NOW)[SINGLE_SLUG]).toBe(1)
  })
})

describe('accumulation and purity', () => {
  it('sums independently decayed sessions regardless of input order', () => {
    const ages = [64 * HOUR, 40 * HOUR]
    const workouts = ages.map(age => ratedWorkoutAt(SINGLE.id, NOW - age, 3, 1))
    const hl = HL(SINGLE_SLUG)
    const expected = 1 - Math.exp(-ages.reduce((sum, age) => sum + 3 / K * 0.5 ** (age / hl), 0))

    expect(fatigueOf(workouts, NOW)[SINGLE_SLUG]).toBeCloseTo(expected, 10)
    expect(fatigueOf([...workouts].reverse(), NOW)[SINGLE_SLUG]).toBeCloseTo(expected, 10)
  })

  it('returns identical results without mutating inputs or sharing state', () => {
    const workouts = [
      doneWorkoutAt(SINGLE.id, NOW - 64 * HOUR),
      doneWorkoutAt(SINGLE.id, NOW - 40 * HOUR),
    ]
    const before = JSON.parse(JSON.stringify(workouts))
    const firstFatigue = fatigueOf(workouts, NOW)
    const firstStrength = strengthOf(workouts, NOW)

    expect(fatigueOf(workouts, NOW)).toEqual(firstFatigue)
    expect(strengthOf(workouts, NOW)).toEqual(firstStrength)
    expect(workouts).toEqual(before)
  })
})

describe('warm-up flag in strength and fatigue', () => {
  it('a warm-up set neither resets strength nor adds fatigue', () => {
    const now = Date.UTC(2026, 7, 1, 12)
    const oldWork = { id: 'w1', d: '2026-07-10', start: now - 20 * 86400000, unit: 'kg',
      entries: [{ id: '1254', sets: [{ done: true, w: 80, r: 8 }] }] }
    const warm = { id: 'w2', d: '2026-08-01', start: now - 3600000, unit: 'kg',
      entries: [{ id: '1254', sets: [{ done: true, warmup: true, w: 20, r: 8 }] }] }
    const workouts = [oldWork, warm]
    // the strength edge is 20 days old: the fresh warm-up must NOT be the latest training event
    expect(strengthOf(workouts, now).chest).toBeLessThan(1)
    expect(fatigueOf(workouts, now).chest).toBe(fatigueOf([oldWork], now).chest)
  })
})

describe('canonical loads and configured bodyweight', () => {
  const loaded = EXDB.find(ex => {
    const weights = musclesOf(ex)
    return ex.bp !== 'cardio' && ex.eq !== 'body weight'
      && Object.keys(weights).length === 1 && Object.values(weights)[0] === 1
  })
  if (!loaded) throw new Error('recovery tests require a loaded fixture')
  const loadedSlug = Object.keys(musclesOf(loaded))[0]
  const stampedWorkout = ({ id, start, unit, weight, target, bw, reps = 8, rir }) => ({
    d: new Date(start).toISOString(), start, unit, bw,
    entries: [{ id, target, sets: [rir === undefined ? { done: true, w: weight, r: reps } : { done: true, w: weight, r: reps, rir }] }],
  })
  // A prior 80x10 (RIR 5: an e1RM, no stimulus) and a current unrated 80x6: the estimate, not
  // the fallback, decides the stimulus.
  const history = (unitOf, weightOf) => [
    stampedWorkout({ id: loaded.id, start: NOW - DAY, unit: unitOf(0), weight: weightOf(0), reps: 10, rir: 5 }),
    stampedWorkout({ id: loaded.id, start: NOW, unit: unitOf(1), weight: weightOf(1), reps: 6 }),
  ]
  const KG = () => 80
  const LB = () => 80 / LB_TO_KG

  it('gives kg and physically equivalent stamped-pound histories the same fatigue', () => {
    const kg = fatigueOf(history(() => 'kg', KG), NOW, { unit: 'kg' })[loadedSlug]
    expect(fatigueOf(history(() => 'lb', LB), NOW, { unit: 'kg' })[loadedSlug]).toBeCloseTo(kg, 6)
    // guard: the estimate engaged (RIR 10 - 6 = 4 -> 0.25 effective sets), not the fallback
    expect(setsOf(kg)).toBeCloseTo(0.25, 6)
  })

  it('normalizes mixed stamped units before estimating RIR', () => {
    const kg = fatigueOf(history(() => 'kg', KG), NOW, { unit: 'kg' })[loadedSlug]
    const mixed = history(i => (i ? 'lb' : 'kg'), i => (i ? LB() : 80))
    expect(fatigueOf(mixed, NOW, { unit: 'kg' })[loadedSlug]).toBeCloseTo(kg, 6)
  })

  it('treats an unstamped legacy history as being in the profile unit', () => {
    const kg = fatigueOf(history(() => 'kg', KG), NOW, { unit: 'kg' })[loadedSlug]
    const legacyLb = history(() => undefined, LB)
    expect(fatigueOf(legacyLb, NOW, { unit: 'lb' })[loadedSlug]).toBeCloseTo(kg, 6)
  })

  it('uses configured bodyweight for a non-catalogue bodyweight target', () => {
    const workout = stampedWorkout({
      id: loaded.id, start: NOW, unit: 'kg', weight: 0,
      target: { bodyweight: true }, bw: 80,
    })
    expect(fatigueOf([workout], NOW, { unit: 'kg' })[loadedSlug]).toBeGreaterThan(0)
    expect(strengthOf([workout], NOW, { unit: 'kg' })[loadedSlug]).toBe(1)
  })

  it('lets explicitly configured custom bodyweight work reset strength', () => {
    const id = 'recovery-custom-bodyweight'
    registerCustom([{ id, n: 'Custom bodyweight', bp: 'chest', tg: 'chest', eq: 'custom', sm: [] }])
    try {
      const workout = stampedWorkout({ id, start: NOW, unit: 'kg', weight: 0, bw: 80, target: { bodyweight: true } })
      expect(fatigueOf([workout], NOW, { unit: 'kg' }).chest).toBeGreaterThan(0)
      expect(strengthOf([workout], NOW, { unit: 'kg' }).chest).toBe(1)
    } finally {
      registerCustom([])
    }
  })

  it('treats a future-dated workout as its own timestamp, never amplified', () => {
    const future = doneWorkoutAt(SINGLE.id, NOW + 10 * DAY, 5)
    const present = doneWorkoutAt(SINGLE.id, NOW, 5)
    const futureValue = fatigueOf([future], NOW)[SINGLE_SLUG]
    expect(futureValue).toBeCloseTo(fatigueOf([present], NOW)[SINGLE_SLUG], 10)
    expect(futureValue).toBeLessThan(1)
  })

  it('counts a default custom zero-load ring push-up at the fallback RIR', () => {
    const id = 'recovery-ring-push-up'
    registerCustom([{ id, n: 'Ring push-up', bp: 'chest', tg: 'chest', eq: 'custom', sm: [] }])
    try {
      const workout = workoutAt(id, NOW, [
        { done: true, w: 0, r: 20 },
        { done: true, w: 0, r: 20 },
      ])
      expect(fatigueOf([workout], NOW).chest).toBeCloseTo(expectedFatigue(2 * FALLBACK_SETS), 10)
      expect(strengthOf([workout], NOW).chest).toBe(1)
    } finally {
      registerCustom([])
    }
  })
})

describe('workout time for date and fatigue questions', () => {
  // Every date is built with the local Date constructor, so these hold in any timezone.
  const localAt = (y, m, d, h) => new Date(y, m - 1, d, h).getTime()

  it('keeps a start that falls on the workout day', () => {
    const start = localAt(2026, 3, 10, 18)
    expect(workoutTime({ d: '2026-03-10', start })).toBe(start)
  })

  it('uses local noon of d when start falls on another local day', () => {
    // marked done on the 12th for the 10th: the old markDone stamped the marking time
    expect(workoutTime({ d: '2026-03-10', start: localAt(2026, 3, 12, 9) })).toBe(localAt(2026, 3, 10, 12))
  })

  it('falls back to local noon of d, not UTC midnight, when start is missing', () => {
    const time = workoutTime({ d: '2026-03-10' })
    expect(time).toBe(localAt(2026, 3, 10, 12))
    expect(isoOf(new Date(time))).toBe('2026-03-10')
    expect(localNoonOf('2026-03-10')).toBe(time)
  })

  it('keeps start when d is not a plain calendar day it can be compared with', () => {
    expect(workoutTime({ d: new Date(5000).toISOString(), start: 5000 })).toBe(5000)
    expect(localNoonOf('2026-03-10T00:00:00.000Z')).toBeNull()
  })

  it('decays a day marked done four days later exactly like the same day logged live', () => {
    const now = localAt(2026, 3, 14, 15)
    const iso = '2026-03-10'
    const sets = [{ done: true, w: 80, r: 8 }, { done: true, w: 80, r: 8 }]
    const live = { d: iso, start: localNoonOf(iso), end: localNoonOf(iso) + HOUR, entries: [{ id: WEIGHTED.id, sets }] }
    // a record the old markDone already saved: stamped an hour before it was marked, today
    const legacy = { d: iso, start: now - HOUR, end: now, entries: [{ id: WEIGHTED.id, sets }] }
    // a record the fixed markDone saves today for the same day
    const marked = markedDoneWorkout(iso, { id: 'r', ex: [{ id: WEIGHTED.id, sets: 2, reps: 8, weight: 80 }] }, { id: 'm', name: 'r', now })

    const expected = fatigueOf([live], now)
    expect(fatigueOf([legacy], now)).toEqual(expected)
    expect(fatigueOf([marked], now)).toEqual(expected)
    expect(strengthOf([legacy], now)).toEqual(strengthOf([live], now))
    // four and a bit days of decay, not the near-zero age of the marking time
    expect(expected[WEIGHTED_PRIMARY_SLUG]).toBeCloseTo(
      expectedFatigue(2 * FALLBACK_SETS, now - localNoonOf(iso), HL(WEIGHTED_PRIMARY_SLUG)),
      10,
    )
  })

  it('never lets a start in the future decay a stimulus by more than 1', () => {
    const ahead = NOW + 2 * HOUR
    const future = { d: isoOf(new Date(ahead)), start: ahead, entries: [{ id: SINGLE.id, sets: [{ done: true, w: 80, r: 8 }] }] }
    const present = { d: isoOf(new Date(NOW)), start: NOW, entries: [{ id: SINGLE.id, sets: [{ done: true, w: 80, r: 8 }] }] }
    const value = fatigueOf([future], NOW)[SINGLE_SLUG]
    expect(value).toBe(fatigueOf([present], NOW)[SINGLE_SLUG])
    expect(value).toBeCloseTo(expectedFatigue(FALLBACK_SETS), 10)
    expect(strengthOf([future], NOW)[SINGLE_SLUG]).toBe(1)
  })
})
