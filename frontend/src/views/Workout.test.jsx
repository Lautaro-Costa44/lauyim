import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { bestWeightFor } from '../lib/history.js'

const mocks = vi.hoisted(() => {
  const state = {
    S: null,
    startRest: vi.fn(),
    stopRest: vi.fn(),
    startWork: vi.fn(),
    stopWork: vi.fn(),
    topWeightSheet: vi.fn(),
    workoutCompleteSheet: vi.fn(),
    confirmSheet: vi.fn(),
    closeStaleWorkout: vi.fn(),
    openSheet: vi.fn(),
    exercisePicker: vi.fn(),
  }
  state.storeSnapshot = () => ({
    S: state.S,
    user: null,
    // Mutates a copy, like the real store: a write to the rendered state instead of the draft
    // is lost here too (audit B2/B3).
    update: mut => { const next = JSON.parse(JSON.stringify(state.S)); mut(next); state.S = next },
  })
  state.uiSnapshot = () => ({
    work: null,
    sheets: [],
    startRest: state.startRest,
    stopRest: state.stopRest,
    startWork: state.startWork,
    stopWork: state.stopWork,
    openSheet: state.openSheet,
    toast: vi.fn(),
  })
  return state
})

vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.storeSnapshot())
  useStore.getState = mocks.storeSnapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = selector => selector ? selector(mocks.uiSnapshot()) : mocks.uiSnapshot()
  useUI.getState = mocks.uiSnapshot
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  startFlow: vi.fn(),
  exercisePicker: mocks.exercisePicker,
  exConfigSheet: vi.fn(),
  exerciseDetailSheet: vi.fn(),
  topWeightSheet: mocks.topWeightSheet,
  finishWorkout: vi.fn(),
  closeStaleWorkout: mocks.closeStaleWorkout,
  workoutCompleteSheet: mocks.workoutCompleteSheet,
  confirmSheet: mocks.confirmSheet,
  // Both note sheets belong here even though the tests never open one: Workout.jsx reads
  // sessionNoteSheet during render, so a missing export is a render crash, not a no-op.
  exerciseNoteSheet: vi.fn(),
  sessionNoteSheet: vi.fn(),
}))
vi.mock('../components/Media.jsx', () => ({ default: () => null, Thumb: () => null }))
// Real implementation, wrapped so a test can count how often the history is walked.
vi.mock('../lib/history.js', async importOriginal => {
  const orig = await importOriginal()
  return { ...orig, bestWeightFor: vi.fn(orig.bestWeightFor) }
})
// api.js reads navigator.userAgent at module scope. This file installs its own DOM inside the
// tests rather than declaring a vitest environment, so it must not depend on an ambient one.
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})),
  IS_APPLE: false, IS_ANDROID: false, BIO: 'biometrics',
}))

let dom
let root
let container

function exercise(id, sets, extra = {}) {
  return {
    id,
    target: { mode: 'reps', reps: 5, weight: 60, bodyweight: false },
    sets: sets.map(done => ({ w: 60, r: 5, min: 20, speed: 8, done })),
    ...extra,
  }
}

function workout(entries, cur = 0) {
  return {
    unit: 'kg', restSec: 90, sound: false, effort: 'none', gifSize: 'full',
    workouts: [], exWeights: {}, routines: [],
    active: { id: 'active', name: 'Test workout', start: Date.now(), cur, entries },
  }
}

function installDom() {
  const parsed = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  dom = parsed.window
  globalThis.window = dom
  globalThis.document = dom.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  for (const key of ['HTMLElement', 'Node', 'Element', 'Event', 'Blob']) globalThis[key] = dom[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.getElementById('root')
  root = createRoot(container)
}

async function mount(entries, cur = 0, extra = {}) {
  mocks.S = { ...workout(entries, cur), ...extra }
  installDom()
  await act(async () => { root.render(React.createElement(Workout)) })
}

async function unmount() {
  if (!root) return
  await act(async () => { root.unmount() })
  root = null
  container = null
  dom = null
}

async function toggleSet(index) {
  const checkbox = container.querySelectorAll('[role="checkbox"]')[index]
  expect(checkbox).toBeTruthy()
  await act(async () => { checkbox.dispatchEvent(new dom.Event('click', { bubbles: true })) })
}

beforeEach(() => {
  vi.clearAllMocks()
})

const click = async el => { await act(async () => { el.dispatchEvent(new dom.Event('click', { bubbles: true })) }) }
// Renders what the last openSheet call would show, so its buttons can be pressed.
let sheetRoot
async function openedSheet() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  sheetRoot = createRoot(host)
  await act(async () => { sheetRoot.render(mocks.openSheet.mock.calls.at(-1)[0](vi.fn())) })
  return host
}
afterEach(async () => { if (sheetRoot) await act(async () => { sheetRoot.unmount() }); sheetRoot = null })
const itemByText = (host, re) => [...host.querySelectorAll('.item')].find(el => re.test(el.textContent))

afterEach(async () => {
  await unmount()
})

describe('Workout set completion flow', () => {
  it('starts rest after a non-final ordinary set, but stops rest without restarting it on the final set', async () => {
    await mount([exercise('plain-bench', [false, false, false])])
    await toggleSet(0)

    expect(mocks.startRest).toHaveBeenCalledOnce()
    expect(mocks.startRest).toHaveBeenCalledWith(90)
    expect(mocks.stopRest).not.toHaveBeenCalled()

    await unmount()
    vi.clearAllMocks()
    await mount([exercise('plain-treadmill', [false], {
      target: { mode: 'cardio', min: 20, speed: 8 },
    })])
    await toggleSet(0)

    expect(mocks.stopRest).toHaveBeenCalledOnce()
    expect(mocks.startRest).not.toHaveBeenCalled()
  })

  it('leaves a completed superset selected while its top-weight sheet owns the advance choice', async () => {
    const group = 'superset-1'
    await mount([
      exercise('superset-a', [true, true, true], { sg: group, asked: true }),
      exercise('superset-b', [true, true, false], { sg: group }),
      exercise('next-exercise', [false, false, false]),
    ], 1)
    await toggleSet(5)

    expect(mocks.topWeightSheet).toHaveBeenCalledWith(1)
    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.startRest).toHaveBeenCalledWith(90)
  })
})

describe('session lifecycle (audit phase 1)', () => {
  const cardio = done => exercise('treadmill', [done], { target: { mode: 'cardio', min: 20, speed: 8 } })
  const hold = done => ({ id: 'plank', target: { mode: 'time', sec: 45 }, sets: [{ sec: 45, w: 0, done }] })

  it('checks for a stale session as soon as the workout screen mounts', async () => {
    await mount([exercise('bench', [false])])
    expect(mocks.closeStaleWorkout).toHaveBeenCalledOnce()
  })

  it('persists lastActivity on the session itself when a set is checked', async () => {
    await mount([exercise('bench', [false, false])])
    mocks.S.active.lastActivity = undefined
    await toggleSet(0)
    expect(mocks.S.active.lastActivity).toBeGreaterThan(0)
  })

  it('opens the finish prompt when the last set of the workout is cardio', async () => {
    await mount([exercise('bench', [true], { asked: true }), cardio(false)], 1)
    await toggleSet(0)
    expect(mocks.workoutCompleteSheet).toHaveBeenCalledOnce()
  })

  it('opens the finish prompt when the last set of the workout is a timed hold', async () => {
    await mount([hold(false)])
    await toggleSet(0)
    expect(mocks.workoutCompleteSheet).toHaveBeenCalledOnce()
  })

  it('does not reopen the finish prompt when the last set is unchecked and checked again', async () => {
    await mount([cardio(false)])
    await toggleSet(0)
    await toggleSet(0)
    await toggleSet(0)
    expect(mocks.workoutCompleteSheet).toHaveBeenCalledOnce()
  })

  it('discarding stops a hold that is still running', async () => {
    await mount([hold(false)])
    await click(container.querySelector('.hdr .iconbtn'))
    await click(itemByText(await openedSheet(), /Discard|Descartar/))
    expect(mocks.confirmSheet).toHaveBeenCalledOnce()
    await act(async () => { mocks.confirmSheet.mock.calls[0][0].onConfirm() })
    expect(mocks.stopWork).toHaveBeenCalled()
    expect(mocks.S.active).toBeNull()
  })

  it('a hold that ends after the session is gone does nothing instead of crashing', async () => {
    await mount([hold(false)])
    const go = container.querySelector('.setgo')
    await act(async () => { go.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(mocks.startWork).toHaveBeenCalledOnce()
    const onDone = mocks.startWork.mock.calls[0][2]
    mocks.S.active = null
    expect(() => onDone(30)).not.toThrow()
  })
})

describe('guards against losing or faking data (audit phase 2)', () => {
  const removeSetButton = () => [...container.querySelectorAll('button')].find(b => /Remove set|Quitar serie/.test(b.textContent))

  it('asks before removing a set that is already logged', async () => {
    await mount([exercise('bench', [true, true])])
    await click(removeSetButton())
    expect(mocks.confirmSheet).toHaveBeenCalledOnce()
    expect(mocks.S.active.entries[0].sets).toHaveLength(2)
    await act(async () => { mocks.confirmSheet.mock.calls[0][0].onConfirm() })
    expect(mocks.S.active.entries[0].sets).toHaveLength(1)
  })

  it('removes an unlogged set without asking', async () => {
    await mount([exercise('bench', [true, false])])
    await click(removeSetButton())
    expect(mocks.confirmSheet).not.toHaveBeenCalled()
    expect(mocks.S.active.entries[0].sets).toHaveLength(1)
  })

  it('asks before checking off an empty set, and checks it only on confirm', async () => {
    await mount([exercise('bench', [false, false], { sets: [{ w: 60, r: 0, done: false }, { w: 60, r: 5, done: false }] })])
    await toggleSet(0)
    expect(mocks.confirmSheet).toHaveBeenCalledOnce()
    expect(mocks.S.active.entries[0].sets[0].done).toBe(false)
    await act(async () => { mocks.confirmSheet.mock.calls[0][0].onConfirm() })
    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
  })

  it('does not ask for a bodyweight set with no added weight, or when unchecking', async () => {
    await mount([{ id: 'pushup', target: { mode: 'reps', reps: 10, bodyweight: true }, sets: [{ w: 0, r: 10, done: false }, { w: 0, r: 0, done: true }] }])
    await toggleSet(0)
    await toggleSet(1)
    expect(mocks.confirmSheet).not.toHaveBeenCalled()
    expect(mocks.S.active.entries[0].sets.map(s => s.done)).toEqual([true, false])
  })
})

describe('set rows (audit phase 5)', () => {

  it('removes a warm-up through its number instead of a ✕ in the row', async () => {
    await mount([exercise('bench', [false, false], {
      sets: [{ w: 30, r: 5, phase: 'warmup', done: false }, { w: 60, r: 5, done: false }],
    })])
    expect(container.querySelector('.setrow .iconbtn')).toBeNull()
    await click(container.querySelector('.setrow .n'))
    const menu = await openedSheet()
    expect(itemByText(menu, /Drop|Bajada/)).toBeUndefined()
    await click(itemByText(menu, /Remove set|Quitar serie/))
    expect(mocks.S.active.entries[0].sets).toHaveLength(1)
    expect(mocks.S.active.entries[0].sets[0].phase).toBeUndefined()
  })

  it('reaches + Drop / + Burst only through the set number, marked on the current set', async () => {
    await mount([exercise('bench', [true, false, false])])
    expect(container.querySelectorAll('.setextra')).toHaveLength(0)
    expect([...container.querySelectorAll('.setrow .n')].map(n => n.classList.contains('more'))).toEqual([false, true, false])
    await click(container.querySelectorAll('.setrow .n')[0])
    const menu = await openedSheet()
    await click(itemByText(menu, /Drop|Bajada/))
    expect(mocks.S.active.entries[0].sets[0].drops).toHaveLength(1)
  })

  it('shows the set-menu tip once, until a set menu is opened', async () => {
    const store = new Map()
    globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) }
    try {
      await mount([exercise('bench', [false, false])])
      expect(container.querySelector('.settip')).toBeTruthy()
      await click(container.querySelector('.setrow .n'))
      expect(container.querySelector('.settip')).toBeNull()
      await unmount()
      await mount([exercise('bench', [false, false])])
      expect(container.querySelector('.settip')).toBeNull()
    } finally {
      delete globalThis.localStorage
    }
  })

  it('logs effort by tapping the number and picking a value', async () => {
    await mount([exercise('bench', [false])], 0, { effort: 'rir' })
    const effv = container.querySelector('.setrow .effv')
    expect(effv.textContent).toBe('–')
    await click(effv)
    const picker = await openedSheet()
    const two = [...picker.querySelectorAll('.effpick .chip')].find(b => b.textContent === '2')
    await click(two)
    expect(mocks.S.active.entries[0].sets[0].rir).toBe(2)
  })
})

describe('header, strip and navigation (audit phase 6)', () => {
  const three = () => [exercise('a', [true]), exercise('b', [false], { sg: 'g' }), exercise('c', [false], { sg: 'g' }), exercise('d', [false])]
  const rerender = async () => { await act(async () => { root.render(React.createElement(Workout)) }) }

  it('keeps discarding behind the options menu instead of a ✕ in the header', async () => {
    await mount([exercise('bench', [false])])
    expect(container.querySelector('.hdr .iconbtn').getAttribute('aria-label')).not.toMatch(/Discard|Descartar/)
    await click(container.querySelector('.hdr .iconbtn'))
    expect(itemByText(await openedSheet(), /Discard|Descartar/)).toBeTruthy()
    expect(mocks.confirmSheet).not.toHaveBeenCalled()
  })

  it('shows one progress segment per unit, a superset counting once', async () => {
    await mount(three(), 1)
    const segs = [...container.querySelectorAll('.wseg-bar i')].map(i => i.className)
    expect(segs).toEqual(['done', 'cur', ''])
  })

  it('opens the strip from the progress bar (closed by default) and jumps to a unit', async () => {
    await mount(three())
    expect(container.querySelector('.xstrip')).toBeNull()
    await click(container.querySelector('.wseg'))
    const units = container.querySelectorAll('.xs-main')
    expect(units).toHaveLength(3)
    await click(units[2])
    expect(mocks.S.active.cur).toBe(3)
    await rerender()
    expect(container.querySelector('.xstrip')).toBeNull()
  })

  it('moves between units with the floating Prev / Next buttons', async () => {
    await mount(three())
    const [prev, next] = container.querySelectorAll('.wnav-b')
    expect(prev.disabled).toBe(true)
    await click(next)
    expect(mocks.S.active.cur).toBe(1)
  })
})

describe('replace and reorder from the strip (audit phase 7)', () => {
  const session = () => [exercise('0025', [true]), exercise('0047', [false], { sg: 'g' }), exercise('0251', [false], { sg: 'g' }), exercise('0334', [false])]
  const openStrip = async () => { await click(container.querySelector('.wseg')) }
  const unitMenu = async k => { await click(container.querySelectorAll('.xs-more')[k]); return openedSheet() }

  it('replaces an exercise picked from the library, keeping its superset slot', async () => {
    await mount(session(), 1)
    await openStrip()
    const menu = await unitMenu(1)
    await click(itemByText(menu, /Pick from the library|Elegir de la biblioteca/))
    expect(mocks.exercisePicker).toHaveBeenCalledOnce()
    await act(async () => { mocks.exercisePicker.mock.calls[0][0]({ id: '0652' }) })
    expect(mocks.confirmSheet).not.toHaveBeenCalled()
    expect(mocks.S.active.entries[1]).toMatchObject({ id: '0652', sg: 'g' })
    expect(mocks.S.active.entries[1].sets.every(s => !s.done)).toBe(true)
  })

  it('asks before replacing an exercise that has logged sets', async () => {
    await mount(session())
    await openStrip()
    await click(itemByText(await unitMenu(0), /Pick from the library|Elegir de la biblioteca/))
    await act(async () => { mocks.exercisePicker.mock.calls[0][0]({ id: '0652' }) })
    expect(mocks.confirmSheet).toHaveBeenCalledOnce()
    expect(mocks.S.active.entries[0].id).toBe('0025')
  })

  it('removes through the strip menu with the usual confirmation', async () => {
    await mount(session())
    await openStrip()
    await click(itemByText(await unitMenu(2), /^Remove$|^Quitar$/))
    expect(mocks.confirmSheet).toHaveBeenCalledOnce()
    await act(async () => { mocks.confirmSheet.mock.calls[0][0].onConfirm() })
    expect(mocks.S.active.entries.map(e => e.id)).toEqual(['0025', '0047', '0251'])
  })

  it('reorders whole units and keeps the current exercise selected', async () => {
    await mount(session(), 1)
    await openStrip()
    await click(container.querySelector('.xs-reorder'))
    const sheet = await openedSheet()
    const handle = sheet.querySelectorAll('.drag-handle')[0]
    const down = new dom.Event('keydown', { bubbles: true })
    Object.defineProperty(down, 'key', { value: 'ArrowDown' })
    await act(async () => { handle.dispatchEvent(down) })
    expect(mocks.S.active.entries.map(e => e.id)).toEqual(['0047', '0251', '0025', '0334'])
    expect(mocks.S.active.entries[0].sg).toBe('g')
    expect(mocks.S.active.cur).toBe(0)
  })
})

describe('moving on after a finished exercise (audit phase 8)', () => {
  const next = () => exercise('next', [false])

  it('moves to the next exercise after the last cardio interval, with the rest running', async () => {
    await mount([exercise('bike', [false], { target: { mode: 'cardio', min: 20, speed: 8 } }), next()])
    await toggleSet(0)
    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.startRest).toHaveBeenCalledWith(90)
  })

  it('does the same for a bodyweight exercise and for a lift whose weight was already confirmed', async () => {
    await mount([{ id: 'pushup', target: { mode: 'reps', reps: 10, bodyweight: true }, sets: [{ w: 0, r: 10, done: false }] }, next()])
    await toggleSet(0)
    expect(mocks.S.active.cur).toBe(1)

    await unmount()
    await mount([exercise('bench', [true, false], { asked: true }), next()])
    await toggleSet(1)
    expect(mocks.S.active.cur).toBe(1)
  })

  it('leaves the choice to the top-weight sheet when it opens', async () => {
    await mount([exercise('bench', [true, false]), next()])
    await toggleSet(1)
    expect(mocks.topWeightSheet).toHaveBeenCalledWith(0)
    expect(mocks.S.active.cur).toBe(0)
  })
})

describe('rest per exercise (audit phase 4)', () => {
  it('rests for the exercise’s own rest after a work set, and half after a warm-up', async () => {
    await mount([exercise('squat', [false, false], {
      target: { mode: 'reps', reps: 5, weight: 100, bodyweight: false, restSec: 180 },
      sets: [{ w: 50, r: 5, phase: 'warmup', done: false }, { w: 100, r: 5, done: false }, { w: 100, r: 5, done: false }],
    })])
    await toggleSet(0)
    expect(mocks.startRest).toHaveBeenLastCalledWith(90)
    await toggleSet(1)
    expect(mocks.startRest).toHaveBeenLastCalledWith(180)
  })
})

describe('performance (audit phase 3)', () => {
  it('walks the history once per added workout, not on every tap', async () => {
    const rerender = async () => { await act(async () => { root.render(React.createElement(Workout)) }) }
    await mount([exercise('bench', [false, false])])
    const before = bestWeightFor.mock.calls.length
    expect(before).toBeGreaterThan(0)

    await toggleSet(0)
    await rerender()
    expect(bestWeightFor.mock.calls.length).toBe(before)

    mocks.S = { ...mocks.S, workouts: [{ id: 'w-new', d: '2026-10-01', entries: [] }] }
    await rerender()
    expect(bestWeightFor.mock.calls.length).toBe(before + 1)
  })
})

describe('superset flow survives an exercise being removed mid-session', () => {
  // removeActiveExercise splices A.entries, shifting every index above the removal down.
  // The high-water marks are index-keyed, so without re-baselining the shifted exercise
  // inherits its predecessor's mark and its next completed set reads as an uncheck/re-check
  // — no advance, and no rest at the end of the round.
  it('still advances and rests for sets completed after a removal', async () => {
    // warm(2 sets, both done) ahead of a bench/row superset with nothing done yet.
    await mount([
      exercise('warm', [true, true]),
      exercise('bench', [false, false], { sg: 'g1' }),
      exercise('row', [false, false], { sg: 'g1' }),
    ], 1)

    // Drop the first exercise: bench moves 1 -> 0, row moves 2 -> 1.
    // Stale marks would be [2, 0, 0] against entries that are now [bench, row].
    await act(async () => {
      mocks.S.active.entries.splice(0, 1)
      mocks.S.active.cur = 0
      root.render(React.createElement(Workout))
    })
    mocks.startRest.mockClear()

    // First member of the group: real progress, so the flow advances to the partner.
    await toggleSet(0)
    await act(async () => { root.render(React.createElement(Workout)) })
    expect(mocks.S.active.cur).toBe(1)

    // Partner closes the round (each still has a second set), which is what starts the rest.
    await toggleSet(2)
    expect(mocks.startRest).toHaveBeenCalledWith(90)
  })
})
