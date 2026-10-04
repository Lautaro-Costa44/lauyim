// La racha, caso por caso: cuenta nueva, sin plan, con plan, días (no entrenos), el plan con el que
// empezó cada semana, grupos de rutinas, bordes de fecha, la mejor racha y el resumen de la hoja.
import { describe, expect, it } from 'vitest'
import { evalWeek, weeklyTarget, streakWeeks, bestStreak, streakSummary, stampWeekTargets, streakLevel, nextStreakLevel } from './history.js'

let n = 0
const W = (d, extra) => ({ id: `w${++n}`, d, start: Date.parse(d + 'T18:00:00'), end: Date.parse(d + 'T19:00:00'), entries: [], ...extra })
const CLASS = d => W(d, { kind: 'class', name: 'Spinning' })
const mon = iso => new Date(iso + 'T12:00:00')
const NOW = new Date('2026-10-07T12:00:00')   // miércoles; esta semana empieza el lunes 5/10
const R = [{ id: 'a', name: 'Piernas' }, { id: 'b', name: 'Torso' }, { id: 'c', name: 'Full' }]
const PLAN3 = { 1: 'a', 3: 'b', 5: 'c' }
const PLAN5 = { 1: 'a', 2: 'b', 3: 'c', 4: 'a', 5: 'b' }
const state = (extra = {}) => ({ routines: R, week: {}, dayPlan: {}, workouts: [], ...extra })
// Los tres días de entreno de una semana de plan de 3 (lunes, miércoles y viernes).
const week3 = (mondayIso, extra) => {
  const m = mon(mondayIso)
  return [0, 2, 4].map(i => { const d = new Date(m); d.setDate(m.getDate() + i); return W(d.toISOString().slice(0, 10), extra) })
}
// Simula un update del store: agrega los entrenos y los sella como lo hace useStore.update.
const add = (S, ...ws) => { const after = { ...S, workouts: [...S.workouts, ...ws.map(w => ({ ...w }))] }; stampWeekTargets(S, after); return after }

describe('cuenta nueva', () => {
  it('sin nada (ni estado, ni rutinas, ni entrenos): racha 0', () => {
    for (const S of [undefined, null, {}, { workouts: [] }, state()]) {
      expect(streakWeeks(S, NOW)).toBe(0)
      expect(bestStreak(S, NOW)).toBe(0)
    }
    const r = streakSummary(state(), NOW)
    expect([r.streak, r.best, r.level, r.next]).toEqual([0, 0, 0, 1])
    expect(r.current).toMatchObject({ done: 0, target: 1, left: 1, complete: false, pendingDays: [] })
  })

  it('con plan armado pero sin entrenar: racha 0 (armar el plan no suma)', () => {
    const S = state({ week: PLAN3 })
    expect(streakWeeks(S, NOW)).toBe(0)
    expect(streakSummary(S, NOW).current).toMatchObject({ done: 0, target: 3, left: 3, pendingDays: ['2026-10-07', '2026-10-09'] })
  })
})

describe('sin plan: un día de entreno cumple la semana', () => {
  it('un entreno libre o una clase esta semana: racha 1', () => {
    expect(streakWeeks(add(state(), W('2026-10-06')), NOW)).toBe(1)
    expect(streakWeeks(add(state(), CLASS('2026-10-06')), NOW)).toBe(1)
  })

  it('dos entrenos el mismo día cuentan como un día', () => {
    const S = add(state(), W('2026-10-06'), W('2026-10-06'))
    expect(evalWeek(S, mon('2026-10-05'))).toMatchObject({ rutinasCompletadas: 1, objetivoSemanal: 0, completa: true })
  })

  it('la semana de ahora sin entrenar todavía no corta la racha; la anterior vacía sí', () => {
    expect(streakWeeks(add(state(), W('2026-09-29')), NOW)).toBe(1)
    expect(streakWeeks(add(state(), W('2026-09-22')), NOW)).toBe(0)
  })
})

describe('con plan: cuentan los días entrenados', () => {
  const S = (...ws) => add(state({ week: PLAN3 }), ...ws)

  it('tres semanas cumplidas y esta en curso: 3', () => {
    expect(streakWeeks(S(...week3('2026-09-14'), ...week3('2026-09-21'), ...week3('2026-09-28'), W('2026-10-05')), NOW)).toBe(3)
  })

  it('esta semana cumplida suma: 4', () => {
    expect(streakWeeks(S(...week3('2026-09-14'), ...week3('2026-09-21'), ...week3('2026-09-28'), ...week3('2026-10-05')), NOW)).toBe(4)
  })

  it('tres entrenos el mismo día son 1 de 3', () => {
    const s = S(W('2026-10-05'), W('2026-10-05'), W('2026-10-05'))
    expect(evalWeek(s, mon('2026-10-05'))).toMatchObject({ rutinasCompletadas: 1, objetivoSemanal: 3, completa: false })
  })

  it('rutina y clase el mismo día suman un día; la clase de otro día suma otro', () => {
    const s = S(W('2026-10-05'), CLASS('2026-10-05'), CLASS('2026-10-06'))
    expect(evalWeek(s, mon('2026-10-05'))).toMatchObject({ rutinasCompletadas: 2, completa: false })
    expect(evalWeek(add(s, W('2026-10-08')), mon('2026-10-05')).completa).toBe(true)
  })

  it('una semana a medias en el medio corta la racha', () => {
    const s = S(...week3('2026-09-14'), W('2026-09-21'), W('2026-09-23'), ...week3('2026-09-28'))
    expect(streakWeeks(s, NOW)).toBe(1)
    expect(bestStreak(s, NOW)).toBe(1)
  })

  it('más días que el objetivo también cumple', () => {
    const s = S(...['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map(d => W(d)))
    expect(evalWeek(s, mon('2026-09-28'))).toMatchObject({ rutinasCompletadas: 5, objetivoSemanal: 3, completa: true })
  })

  it('cualquier día cuenta, no solo los del plan', () => {
    const s = S(W('2026-09-29'), W('2026-10-03'), W('2026-10-04'))   // martes, sábado y domingo
    expect(evalWeek(s, mon('2026-09-28')).completa).toBe(true)
  })

  it('saltar o reprogramar un día no baja el objetivo', () => {
    const rest = state({ week: PLAN3, dayPlan: { '2026-09-30': 'rest' } })
    expect(weeklyTarget(rest, mon('2026-09-28'))).toBe(3)
    const moved = state({ week: PLAN3, dayPlan: { '2026-09-30': { estado: 'descanso' }, '2026-10-01': { estado: 'rutina', rutinaId: 'b' } } })
    expect(weeklyTarget(moved, mon('2026-09-28'))).toBe(3)
  })
})

describe('cada semana sigue con el plan con el que empezó', () => {
  it('cambiar el plan a mitad de semana no cambia lo que pide esa semana', () => {
    let S = add(state({ week: PLAN3 }), W('2026-10-05'))
    expect(S.workouts[0].weekTarget).toBe(3)
    S = { ...S, week: PLAN5 }
    expect(weeklyTarget(S, mon('2026-10-05'))).toBe(3)
    // Un entreno nuevo de esa misma semana sigue con 3 (no con el 5 de ahora).
    S = add(S, W('2026-10-07'), W('2026-10-09'))
    expect(S.workouts.map(w => w.weekTarget)).toEqual([3, 3, 3])
    expect(evalWeek(S, mon('2026-10-05')).completa).toBe(true)
    // Aunque se borre el primero, la semana sigue pidiendo 3.
    expect(weeklyTarget({ ...S, workouts: S.workouts.slice(1) }, mon('2026-10-05'))).toBe(3)
  })

  it('la semana siguiente empieza con el plan nuevo', () => {
    let S = add(state({ week: PLAN3 }), ...week3('2026-09-28'))
    S = add({ ...S, week: PLAN5 }, W('2026-10-05'))
    expect(S.workouts.at(-1).weekTarget).toBe(5)
    expect(weeklyTarget(S, mon('2026-09-28'))).toBe(3)
    expect(weeklyTarget(S, mon('2026-10-05'))).toBe(5)
  })

  it('una semana que empezó sin plan se cumple con un día, aunque después se arme el plan', () => {
    let S = add(state(), W('2026-10-05'))
    expect(S.workouts[0].weekTarget).toBe(0)
    S = { ...S, week: PLAN3 }
    expect(evalWeek(S, mon('2026-10-05')).completa).toBe(true)
    // La que viene ya pide los 3 días del plan.
    expect(weeklyTarget(S, mon('2026-10-12'))).toBe(3)
  })

  it('una semana sin empezar muestra el plan de hoy', () => {
    expect(weeklyTarget(state({ week: PLAN5 }), mon('2026-10-12'))).toBe(5)
  })

  it('un entreno cargado con fecha de una semana vieja toma el objetivo que esa semana ya tenía', () => {
    const g3 = { id: 'g3', week: PLAN3, routines: [{ id: 'a' }] }
    const g5 = { id: 'g5', week: { 1: 'x', 2: 'x', 3: 'x', 4: 'x', 5: 'x' }, routines: [{ id: 'x' }] }
    // Semana vieja de g3 sin sellar (historial de antes); hoy el grupo activo es g5.
    const S = state({ routineGroups: [g3, g5], activeGroupId: 'g5', week: g5.week, workouts: [W('2026-09-21', { routineId: 'a' })] })
    const after = add(S, W('2026-09-23'), CLASS('2026-10-06'))
    expect(after.workouts.slice(1).map(w => w.weekTarget)).toEqual([3, 5])
  })

  it('en una semana vieja vacía, el plan de ahora', () => {
    expect(add(state({ week: PLAN5 }), W('2026-09-02')).workouts[0].weekTarget).toBe(5)
  })

  it('no pisa el objetivo que trae un entreno de otro dispositivo', () => {
    const after = add(state({ week: PLAN5 }), W('2026-10-05', { weekTarget: 3 }))
    expect(after.workouts[0].weekTarget).toBe(3)
  })

  it('un entreno ya conocido no se vuelve a sellar', () => {
    const S = state({ week: PLAN5, workouts: [W('2026-10-05')] })
    const after = { ...S, workouts: S.workouts.map(w => ({ ...w })) }
    stampWeekTargets(S, after)
    expect(after.workouts[0].weekTarget).toBeUndefined()
  })
})

describe('grupos de rutinas', () => {
  const g3 = { id: 'g3', week: PLAN3, routines: [{ id: 'a' }] }
  const g2 = { id: 'g2', week: { 2: 'z', 4: 'z' }, routines: [{ id: 'z' }] }

  it('semana sin sellar: el grupo de su primera rutina, aunque antes haya una clase', () => {
    const S = state({ routineGroups: [g3, g2], activeGroupId: 'g2', week: g2.week, workouts: [CLASS('2026-09-28'), W('2026-09-29', { routineId: 'a' })] })
    expect(weeklyTarget(S, mon('2026-09-28'))).toBe(3)
  })

  it('una rutina que está en dos grupos: el objetivo más chico', () => {
    const shared = { id: 'gs', week: { 1: 'a', 2: 'a' }, routines: [{ id: 'a' }] }
    const S = state({ routineGroups: [g3, shared], workouts: [W('2026-09-28', { routineId: 'a' })] })
    expect(weeklyTarget(S, mon('2026-09-28'))).toBe(2)
  })

  it('grupos sin días: con un día alcanza', () => {
    const empty = { id: 'ge', week: {}, routines: [] }
    const S = add(state({ routineGroups: [empty], activeGroupId: 'ge' }), W('2026-10-05'))
    expect(S.workouts[0].weekTarget).toBe(0)
    expect(streakWeeks(S, NOW)).toBe(1)
  })
})

describe('bordes de fecha', () => {
  it('lunes 00:05: el domingo a la noche es de la semana anterior', () => {
    const S = add(state(), W('2026-10-04'))
    expect(streakWeeks(S, new Date('2026-10-05T00:05:00'))).toBe(1)
    expect(streakSummary(S, new Date('2026-10-05T00:05:00')).current.done).toBe(0)
  })

  it('domingo 23:59: lo de ese día cuenta para esa semana', () => {
    const S = add(state({ week: PLAN3 }), W('2026-09-28'), W('2026-09-30'), W('2026-10-04'))
    expect(streakWeeks(S, new Date('2026-10-04T23:59:00'))).toBe(1)
  })

  it('la hora de ahora no cambia nada', () => {
    const S = add(state({ week: PLAN3 }), ...week3('2026-09-21'), ...week3('2026-09-28'))
    for (const h of ['00:00', '00:30', '12:00', '23:30', '23:59']) expect(streakWeeks(S, new Date(`2026-10-07T${h}:00`))).toBe(2)
  })

  it('cruza el año: semanas de diciembre y enero seguidas', () => {
    const S = add(state(), W('2026-12-22'), W('2026-12-31'), W('2027-01-05'))
    expect(streakWeeks(S, new Date('2027-01-06T12:00:00'))).toBe(3)
  })

  it('entrenos desordenados o sin fecha no rompen nada', () => {
    const S = state({ workouts: [W('2026-10-01'), { id: 'x', entries: [] }, W('2026-09-22'), W('2026-09-29')] })
    expect(streakWeeks(S, NOW)).toBe(2)
    expect(bestStreak(S, NOW)).toBe(2)
  })

  it('un entreno con fecha futura no cuenta para esta semana', () => {
    const S = add(state(), W('2026-10-14'))
    expect(streakWeeks(S, NOW)).toBe(0)
  })
})

describe('mejor racha y color de la llama', () => {
  it('la mejor puede ser una vieja; la de ahora sigue aparte', () => {
    const S = add(state(), ...['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-09-21', '2026-09-28'].map(d => W(d)))
    expect([streakWeeks(S, NOW), bestStreak(S, NOW)]).toEqual([2, 4])
    expect(streakSummary(S, NOW)).toMatchObject({ streak: 2, best: 4, level: 1, next: 4 })
  })

  it('la de ahora es la mejor, contando esta semana si ya se cumplió', () => {
    const S = add(state(), ...['2026-09-21', '2026-09-28', '2026-10-05'].map(d => W(d)))
    expect([streakWeeks(S, NOW), bestStreak(S, NOW)]).toEqual([3, 3])
  })

  it('el color sube a las 1, 4, 12, 26 y 52 semanas', () => {
    expect([0, 1, 3, 4, 11, 12, 25, 26, 51, 52, 100].map(streakLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
    expect([0, 1, 4, 12, 26, 51, 52].map(nextStreakLevel)).toEqual([1, 4, 12, 26, 52, 52, null])
  })

  it('una racha larga (60 semanas seguidas)', () => {
    const ws = []
    const m = mon('2026-10-05')
    for (let i = 0; i < 60; i++) { const d = new Date(m); d.setDate(m.getDate() - 7 * i); ws.push(W(d.toISOString().slice(0, 10))) }
    const S = add(state(), ...ws)
    expect(streakSummary(S, NOW)).toMatchObject({ streak: 60, best: 60, level: 5, next: null })
  })
})

describe('resumen de esta semana (hoja de la llama)', () => {
  it('lo hecho, lo que falta y los días que quedan (rutina o clase reservada)', () => {
    const S = add(state({ week: PLAN3 }), W('2026-10-05'), CLASS('2026-10-05'))
    const r = streakSummary(S, NOW, { '2026-10-10': [{ name: 'Yoga', done: false }], '2026-10-05': [{ name: 'Spinning', done: true }] })
    expect(r.current).toMatchObject({ done: 1, target: 3, left: 2, complete: false })
    expect(r.current.pendingDays).toEqual(['2026-10-07', '2026-10-09', '2026-10-10'])
    expect(r.current.days.map(d => (d.done ? 'x' : d.planned ? 'p' : d.past ? '.' : '-') + (d.today ? '*' : ''))).toEqual(['x', '.', 'p*', '-', 'p', 'p', '-'])
    expect(r.current.days[5].classes.map(c => c.name)).toEqual(['Yoga'])
  })

  it('un día ya entrenado no figura como pendiente', () => {
    const r = streakSummary(add(state({ week: PLAN3 }), W('2026-10-07')), NOW)
    expect(r.current.pendingDays).toEqual(['2026-10-09'])
  })

  it('semana cumplida: no falta nada', () => {
    const r = streakSummary(add(state({ week: PLAN3 }), ...week3('2026-10-05')), new Date('2026-10-09T20:00:00'))
    expect(r.current).toMatchObject({ done: 3, target: 3, left: 0, complete: true })
  })
})
