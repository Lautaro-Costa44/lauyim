import { describe, expect, it } from 'vitest'
import { localDayStartOf, localNoonOf } from './format.js'
import { buildEditedWorkout, buildMarkedWorkout, columnsFor, dayMode, itemSummary, markedDraft, markedItem, markedRowOf, markedSetOf, modeTag, putWorkout } from './marked-workout.js'

const localAt = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const bench = { id: '0025', sets: 2, reps: 8, weight: 60 }
const routine = { id: 'push', name: 'Push A', ex: [bench, { id: '0024', sets: 3 }] }

describe('dayMode', () => {
  it('pasado, hoy o futuro respecto de hoy', () => {
    expect(dayMode('2026-10-04', '2026-10-05')).toBe('past')
    expect(dayMode('2026-10-05', '2026-10-05')).toBe('today')
    expect(dayMode('2026-10-06', '2026-10-05')).toBe('future')
  })
})

describe('columnsFor', () => {
  it('reps: kg y reps; con esfuerzo, la columna al final', () => {
    expect(columnsFor({ id: '0025' }, 'none')).toEqual(['w', 'r'])
    expect(columnsFor({ id: '0025' }, 'rir')).toEqual(['w', 'r', 'rir'])
    expect(columnsFor({ id: '0025' }, 'rpe')).toEqual(['w', 'r', 'rpe'])
  })
  it('tiempo: segundos y kg; cardio: minutos y velocidad, sin esfuerzo', () => {
    expect(columnsFor({ id: '0025', mode: 'time' }, 'rir')).toEqual(['sec', 'w', 'rir'])
    expect(columnsFor({ id: '0025', mode: 'cardio' }, 'rir')).toEqual(['min', 'speed'])
  })
})

describe('markedSetOf / markedRowOf', () => {
  it('pasa la fila a números, con coma decimal', () => {
    expect(markedSetOf({ w: '62,5', r: '8' }, { id: '0025' }, 'none')).toEqual({ done: true, w: 62.5, r: 8 })
  })
  it('una fila vacía o incompleta no es una serie', () => {
    expect(markedSetOf({}, { id: '0025' }, 'none')).toBeNull()
    expect(markedSetOf({ r: '8' }, { id: '0025' }, 'none')).toBeNull()            // reps con carga: falta el peso
    expect(markedSetOf({ w: 'abc', r: '8' }, { id: '0025' }, 'none')).toBeNull()
  })
  it('peso corporal: alcanzan las reps (w queda en 0)', () => {
    expect(markedSetOf({ r: '12' }, { id: '0025', bodyweight: true }, 'none')).toEqual({ done: true, r: 12, w: 0 })
  })
  it('el esfuerzo se guarda en su escala, y se topea', () => {
    expect(markedSetOf({ w: '60', r: '8', rir: '2' }, { id: '0025' }, 'rir')).toEqual({ done: true, w: 60, r: 8, rir: 2 })
    expect(markedSetOf({ w: '60', r: '8' }, { id: '0025' }, 'none')).toEqual({ done: true, w: 60, r: 8 })
    expect(markedSetOf({ w: '60', r: '8', rir: '14' }, { id: '0025' }, 'rir').rir).toBe(10)
  })
  it('tiempo y cardio', () => {
    expect(markedSetOf({ sec: '45' }, { id: '0025', mode: 'time' }, 'none')).toEqual({ done: true, sec: 45 })
    expect(markedSetOf({ min: '20', speed: '9,5' }, { id: '0025', mode: 'cardio' }, 'none')).toEqual({ done: true, min: 20, speed: 9.5 })
  })
  it('el esfuerzo cargado en la otra escala no se pierde ni se reescribe', () => {
    expect(markedSetOf({ w: '60', r: '8', rir: '2' }, { id: '0025' }, 'rpe')).toEqual({ done: true, w: 60, r: 8, rir: 2 })
    expect(markedSetOf({ w: '60', r: '8', rpe: '8' }, { id: '0025' }, 'none')).toEqual({ done: true, w: 60, r: 8, rpe: 8 })
    expect(markedSetOf({ w: '60', r: '8', rir: '2', rpe: '9' }, { id: '0025' }, 'rpe')).toEqual({ done: true, w: 60, r: 8, rpe: 9 })
  })
  it('markedRowOf vuelve a texto solo lo que tiene valor', () => {
    expect(markedRowOf({ done: true, w: 62.5, r: 8 })).toEqual({ w: '62.5', r: '8' })
  })
})

describe('buildMarkedWorkout', () => {
  const now = localAt(2026, 3, 14, 15)

  it('sin series: marca el día, sin inventar series ni duración', () => {
    const w = buildMarkedWorkout('2026-03-10', { routine, name: 'Push A' }, { id: 'x', now })
    expect(w).toMatchObject({ id: 'x', d: '2026-03-10', name: 'Push A', routineId: 'push', marked: true, entries: [], vol: 0 })
    expect(w.end).toBe(w.start)
    expect(w.muscleLoad.intensity).toBe('medium')
    expect(w.muscleLoad.muscles).toContain('chest')
    expect(w.muscleLoad.muscles).toContain('quadriceps')
    expect(w.muscleLoad.muscles).not.toContain('triceps')   // de apoyo en el press: no se fatiga como el principal
  })

  it('"Otra cosa": sin rutina ni carga muscular', () => {
    const w = buildMarkedWorkout('2026-03-10', { routine: null, name: 'Libre' }, { id: 'x', now })
    expect(w.routineId).toBeNull()
    expect(w.muscleLoad).toBeUndefined()
  })

  it('con series: guarda solo las cargadas, con su volumen, y no lleva muscleLoad', () => {
    const items = [
      { id: '0025', cfg: bench, rows: [{ w: '60', r: '8' }, {}, { w: '60', r: '7' }] },
      { id: '0024', cfg: { id: '0024', sets: 3 }, rows: [{}, {}] },
    ]
    const w = buildMarkedWorkout('2026-03-10', { routine, name: 'Push A', items }, { id: 'x', now })
    expect(w.entries).toEqual([{ id: '0025', target: { ...bench, id: '0025' }, sets: [{ done: true, w: 60, r: 8 }, { done: true, w: 60, r: 7 }] }])
    expect(w.vol).toBe(60 * 8 + 60 * 7)
    expect(w.muscleLoad).toBeUndefined()
  })

  it('la hora: mediodía; hoy antes del mediodía, una hora antes de ahora; nunca antes de medianoche', () => {
    expect(buildMarkedWorkout('2026-03-10', { name: 'x' }, { id: 'x', now }).start).toBe(localNoonOf('2026-03-10'))
    expect(buildMarkedWorkout('2026-03-14', { name: 'x' }, { id: 'x', now: localAt(2026, 3, 14, 9) }).start).toBe(localAt(2026, 3, 14, 8))
    expect(buildMarkedWorkout('2026-03-14', { name: 'x' }, { id: 'x', now: localAt(2026, 3, 14, 0, 30) }).start).toBe(localDayStartOf('2026-03-14'))
  })

  it('al editar un marcado: respeta la hora y la rutina que ya tenía', () => {
    const w = buildMarkedWorkout('2026-03-10', { routine: null, routineId: 'borrada', name: 'x' }, { id: 'x', now, start: 123 })
    expect(w.start).toBe(123)
    expect(w.end).toBe(123)
    expect(w.routineId).toBe('borrada')
  })
})

describe('markedDraft', () => {
  it('de una rutina: sus ejercicios con filas vacías, una por serie (mínimo una)', () => {
    const d = markedDraft({ routine: { id: 'r', ex: [{ id: '0025', sets: 2 }, { id: '0024' }] } })
    expect(d.map(i => [i.id, i.rows.length])).toEqual([['0025', 2], ['0024', 1]])
    expect(d[0].rows[0]).toEqual({})
    expect(new Set(d.map(i => i.key)).size).toBe(2)
  })
  it('de un marcado con series: lo que ya tenía, como texto', () => {
    const workout = { entries: [{ id: '0025', target: { id: '0025', sets: 3 }, sets: [{ done: true, w: 60, r: 8 }] }] }
    const d = markedDraft({ routine: { id: 'r', ex: [{ id: '0024', sets: 2 }] }, workout })
    expect(d.map(i => i.id)).toEqual(['0025'])
    expect(d[0].rows).toMatchObject([{ w: '60', r: '8' }])
  })
  it('sin rutina ni series: vacío', () => {
    expect(markedDraft({})).toEqual([])
  })
})

describe('markedItem', () => {
  it('un ejercicio del editor: config con su id y una fila vacía por serie', () => {
    const it = markedItem('0025', { sets: 2, reps: 8 })
    expect(it).toMatchObject({ id: '0025', cfg: { id: '0025', sets: 2, reps: 8 }, rows: [{}, {}] })
    expect(it.key).toBeTruthy()
  })
})

describe('itemSummary', () => {
  it('cuenta y describe solo las series completas', () => {
    expect(itemSummary({ id: '0025', cfg: { id: '0025' }, rows: [{ w: '80', r: '8' }, { w: '80' }, {}] }, 'none')).toEqual({ count: 1, text: '80×8' })
    expect(itemSummary({ id: '0025', cfg: { id: '0025' }, rows: [{}] }, 'none')).toEqual({ count: 0, text: '' })
  })
})

describe('putWorkout', () => {
  it('inserta en orden por hora, no al final', () => {
    const list = [{ id: 'a', d: '2026-03-01', start: localNoonOf('2026-03-01') }, { id: 'c', d: '2026-03-20', start: localNoonOf('2026-03-20') }]
    putWorkout(list, { id: 'b', d: '2026-03-10', start: localNoonOf('2026-03-10') })
    expect(list.map(w => w.id)).toEqual(['a', 'b', 'c'])
  })
  it('reemplaza el mismo id: conserva lo que no arma el editor (nota, objetivo de la semana) y saca la carga muscular', () => {
    const list = [{ id: 'm', d: '2026-03-10', start: 1, note: 'pesado', weekTarget: 3, muscleLoad: { muscles: ['chest'] }, entries: [] }]
    putWorkout(list, { id: 'm', d: '2026-03-10', start: 1, entries: [{ id: '0025', sets: [] }] })
    expect(list).toEqual([{ id: 'm', d: '2026-03-10', start: 1, note: 'pesado', weekTarget: 3, entries: [{ id: '0025', sets: [] }] }])
  })
  it('reemplazar con carga muscular nueva la actualiza', () => {
    const list = [{ id: 'm', d: '2026-03-10', start: 1, muscleLoad: { muscles: ['chest'] } }]
    putWorkout(list, { id: 'm', d: '2026-03-10', start: 1, muscleLoad: { muscles: ['quadriceps'] } })
    expect(list[0].muscleLoad.muscles).toEqual(['quadriceps'])
  })
})

describe('modeTag', () => {
  it('etiqueta del tipo de ejercicio, nada para reps con carga', () => {
    expect(modeTag({ id: '0025' })).toBeNull()
    expect(modeTag({ id: '0025', bodyweight: true })).toBe('peso corporal')
    expect(modeTag({ id: '0025', mode: 'time' })).toBe('tiempo')
    expect(modeTag({ id: '0025', mode: 'cardio' })).toBe('cardio')
  })
})

describe('editar un entreno ya hecho', () => {
  const warm = { done: true, w: 40, r: 10, warmup: true }
  const drop = { done: true, w: 80, r: 6, type: 'dropset', drops: [{ w: 60, r: 6 }] }
  const done = { id: 'w1', d: '2026-03-10', start: 100, end: 3700, name: 'Pull', routineId: 'r', note: 'ok', prs: ['0025'], weekTarget: 3, vol: 0,
    entries: [{ id: '0025', note: 'agarre', target: { id: '0025', mode: 'reps' }, sets: [warm, { done: true, w: 80, r: 8, rir: 2 }, drop, { done: false, w: 80, r: 0 }] }] }

  it('el borrador muestra solo las series de trabajo hechas; lo demás queda guardado aparte', () => {
    const [it] = markedDraft({ workout: done })
    expect(it.rows.map(r => [r.w, r.r])).toEqual([['80', '8'], ['80', '6']])
    expect(it.keep).toEqual([warm, { done: false, w: 80, r: 0 }])
  })

  it('corrige valores y conserva calentamientos, drop sets, notas, hora y lo demás del entreno', () => {
    const items = markedDraft({ workout: done })
    items[0].rows[0] = { ...items[0].rows[0], w: '85' }
    const w = buildEditedWorkout(done, items, 'rir')
    expect(w).toMatchObject({ id: 'w1', start: 100, end: 3700, note: 'ok', prs: ['0025'], weekTarget: 3, routineId: 'r' })
    expect(w.marked).toBeUndefined()
    expect(w.entries[0].note).toBe('agarre')
    expect(w.entries[0].sets).toEqual([warm, { done: true, w: 85, r: 8, rir: 2 }, drop, { done: false, w: 80, r: 0 }])
    expect(w.vol).toBe(85 * 8 + 80 * 6 + 60 * 6)
  })

  it('un valor vaciado se borra de la serie; una serie vacía se borra', () => {
    const items = markedDraft({ workout: done })
    items[0].rows[0] = { ...items[0].rows[0], rir: '' }
    items[0].rows[1] = { orig: items[0].rows[1].orig }
    const w = buildEditedWorkout(done, items, 'rir')
    expect(w.entries[0].sets).toEqual([warm, { done: true, w: 80, r: 8 }, { done: false, w: 80, r: 0 }])
  })

  it('un ejercicio cambiado o nuevo entra sin lo del anterior; uno sin series de trabajo sale', () => {
    const items = [{ ...markedItem('0024', { sets: 1 }), rows: [{ w: '100', r: '5' }] }]
    const w = buildEditedWorkout(done, items, 'none')
    expect(w.entries).toEqual([{ id: '0024', target: { id: '0024', sets: 1 }, sets: [{ done: true, w: 100, r: 5 }] }])
    expect(buildEditedWorkout(done, [{ ...markedDraft({ workout: done })[0], rows: [] }], 'none').entries).toEqual([])
  })
})

describe('editar un entreno ya hecho: récords, orden y rest-pause', () => {
  const t0 = Date.parse('2026-03-10T15:00:00Z')
  const before = [{ id: 'p', d: '2026-03-03', start: t0 - 7 * 864e5, entries: [{ id: '0025', sets: [{ done: true, w: 100, r: 5 }] }] }]

  it('recalcula los récords contra los entrenos anteriores: un peso corregido deja de ser récord', () => {
    const w0 = { id: 'w', d: '2026-03-10', start: t0, prs: ['0025'], entries: [{ id: '0025', sets: [{ done: true, w: 800, r: 5 }] }] }
    const items = markedDraft({ workout: w0 })
    items[0].rows[0] = { ...items[0].rows[0], w: '80' }
    expect(buildEditedWorkout(w0, items, 'none', { before }).prs).toEqual([])
    items[0].rows[0] = { ...items[0].rows[0], w: '105' }
    expect(buildEditedWorkout(w0, items, 'none', { before }).prs).toEqual(['0025'])
  })

  it('un récord de un ejercicio que se quitó o cambió desaparece', () => {
    const w0 = { id: 'w', d: '2026-03-10', start: t0, prs: ['0025'], entries: [{ id: '0025', sets: [{ done: true, w: 120, r: 5 }] }] }
    const items = [{ ...markedItem('0024', {}), rows: [{ w: '60', r: '5' }] }]
    expect(buildEditedWorkout(w0, items, 'none', { before }).prs).toEqual(['0024'])
  })

  it('cada serie queda en su lugar: calentamientos y series sin completar no se mueven', () => {
    const warm = { done: true, w: 40, r: 10, warmup: true }
    const undone = { done: false, w: 80, r: 0 }
    const a = { done: true, w: 80, r: 8 }, b = { done: true, w: 80, r: 6 }
    const w0 = { id: 'w', d: '2026-03-10', start: t0, entries: [{ id: '0025', sets: [a, undone, warm, b] }] }
    const items = markedDraft({ workout: w0 })
    items[0].rows[1] = { ...items[0].rows[1], r: '7' }
    items[0].rows.push({ w: '70', r: '10' })
    expect(buildEditedWorkout(w0, items, 'none').entries[0].sets).toEqual([a, undone, warm, { done: true, w: 80, r: 7 }, { done: true, w: 70, r: 10 }])
  })

  it('rest-pause: si cambian las reps, los bloques se rearman con el mismo descanso', () => {
    const rp = { done: true, w: 60, r: 12, type: 'restpause', clusters: [{ r: 8, restSec: 20 }, { r: 2, restSec: 20 }, { r: 2, restSec: 20 }] }
    const w0 = { id: 'w', d: '2026-03-10', start: t0, entries: [{ id: '0025', sets: [rp] }] }
    const items = markedDraft({ workout: w0 })
    items[0].rows[0] = { ...items[0].rows[0], r: '10' }
    const set = buildEditedWorkout(w0, items, 'none').entries[0].sets[0]
    expect(set.r).toBe(10)
    expect(set.clusters.reduce((n, c) => n + c.r, 0)).toBe(10)
    expect(set.clusters.every(c => c.restSec === 20)).toBe(true)
    items[0].rows[0] = { ...items[0].rows[0], r: '12', w: '65' }
    expect(buildEditedWorkout(w0, items, 'none').entries[0].sets[0].clusters).toEqual(rp.clusters)   // mismas reps: no se tocan
  })
})
