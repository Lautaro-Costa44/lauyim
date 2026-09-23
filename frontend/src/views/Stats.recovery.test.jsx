import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MUSCLES, levelsOf, musclesOf } from '../lib/muscles.js'
import { EXIDX } from '../lib/exercises.js'
import { FATIGUE_MODEL, FATIGUE_STATES, STRENGTH_FLOOR, fatigueHalfLifeMs } from '../lib/recovery.js'
import { FATIGUE_LEVELS, fatigueStateOf } from '../lib/recovery-view.js'
import Stats from './Stats.jsx'

const DAY = 86400000
const HOUR = 3600000
const BASE_NOW = Date.UTC(2026, 0, 22, 12)

const mocks = vi.hoisted(() => ({
  maps: [],
  mapMounts: 0,
  S: {
    unit: 'kg', body: 'male', effort: 'rir', targetW: null,
    bodyweight: [], routines: [], workouts: [],
  },
}))

vi.mock('../store/useStore.js', () => ({
  useStore: Object.assign(selector => selector({ S: mocks.S }), {
    getState: () => ({ S: mocks.S })
  }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {},
  WorkoutRow: () => React.createElement('div'), bwDeltaColor: () => 'inherit',
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/Icon.jsx', () => ({ default: props => React.createElement('span', props) }))
vi.mock('../components/BodyMap.jsx', () => ({
  default: props => {
    mocks.maps.push(props)
    React.useEffect(() => {
      mocks.mapMounts += 1
      return () => {}
    }, [])
    return React.createElement(
      'div',
      { 'data-body-map': true, 'data-selected-muscle': props.selected || '' },
      React.createElement('button', {
        'data-muscle': 'chest',
        onClick: () => props.onMuscle?.('chest'),
      }, 'Chest'),
    )
  },
  BodyMapLegend: () => React.createElement('div', { 'data-balance-legend': true }),
}))

let root
let container

function iso(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function set(done, extra = {}) {
  return { done, w: 80, r: 8, unit: 'kg', ...extra }
}

function workout(id, start, entries) {
  return { id, d: iso(start), start, unit: 'kg', entries }
}

function entry(id, sets) {
  return { id, sets }
}

function lifecycleWorkouts(now = BASE_NOW) {
  // Six RIR 0 sets: v0 = 6 x chest weight / K on the failure-extended chest half-life. Position
  // that stimulus 30 seconds before its .5 crossing so the real interval update flips it.
  const chestSets = 6 * musclesOf(EXIDX['1254']).chest
  const fatigueEdge = now - (
    fatigueHalfLifeMs('chest', 1) * Math.log2(chestSets / FATIGUE_MODEL.K / Math.LN2) - 30000
  )
  const balanceEdge = now - (30 * DAY - 30000)
  const strengthEdge = now - (14 * DAY - 30000)
  return [
    workout('fatigue-edge', fatigueEdge, [entry('1254', Array.from({ length: 6 }, () => set(true, { rir: 0 })))]),
    workout('balance-edge', balanceEdge, [entry('1254', [set(true, { rir: 2 })])]),
    workout('strength-edge', strengthEdge, [entry('1001', [set(true, { rir: 2 })])]),
    workout('abs-completed', now - 20 * DAY, [entry('1002', [set(true, { rir: 2 })])]),
    workout('abs-undone', now - DAY, [entry('1002', [set(false, { rir: 0 })])]),
  ]
}

function allFatiguedWorkout(now = BASE_NOW) {
  const ids = [
    '1018', '1012', '1167', '1013', '3011', '1413', '1399', '1016', '1005',
    '1010', '1003', '1001', '1511', '1494', '1002', '1000', '1396',
  ]
  return workout(
    'all-fatigued',
    now,
    ids.map(id => entry(id, Array.from({ length: 12 }, () => set(true)))),
  )
}

function allSubfullWorkout(now = BASE_NOW) {
  return workout('all-subfull', now - 15 * DAY, [entry('1254', [set(true)])])
}

function resetFixture(workouts = lifecycleWorkouts()) {
  mocks.S.unit = 'kg'
  mocks.S.bodyweight = []
  mocks.S.workouts = workouts
  mocks.maps.length = 0
  mocks.mapMounts = 0
}

function installDom() {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
}

async function mountStats() {
  installDom()
  await act(async () => { root.render(React.createElement(Stats)) })
}

async function unmountStats() {
  if (!root) return
  await act(async () => { root.unmount() })
  root = null
  container = null
}

function muscleCard() {
  return container.querySelector('[data-tour="muscle-card"]')
}

function fatigueLegend() {
  return container.querySelector('.hm-legend.hm-fatigue')
}

function buttonWithText(scope, text) {
  const aliases = { All: 'Todo', Hard: 'Duras', 'Fatigued': 'Fatigado', Recovering: 'En recuperación', Ready: 'Listo' }
  const labels = new Set([text, aliases[text]])
  return [...scope.querySelectorAll('button')].find(button => labels.has(button.textContent.trim()))
}

function viewButton(text) {
  const index = { 'Muscle balance': 0, Fatigue: 1, Strength: 2 }[text]
  return muscleCard().querySelectorAll('.seg-range')[0]?.querySelectorAll('button')[index]
}

function balanceRangeButton(text) {
  const index = { Week: 0, '30d': 1, '90d': 2, All: 3 }[text]
  return muscleCard().querySelectorAll('.seg-range')[1]?.querySelectorAll('button')[index]
}

async function click(button) {
  expect(button, `expected a button named ${button?.textContent || 'unknown'}`).toBeTruthy()
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

async function tick(milliseconds) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds) })
}

const lastMap = () => mocks.maps.at(-1)
const expectPressed = button => expect(button?.getAttribute('aria-pressed')).toBe('true')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE_NOW)
  resetFixture()
})

afterEach(async () => {
  await unmountStats()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Stats muscle recovery view runtime', () => {
  it('dispatches real clicks through Balance, Fatigue, and Strength and preserves selection', async () => {
    await mountStats()
    expectPressed(viewButton('Muscle balance'))
    expectPressed(balanceRangeButton('Week'))

    await click(balanceRangeButton('30d'))
    await click(buttonWithText(muscleCard(), 'All'))
    await click(muscleCard().querySelector('[data-muscle="chest"]'))
    expect(buttonWithText(muscleCard(), 'Hard')).toBeTruthy()

    await click(viewButton('Fatigue'))
    expectPressed(viewButton('Fatigue'))
    // the view paints the shared constant itself, so the map and the label cannot disagree
    expect(lastMap().thresholds).toBe(FATIGUE_LEVELS)
    // the legend shows every band the map can paint, not a three-step summary of it
    expect(fatigueLegend().querySelectorAll('.hm-c').length).toBe(FATIGUE_LEVELS.length)
    expect([...fatigueLegend().querySelectorAll('.hm-c')].map(node => node.className)).toEqual([
      'hm-c l4', 'hm-c l3', 'hm-c l2', 'hm-c l1', 'hm-c l0',
    ])
    expect(fatigueLegend().textContent).toBe('FatigadoEn recuperaciónListo')
    expect(container.textContent).toContain('La fatiga estima cuánto le falta recuperarse a cada músculo según el volumen y el esfuerzo de tus entrenos recientes.')
    expect(container.querySelector('[data-selected-muscle="chest"]')).toBeTruthy()

    await click(viewButton('Strength'))
    expectPressed(viewButton('Strength'))
    expect(lastMap().thresholds.at(-1)).toEqual({ at: 1, level: 4 })
    expect(container.textContent).toContain('La fuerza muestra cuánta fuerza muscular se conserva')

    await click(viewButton('Muscle balance'))
    expectPressed(balanceRangeButton('30d'))
    expect(buttonWithText(muscleCard(), 'Hard')).toBeTruthy()
    expect(lastMap().selected).toBe('chest')
    expect(lastMap().load.chest).toBe(7)
  })

  it('updates the rendered Fatigue map and Balance window on the real 60-second interval', async () => {
    await mountStats()
    await click(balanceRangeButton('30d'))
    await click(viewButton('Fatigue'))
    await click(muscleCard().querySelector('[data-muscle="chest"]'))

    const mountsBeforeTick = mocks.mapMounts
    const beforeTick = lastMap().load.chest
    expect(fatigueStateOf(beforeTick)).toBe(FATIGUE_STATES.FATIGUED)
    expect(container.textContent).toContain('Fatigado')

    await tick(60000)

    const afterTick = lastMap().load.chest
    expect(mocks.mapMounts).toBe(mountsBeforeTick)
    expect(afterTick).toBeLessThan(beforeTick)
    expect(fatigueStateOf(afterTick)).toBe(FATIGUE_STATES.RECOVERING)
    expect(container.textContent).toContain('En recuperación')

    await click(viewButton('Strength'))
    expect(lastMap().load.quadriceps).toBeLessThan(1)
    await click(viewButton('Muscle balance'))
    expect(lastMap().load.chest).toBe(6)
  })

  it('derives a pound-profile bodyweight in kg and passes it into the rendered Fatigue map', async () => {
    // A prior session stamped at 100 kg bodyweight: 100 x 12 at RIR 5 leaves an e1RM of 140 kg
    // and no stimulus of its own.
    const prior = { ...workout('prior', BASE_NOW - DAY, [entry('0001', [{ done: true, w: 0, r: 12, rir: 5 }])]), bw: 100 }
    const bodyweightWorkout = workout('bodyweight', BASE_NOW, [
      entry('0001', [{ done: true, w: 0, r: 8 }]),
    ])
    resetFixture([prior, bodyweightWorkout])
    mocks.S.unit = 'lb'
    mocks.S.bodyweight = [{ d: '2026-01-20', w: 180 }, { d: '2026-01-22', w: 220.462262 }]

    await mountStats()
    await click(viewButton('Fatigue'))

    // 220.462262 lb ~= 100 kg: 100 x 8 against the 140 kg prior e1RM is RIR 12 - 8 = 4, so 0.25
    // effective sets. Every wrong bodyweight lands elsewhere: 220.46 read as kg is RIR 0 (1 set),
    // the stale 180 lb entry (81.6 kg) or the 75 kg default is RIR 10 (0 sets), and losing the
    // prior e1RM is the RIR 2 fallback (0.75 sets).
    expect(lastMap().load.abs).toBeCloseTo(1 - Math.exp(-0.25 / FATIGUE_MODEL.K), 6)
    expect(lastMap().thresholds).toBeTruthy()
  })

  it('renders fixed absolute bands through the actual Fatigue and Strength views', async () => {
    resetFixture([allFatiguedWorkout()])
    await mountStats()
    await click(viewButton('Fatigue'))
    const fatigueMap = lastMap()
    expect(Object.keys(fatigueMap.load)).toEqual(MUSCLES)
    expect(Object.values(fatigueMap.load).every(value => value > 0.5)).toBe(true)
    expect(Object.values(levelsOf(fatigueMap.load, fatigueMap.thresholds)).every(level => level === 4)).toBe(true)

    await unmountStats()
    resetFixture([allSubfullWorkout()])
    await mountStats()
    await click(viewButton('Strength'))
    const strengthMap = lastMap()
    expect(Object.values(strengthMap.load).every(value => value < 1)).toBe(true)
    expect(Math.min(...Object.values(strengthMap.load))).toBe(STRENGTH_FLOOR)
    expect(strengthMap.thresholds.at(-1)).toEqual({ at: 1, level: 4 })
  })
})
