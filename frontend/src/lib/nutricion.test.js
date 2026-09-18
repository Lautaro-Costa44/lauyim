import { describe, it, expect } from 'vitest'
import { calcularMetasNutricionales } from './nutricion.js'

const baseS = { bodyweight: [] }

describe('calcularMetasNutricionales — NUTRICION_AUTOMATICO gating', () => {
  it('automaticoHabilitado=true (default) and no manual goals: calcula automático como siempre', () => {
    const r = calcularMetasNutricionales(baseS)
    expect(r.sinMetas).toBe(false)
    expect(typeof r.sugerido).toBe('number')
    expect(typeof r.metaProteina).toBe('number')
    expect(typeof r.carbosMeta).toBe('number')
    expect(typeof r.grasasMeta).toBe('number')
  })

  it('automaticoHabilitado=false y sin metas manuales: no calcula nada (sinMetas=true)', () => {
    const r = calcularMetasNutricionales(baseS, { automaticoHabilitado: false })
    expect(r.sinMetas).toBe(true)
    expect(r.sugerido).toBeNull()
    expect(r.metaProteina).toBeNull()
    expect(r.carbosMeta).toBeNull()
    expect(r.grasasMeta).toBeNull()
  })

  it('metas manuales cargadas prevalecen con automaticoHabilitado=true', () => {
    const S = { ...baseS, nutritionGoals: { mode: 'manual', calories: 1800, protein: 140, carbs: 180, fat: 55 } }
    const r = calcularMetasNutricionales(S, { automaticoHabilitado: true })
    expect(r.sinMetas).toBe(false)
    expect(r.sugerido).toBe(1800)
    expect(r.metaProteina).toBe(140)
    expect(r.carbosMeta).toBe(180)
    expect(r.grasasMeta).toBe(55)
  })

  it('metas manuales cargadas prevalecen también con automaticoHabilitado=false', () => {
    const S = { ...baseS, nutritionGoals: { mode: 'manual', calories: 2200, protein: 160, carbs: 220, fat: 70 } }
    const r = calcularMetasNutricionales(S, { automaticoHabilitado: false })
    expect(r.sinMetas).toBe(false)
    expect(r.sugerido).toBe(2200)
    expect(r.metaProteina).toBe(160)
    expect(r.carbosMeta).toBe(220)
    expect(r.grasasMeta).toBe(70)
  })

  it('sin segundo argumento se comporta como automaticoHabilitado=true (no rompe llamadas existentes)', () => {
    const r = calcularMetasNutricionales(baseS)
    expect(r.sinMetas).toBe(false)
  })

  it('caloriesBurn manual reemplaza el gasto total diario mostrado, sin depender de NUTRICION_AUTOMATICO', () => {
    const S = { ...baseS, nutritionGoals: { mode: 'manual', caloriesBurn: 2500, calories: null, protein: null, carbs: null, fat: null } }
    const conAutomatico = calcularMetasNutricionales(S, { automaticoHabilitado: true })
    const sinAutomatico = calcularMetasNutricionales(S, { automaticoHabilitado: false })
    expect(conAutomatico.mantenimiento).toBe(2500)
    expect(sinAutomatico.mantenimiento).toBe(2500)
  })

  it('sin caloriesBurn manual, mantenimiento sigue siendo el TDEE automático (nunca null)', () => {
    const r = calcularMetasNutricionales(baseS, { automaticoHabilitado: false })
    expect(typeof r.mantenimiento).toBe('number')
  })

  it('objetivo manual reemplaza el objetivo mostrado', () => {
    const S = { ...baseS, objetivo: 'fitness_general', nutritionGoals: { mode: 'manual', objetivo: 'perder_grasa', calories: 1800, protein: 140, carbs: 180, fat: 55 } }
    const r = calcularMetasNutricionales(S)
    expect(r.objetivo).toBe('perder_grasa')
  })

  it('campo individual vacío (null) dentro de metas manuales no se reemplaza por el automático — sin merge', () => {
    const S = { ...baseS, nutritionGoals: { mode: 'manual', calories: 1800, protein: null, carbs: null, fat: null } }
    const r = calcularMetasNutricionales(S)
    expect(r.sugerido).toBe(1800)
    expect(r.metaProteina).toBeNull()
    expect(r.carbosMeta).toBeNull()
    expect(r.grasasMeta).toBeNull()
  })

  it('al limpiarse las metas manuales (mode automatic) vuelve a calcular automático', () => {
    const manual = calcularMetasNutricionales({ ...baseS, nutritionGoals: { mode: 'manual', calories: 1800, protein: 140, carbs: 180, fat: 55 } })
    expect(manual.sugerido).toBe(1800)
    const vueltoAutomatico = calcularMetasNutricionales({ ...baseS, nutritionGoals: { mode: 'automatic' } })
    expect(vueltoAutomatico.sinMetas).toBe(false)
    expect(typeof vueltoAutomatico.sugerido).toBe('number')
    expect(vueltoAutomatico.sugerido).not.toBe(1800)
  })
})
