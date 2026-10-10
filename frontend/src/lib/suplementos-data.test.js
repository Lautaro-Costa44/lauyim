import { describe, expect, it } from 'vitest'
import { SUPLEMENTOS, LEVELS, CAFFEINE_SOURCES, SLOTS, UNITS, fichaById, SUPP_ACK_VERSION, WATER_TIP, MATE_TIPS } from './suplementos-data.js'

describe('catálogo de suplementos', () => {
  it('tiene los suplementos de la spec en su nivel', () => {
    const byLevel = id => fichaById(id)?.level
    expect(['creatina', 'cafeina', 'betaalanina', 'proteina', 'electrolitos'].map(byLevel)).toEqual(Array(5).fill('funciona'))
    expect(['bicarbonato', 'remolacha'].map(byLevel)).toEqual(['puntual', 'puntual'])
    expect(byLevel('colageno')).toBe('desarrollo')
    expect(['vitaminad', 'hierro', 'omega3', 'magnesio', 'multivitaminico'].map(byLevel)).toEqual(Array(5).fill('indicacion'))
    expect(['quemadores', 'bcaa', 'glutamina', 'boosters', 'prohormonas'].map(byLevel)).toEqual(Array(5).fill('no'))
  })
  it('cada ficha tiene todas las secciones, fuentes y fecha', () => {
    for (const f of SUPLEMENTOS) {
      expect(LEVELS[f.level], f.id).toBeTruthy()
      for (const k of ['name', 'short', 'intro', 'evidence', 'forWhom', 'buy', 'reviewed']) expect(String(f[k] || '').length, `${f.id}.${k}`).toBeGreaterThan(0)
      expect(f.sources.length, f.id).toBeGreaterThan(0)
      expect(f.cautions.length, f.id).toBeGreaterThan(0)
    }
  })
  it('solo se siguen los de funciona, desarrollo e indicación', () => {
    for (const f of SUPLEMENTOS) expect(f.trackable, f.id).toBe(['funciona', 'desarrollo', 'indicacion'].includes(f.level) && f.id !== 'cafeina')
    expect(fichaById('cafeina').caffeineBar).toBe(true)
  })
  it('los de indicación profesional no sugieren dosis; los demás seguibles sí', () => {
    for (const f of SUPLEMENTOS.filter(x => x.level === 'indicacion')) expect(f.dose, f.id).toBeUndefined()
    for (const f of SUPLEMENTOS.filter(x => x.trackable && x.level !== 'indicacion' && x.id !== 'cafeina')) expect(f.dose?.suggested, f.id).toBeGreaterThan(0)
    expect(fichaById('cafeina').dosePerKg).toEqual({ min: 3, max: 6 })
    expect(fichaById('cafeina').dayMax).toBe(400)
  })
  it('creatina: 3–5 g, fase de carga solo en la guía y "cómo tomarla" con agua y scoop', () => {
    const c = fichaById('creatina')
    expect(c.dose).toEqual({ min: 3, max: 5, suggested: 5 })
    expect(c.loading).toMatch(/recién empezás/)
    const how = c.howTo.map(h => h.text).join(' ')
    expect(how).toMatch(/scoop/); expect(how).toMatch(/ml/); expect(how).toMatch(/No dupliques/)
  })
  it('cada "cómo tomarlo" de los seguibles con dosis sugiere con qué tomarlo', () => {
    for (const id of ['creatina', 'proteina', 'betaalanina', 'electrolitos', 'colageno']) {
      expect(fichaById(id).howTo.map(h => h.text).join(' '), id).toMatch(/ml|agua|jugo|leche|yogur|batido|comida/)
    }
  })
  it('fuentes de cafeína: el mate es por ½ termo y estimado', () => {
    const mate = CAFFEINE_SOURCES.find(s => s.id === 'mate')
    expect(mate.unitLabel).toBe('½ termo'); expect(mate.mg).toBeGreaterThan(0)
    expect(CAFFEINE_SOURCES.map(s => s.id)).toEqual(['mate', 'cafe', 'espresso', 'energizante', 'capsula', 'preentreno', 'otro'])
    expect(CAFFEINE_SOURCES.find(s => s.id === 'otro').mg).toBeNull()
    expect(MATE_TIPS.join(' ')).toMatch(/no deshidrata/)
  })
  it('la palabra es "dosis", no "toma"', () => {
    const all = JSON.stringify(SUPLEMENTOS)
    expect(all).not.toMatch(/\btomas?\b/i)
  })
  it('momentos, unidades, agua y versión del aviso', () => {
    expect(SLOTS.map(s => s.id)).toEqual(['morning', 'pre', 'post', 'meals', 'night', 'any'])
    expect(UNITS.map(u => u.id)).toEqual(['g', 'mg', 'ml', 'caps', 'ui', 'dosis'])
    expect(WATER_TIP.hombres).toMatch(/2,5 L/); expect(WATER_TIP.mujeres).toMatch(/2 L/)
    expect(SUPP_ACK_VERSION).toBe('2026-10-09')
  })
})
