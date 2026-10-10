import { describe, expect, it } from 'vitest'
import { addDays, canLogDate, caffeineRange, isTrainingDay, isDueOn, takenOn, streakOf, adherence30, dayLevel, caffeineTotal, isOverCaffeine, doseLabel, perTake, groupBySlot, adultStatus, itemName, overDose, sinceOf, startDay } from './suplementos.js'

const TODAY = '2026-10-09'
const crea = { id: 'i1', catalogId: 'creatina', dose: 5, unit: 'g', scoopG: 5, doses: 1, slot: 'morning', days: 'daily', status: 'active', createdAt: '2026-09-01T10:00:00Z' }
const beta = { id: 'i2', catalogId: 'betaalanina', dose: 3.2, unit: 'g', scoopG: null, doses: 2, slot: 'meals', days: 'daily', status: 'active', createdAt: '2026-09-01T10:00:00Z' }
const elec = { id: 'i3', catalogId: 'electrolitos', dose: 1, unit: 'dosis', scoopG: null, doses: 1, slot: 'pre', days: 'training', status: 'active', createdAt: '2026-09-01T10:00:00Z' }
const log = (itemId, date, extra = {}) => ({ id: Math.random().toString(36).slice(2), itemId, date, source: null, amount: 0, ...extra })
const always = () => true, never = () => false

describe('fechas', () => {
  it('hoy y hasta 7 días atrás, nunca el futuro', () => {
    expect(canLogDate(TODAY, TODAY)).toBe(true)
    expect(canLogDate(addDays(TODAY, -7), TODAY)).toBe(true)
    expect(canLogDate(addDays(TODAY, -8), TODAY)).toBe(false)
    expect(canLogDate(addDays(TODAY, 1), TODAY)).toBe(false)
  })
})

describe('cafeína', () => {
  it('rango con el peso, con techo de 400', () => {
    expect(caffeineRange(80)).toEqual({ min: 240, max: 400, dayMax: 400, singleRef: 200 })
    expect(caffeineRange(60)).toEqual({ min: 180, max: 360, dayMax: 400, singleRef: 200 })
    expect(caffeineRange(null)).toBeNull()
  })
  it('total del día: fuentes rápidas + items de cafeína', () => {
    const caf = { id: 'c', catalogId: 'cafeina', unit: 'mg', dose: 200, doses: 1, days: 'training', status: 'active' }
    const logs = [log(null, TODAY, { source: 'mate', amount: 80 }), log(null, TODAY, { source: 'cafe', amount: 90 }), log('c', TODAY, { amount: 200 }), log(null, addDays(TODAY, -1), { source: 'mate', amount: 80 })]
    expect(caffeineTotal(logs, [caf], TODAY)).toBe(370)
    expect(isOverCaffeine(400)).toBe(false); expect(isOverCaffeine(401)).toBe(true)
  })
})

describe('qué toca', () => {
  it('días de entreno: plan o workout registrado', () => {
    const S = { routines: [{ id: 'r' }], week: { 5: 'r' }, dayPlan: {}, workouts: [{ d: '2026-10-07', kind: 'class' }] }
    expect(isTrainingDay(S, '2026-10-09')).toBe(true)     // viernes con rutina
    expect(isTrainingDay(S, '2026-10-07')).toBe(true)     // miércoles con una clase hecha
    expect(isTrainingDay(S, '2026-10-08')).toBe(false)
  })
  it('diario siempre; de entreno solo esos días; archivado y antes del alta nunca', () => {
    expect(isDueOn(crea, TODAY, false)).toBe(true)
    expect(isDueOn(elec, TODAY, false)).toBe(false)
    expect(isDueOn(elec, TODAY, true)).toBe(true)
    expect(isDueOn({ ...crea, status: 'archived' }, TODAY, true)).toBe(false)
    expect(isDueOn(crea, '2026-08-31', true)).toBe(false)
  })
})

describe('racha, cumplimiento y heatmap', () => {
  it('racha: días seguidos completos; hoy incompleto no corta; un día de entreno no cuenta si no tocaba', () => {
    const logs = [-1, -2, -3].map(n => log('i1', addDays(TODAY, n)))
    expect(streakOf(crea, logs, TODAY, always)).toBe(3)
    expect(streakOf(crea, [...logs, log('i1', TODAY)], TODAY, always)).toBe(4)
    const trainOnlyOdd = iso => Number(iso.slice(8)) % 2 === 1   // 9, 7, 5…
    const eLogs = [log('i3', '2026-10-07'), log('i3', '2026-10-05')]
    expect(streakOf(elec, eLogs, TODAY, trainOnlyOdd)).toBe(2)
  })
  it('varias tomas: el día cuenta completo con todas', () => {
    const logs = [log('i2', addDays(TODAY, -1)), log('i2', addDays(TODAY, -1)), log('i2', addDays(TODAY, -2))]
    expect(takenOn(logs, 'i2', addDays(TODAY, -1))).toBe(2)
    expect(streakOf(beta, logs, TODAY, always)).toBe(1)
    expect(dayLevel(beta, logs, addDays(TODAY, -2), always)).toBe(2)   // la mitad
    expect(dayLevel(beta, logs, addDays(TODAY, -1), always)).toBe(3)   // todas
    expect(dayLevel(beta, [], addDays(TODAY, -3), always)).toBe(0)
    expect(dayLevel(elec, [], TODAY, never)).toBe(0)
  })
  it('nivel 1: menos de la mitad; nivel 4: completo con racha de 7 o más', () => {
    const tres = { ...beta, doses: 3 }
    expect(dayLevel(tres, [log('i2', TODAY)], TODAY, always)).toBe(1)
    const week = Array.from({ length: 7 }, (_, i) => log('i1', addDays(TODAY, -i)))
    expect(dayLevel(crea, week, TODAY, always)).toBe(4)
  })
  it('el alta cuenta en el día local: agregado a la noche (UTC del día siguiente) toca hoy', () => {
    const tarde = new Date(2026, 9, 9, 22, 30).toISOString()   // 22:30 local del 9
    expect(startDay(tarde)).toBe('2026-10-09')
    expect(isDueOn({ ...crea, createdAt: tarde }, '2026-10-09', false)).toBe(true)
    expect(startDay('2026-10-01')).toBe('2026-10-01')
  })
  it('agregado hoy: las tomas de días anteriores cuentan para la racha', () => {
    const nuevo = { ...crea, createdAt: TODAY + 'T10:00:00Z' }
    const logs = [-1, -2].map(n => log('i1', addDays(TODAY, n)))
    expect(sinceOf(nuevo, logs)).toBe(addDays(TODAY, -2))
    expect(streakOf(nuevo, logs, TODAY, always)).toBe(2)
    expect(dayLevel(nuevo, logs, addDays(TODAY, -1), always)).toBe(3)
  })
  it('cumplimiento 30 días sobre los días que tocaban (sin hoy si está incompleto)', () => {
    const logs = Array.from({ length: 15 }, (_, i) => log('i1', addDays(TODAY, -1 - i)))
    expect(adherence30(crea, logs, TODAY, always)).toBe(52)   // 15 de 29 (hoy incompleto no cuenta)
    expect(adherence30(elec, [], TODAY, never)).toBeNull()
  })
})

describe('etiquetas', () => {
  it('dosis con scoop, varias tomas y unidades', () => {
    expect(doseLabel(crea)).toBe('1 scoop · 5 g')
    expect(doseLabel({ ...crea, scoopG: 3, dose: 4.5 })).toBe('1½ scoop · 4,5 g')
    expect(perTake(beta)).toBe(1.6)
    expect(doseLabel(beta)).toBe('2 dosis · 1,6 g c/u')
    expect(doseLabel({ id: 'x', catalogId: 'omega3', dose: 2, unit: 'caps', doses: 1 })).toBe('2 cápsulas')
    expect(doseLabel({ id: 'x', catalogId: 'vitaminad', dose: null, unit: 'ui', doses: 1 })).toBe('Dosis indicada')
    expect(doseLabel({ id: 'x', catalogId: 'hierro', dose: null, unit: 'mg', doses: 2 })).toBe('2 dosis')
  })
  it('nombre: el del catálogo o el propio', () => {
    expect(itemName(crea)).toBe('Creatina monohidrato')
    expect(itemName({ catalogId: null, name: 'Ashwagandha' })).toBe('Ashwagandha')
  })
  it('agrupa por momento en el orden de SLOTS', () => {
    expect(groupBySlot([beta, crea, elec]).map(g => g.slot.id)).toEqual(['morning', 'pre', 'meals'])
  })
  it('exceso: lo marcado en el día supera el máximo de la ficha', () => {
    const logs = [log('i1', TODAY, { amount: 15 }), log('i1', TODAY, { amount: 10 })]
    expect(overDose(crea, logs, TODAY)).toBe(25)
    expect(overDose(crea, logs.slice(0, 1), TODAY)).toBeNull()
  })
  it('edad: la cargada manda; si falta, la respuesta', () => {
    expect(adultStatus({ edad: 17, adult: 1 })).toBe('minor')
    expect(adultStatus({ edad: 30 })).toBe('adult')
    expect(adultStatus({ edad: null, adult: 1 })).toBe('adult')
    expect(adultStatus({ edad: null, adult: 0 })).toBe('minor')
    expect(adultStatus({ edad: null, adult: null })).toBe('unknown')
  })
})
