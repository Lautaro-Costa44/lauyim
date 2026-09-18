// Fase 7 (B.2) — advertencia de ejercicio↔lesión en el panel admin. Reusa la misma regla
// (bp/tg/keywords) que prepararPoolSeguro usa para excluir ejercicios del generador
// automático; estos tests no tocan esa exclusión, solo el helper que decide si avisar.
import { describe, it, expect } from 'vitest'
import { ejercicioAfectaLesion, lesionesAfectadasPorEjercicio } from './generarRutina.js'

describe('ejercicioAfectaLesion', () => {
  it('detecta coincidencia por body-part (bp)', () => {
    const benchPress = { id: 'bb002', n: 'barbell bench press', bp: 'chest', tg: 'pectorals' }
    expect(ejercicioAfectaLesion(benchPress, 'pecho')).toBe(true)
  })

  it('no asume que cualquier lesión afecta a cualquier ejercicio (bp distinto, sin keyword)', () => {
    const benchPress = { id: 'bb002', n: 'barbell bench press', bp: 'chest', tg: 'pectorals' }
    expect(ejercicioAfectaLesion(benchPress, 'hombros')).toBe(false)
  })

  it('detecta coincidencia por body-part cuando el bp es el de la lesión (hombros → shoulders)', () => {
    const pikePushUp = { id: 'bw007', n: 'pike push up', bp: 'shoulders', tg: 'delts' }
    expect(ejercicioAfectaLesion(pikePushUp, 'hombros')).toBe(true)
  })

  it('detecta coincidencia por target muscle (tg) aunque el bp no esté en la lista', () => {
    const barbellCurl = { id: 'x1', n: 'barbell curl', bp: 'arms', tg: 'biceps' }
    expect(ejercicioAfectaLesion(barbellCurl, 'biceps')).toBe(true)
  })

  it('detecta coincidencia por palabra clave en el nombre cuando bp/tg no matchean', () => {
    const deadlift = { id: 'bb003', n: 'barbell deadlift', bp: 'upper legs', tg: 'glutes' }
    expect(ejercicioAfectaLesion(deadlift, 'espalda_baja')).toBe(true)
  })

  it('lesión desconocida nunca dispara advertencia', () => {
    const benchPress = { id: 'bb002', n: 'barbell bench press', bp: 'chest', tg: 'pectorals' }
    expect(ejercicioAfectaLesion(benchPress, 'zona_inexistente')).toBe(false)
  })

  it('ejercicio null/indefinido no rompe', () => {
    expect(ejercicioAfectaLesion(null, 'pecho')).toBe(false)
  })
})

describe('lesionesAfectadasPorEjercicio', () => {
  it('devuelve solo las lesiones del socio que este ejercicio afecta', () => {
    const benchPress = { id: 'bb002', n: 'barbell bench press', bp: 'chest', tg: 'pectorals' }
    expect(lesionesAfectadasPorEjercicio(benchPress, ['hombros', 'pecho', 'rodillas'])).toEqual(['pecho'])
  })

  it('lista vacía de lesiones no dispara nada', () => {
    const benchPress = { id: 'bb002', n: 'barbell bench press', bp: 'chest', tg: 'pectorals' }
    expect(lesionesAfectadasPorEjercicio(benchPress, [])).toEqual([])
  })
})
