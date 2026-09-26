import { describe, expect, it } from 'vitest'
import { totalSets, muscleLoad, presetStats, programStats, COVERAGE_LEVELS } from './presetStats.js'
import { levelsOf } from './muscles.js'

// 0025 = barbell bench press (chest); 0043 = barbell full squat (legs).
const BENCH = { id: '0025', sets: 4, reps: 8, weight: 60 }
const SQUAT = { id: '0043', sets: 3, reps: 10, weight: 80 }

describe('muscles and series', () => {
  it('counts planned series and the effective series per muscle, cardio left out', () => {
    expect(totalSets([BENCH, SQUAT, { id: 'cardio_bike', sets: 1, min: 20 }])).toBe(8)
    const load = muscleLoad([BENCH, { id: 'cardio_bike', sets: 1, min: 20 }])
    expect(load.chest).toBe(4)
    expect(load.quadriceps).toBeUndefined()
  })

  it('presetStats ranks the muscles it hits hardest first', () => {
    const s = presetStats({ ex: [BENCH] })
    expect(s).toMatchObject({ exercises: 1, sets: 4 })
    expect(s).not.toHaveProperty('minutes')
    expect(s.top[0]).toBe('chest')
  })

  it('programStats adds every day of the week together', () => {
    const s = programStats([{ ex: [BENCH] }, { ex: [BENCH, SQUAT] }])
    expect(s.days).toBe(2)
    expect(s.sets).toBe(11)
    expect(s.load.chest).toBe(8)
    expect(s).not.toHaveProperty('avgMinutes')
  })

  it('coverage uses a fixed weekly scale, not the busiest muscle', () => {
    const lv = levelsOf({ chest: 3, quadriceps: 12, 'upper-back': 20 }, COVERAGE_LEVELS)
    expect(lv.chest).toBe(1)
    expect(lv.quadriceps).toBe(3)
    expect(lv['upper-back']).toBe(4)
    expect(lv.biceps).toBe(0)
  })
})
