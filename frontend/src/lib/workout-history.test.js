// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { foldText, filterWorkouts, groupByMonth, previousEntry, compareWithPrevious, exerciseSeries, setRows, weekAdherence, entryVolume } from './workout-history.js'

const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const wk = (id, d, entries, extra = {}) => ({ id, d, start: Date.parse(d + 'T18:00:00Z'), end: Date.parse(d + 'T19:00:00Z'), name: 'Push', routineId: 'r1', vol: 1000, entries, ...extra })
const bench = sets => ({ id: 'bench', n: 'Press Banca', sets })
const squat = sets => ({ id: 'squat', n: 'Sentadilla', sets })

const W = [
  wk('a', '2026-08-30', [bench([set(55, 8)])]),
  wk('b', '2026-09-05', [bench([set(60, 8), set(60, 6)]), squat([set(100, 5)])], { routineId: 'r2' }),
  wk('c', '2026-09-12', [bench([set(0, 10, { phase: 'warmup' }), set(62.5, 6)])]),
  wk('d', '2026-09-20', [bench([set(60, 8)])]),
]

describe('filtros y agrupado', () => {
  it('búsqueda sin mayúsculas ni tildes; filtro por rutina', () => {
    expect(foldText('SENTÁDILLA')).toBe('sentadilla')
    expect(filterWorkouts(W, { query: 'sentadilla' }).map(w => w.id)).toEqual(['b'])
    expect(filterWorkouts(W, { query: 'PRESS banca' }).length).toBe(4)
    expect(filterWorkouts(W, { routineId: 'r2' }).map(w => w.id)).toEqual(['b'])
  })
  it('por mes, más nuevo primero, con totales', () => {
    const g = groupByMonth(W)
    expect(g.map(x => [x.key, x.count, x.vol])).toEqual([['2026-09', 3, 3000], ['2026-08', 1, 1000]])
    expect(g[0].workouts.map(w => w.id)).toEqual(['d', 'c', 'b'])
    expect(g[0].ms).toBe(3 * 3600000)
  })
})

describe('comparación con la vez anterior', () => {
  it('es la sesión anterior a la fecha del entreno abierto, no la última de todas', () => {
    const c = W[2]
    expect(previousEntry(W, c, 'bench').workout.id).toBe('b')
    const cmp = compareWithPrevious(W, c, c.entries[0])
    expect(cmp).toMatchObject({ date: '2026-09-05', weight: 2.5, reps: -2 })
    // Abrir un entreno viejo compara contra el previo a él.
    expect(compareWithPrevious(W, W[1], W[1].entries[0])).toMatchObject({ date: '2026-08-30', weight: 5, reps: 0 })
    expect(compareWithPrevious(W, W[0], W[0].entries[0])).toBeNull()
  })
  it('el calentamiento no cuenta ni para la serie más pesada ni para el volumen', () => {
    expect(entryVolume(W[2].entries[0])).toBe(62.5 * 6)
  })
})

describe('evolución del ejercicio', () => {
  it('1RM estimado por entreno, más viejo primero', () => {
    const s = exerciseSeries(W, 'bench', { id: 'bench' })
    expect(s.kind).toBe('e1rm')
    expect(s.points.map(p => p.d)).toEqual(['2026-08-30', '2026-09-05', '2026-09-12', '2026-09-20'])
    expect(s.points[1].y).toBeGreaterThan(s.points[0].y)
  })
  it('peso corporal: más reps; tiempo: más segundos', () => {
    expect(exerciseSeries([wk('x', '2026-09-01', [{ id: 'pu', sets: [set(0, 8), set(0, 11)] }])], 'pu', { id: 'pu', bodyweight: true }).points[0]).toMatchObject({ y: 11 })
    expect(exerciseSeries([wk('x', '2026-09-01', [{ id: 'pl', sets: [{ sec: 45, done: true }] }])], 'pl', { id: 'pl', mode: 'time' })).toMatchObject({ kind: 'sec', points: [{ y: 45 }] })
  })
})

describe('tabla de series', () => {
  it('calentamiento como C, numera solo las de trabajo, drop set con sus bajadas, esfuerzo', () => {
    const rows = setRows({ sets: [set(20, 10, { phase: 'warmup' }), set(60, 8, { rir: 2 }), set(55, 8, { type: 'dropset', drops: [{ w: 45, r: 6 }] }), { w: 99, r: 1, done: false }] })
    expect(rows.map(r => r.label)).toEqual(['C', '1', '2'])
    expect(rows[0].warm).toBe(true)
    expect(rows[1].effort).toEqual({ kind: 'RIR', v: 2 })
    expect(rows[2]).toMatchObject({ type: 'dropset', drops: [{ w: 45, r: 6 }] })
  })
})

describe('cumplimiento semanal (lunes a domingo, en el calendario del gym)', () => {
  // Semana del lunes 21/09 al domingo 27/09/2026; hoy jueves 24.
  const plan = { week: { 1: 'r1', 3: 'r1', 5: 'r1', 6: 'r2' }, dayPlan: {} }   // lun, mié, vie, sáb
  it('entrenó, planeado sin entrenar (pasado), pendiente y descanso; un día no planeado es ✓ extra', () => {
    const workouts = [{ d: '2026-09-21' }, { d: '2026-09-22' }]                 // lunes (planeado) y martes (extra)
    const r = weekAdherence({ workouts, ...plan }, '2026-09-24')
    expect(r.days.map(d => d.state)).toEqual(['done', 'done', 'missed', 'rest', 'pending', 'pending', 'rest'])
    expect(r.days[1].extra).toBe(true)
    expect(r).toMatchObject({ hasPlan: true, planned: 4, done: 1, pending: 2 })   // el extra no suma al denominador
    expect(r.days[3].today).toBe(true)
  })
  it('un override de descanso saca el día del plan; sin plan semanal, hasPlan false', () => {
    const r = weekAdherence({ workouts: [], ...plan, dayPlan: { '2026-09-25': { estado: 'descanso' } } }, '2026-09-24')
    expect(r.planned).toBe(3)
    expect(weekAdherence({ workouts: [], week: {}, dayPlan: {} }, '2026-09-24').hasPlan).toBe(false)
  })
})

describe('filtro de clases', () => {
  it('todo, solo entrenamientos o solo clases', () => {
    const ws = [{ id: 'a', entries: [] }, { id: 'b', kind: 'class', entries: [] }]
    expect(filterWorkouts(ws).map(w => w.id)).toEqual(['a', 'b'])
    expect(filterWorkouts(ws, { kind: 'workouts' }).map(w => w.id)).toEqual(['a'])
    expect(filterWorkouts(ws, { kind: 'classes' }).map(w => w.id)).toEqual(['b'])
  })
})
