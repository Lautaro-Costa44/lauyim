import { describe, expect, it } from 'vitest'
import { estimateMinutes, totalSets, muscleLoad, presetStats, programStats, COVERAGE_LEVELS } from './presetStats.js'
import { levelsOf } from './muscles.js'

// 0025 = barbell bench press (chest); 0043 = barbell full squat (legs).
const BENCH = { id: '0025', sets: 4, reps: 8, weight: 60 }
const SQUAT = { id: '0043', sets: 3, reps: 10, weight: 80 }

describe('estimateMinutes', () => {
  it('series × reps × 3 s + 90 s between series + 60 s between exercises, rounded to 5', () => {
    // bench: 4×24 s + 3×90 s = 366 s; squat: 3×30 s + 2×90 s = 270 s; + 60 s transition = 696 s ≈ 11.6 min
    expect(estimateMinutes([BENCH, SQUAT])).toBe(10)
  })

  it('timed series count their seconds; cardio is one block with no rest, with or without a mode', () => {
    expect(estimateMinutes([{ id: 'x', sets: 3, mode: 'time', sec: 60 }])).toBe(5)          // 180 + 180 = 360 s
    expect(estimateMinutes([{ id: 'cardio_bike', sets: 1, min: 20, speed: 8 }])).toBe(20)
    expect(estimateMinutes([{ id: 'unknown', sets: 1, min: 30, speed: 8, mode: 'reps' }])).toBe(30)
  })

  it('an empty routine is 0, never a made-up minimum', () => {
    expect(estimateMinutes([])).toBe(0)
    expect(estimateMinutes(null)).toBe(0)
  })
})

describe('muscles and series', () => {
  it('counts planned series and the effective series per muscle, cardio left out', () => {
    expect(totalSets([BENCH, SQUAT, { id: 'cardio_bike', sets: 1, min: 20 }])).toBe(8)
    const load = muscleLoad([BENCH, { id: 'cardio_bike', sets: 1, min: 20 }])
    expect(load.chest).toBe(4)
    expect(load.quadriceps).toBeUndefined()
  })

  it('presetStats ranks the muscles it hits hardest first', () => {
    const s = presetStats({ ex: [BENCH] })
    expect(s).toMatchObject({ exercises: 1, sets: 4, minutes: 5 })
    expect(s.top[0]).toBe('chest')
  })

  it('programStats adds every day of the week together', () => {
    const s = programStats([{ ex: [BENCH] }, { ex: [BENCH, SQUAT] }])
    expect(s.days).toBe(2)
    expect(s.sets).toBe(11)
    expect(s.load.chest).toBe(8)
    expect(s.avgMinutes).toBe(10)
  })

  it('coverage uses a fixed weekly scale, not the busiest muscle', () => {
    const lv = levelsOf({ chest: 3, quadriceps: 12, 'upper-back': 20 }, COVERAGE_LEVELS)
    expect(lv.chest).toBe(1)
    expect(lv.quadriceps).toBe(3)
    expect(lv['upper-back']).toBe(4)
    expect(lv.biceps).toBe(0)
  })
})
