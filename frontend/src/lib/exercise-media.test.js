import { describe, expect, it } from 'vitest'
import { mediaKindFor, exerciseGifsOn } from './exercise-media.js'

const BENCH = { id: '0025', n: 'barbell bench press', bp: 'chest', tg: 'pectorals', mg: 'pectorals', sm: ['triceps'], gif: '0025.gif', img: '0025.jpg' }
const CUSTOM = { id: 'cx', n: 'Remo en polea', bp: 'back', tg: 'upper back', grupo_muscular: 'back', primaries: ['back'], secondaries: ['biceps'], custom: true }

describe('mediaKindFor', () => {
  it('catálogo: gif con los gifs encendidos, mapa con los gifs apagados', () => {
    expect(mediaKindFor(BENCH, true)).toBe('gif')
    expect(mediaKindFor(BENCH, false)).toBe('map')
  })

  it('ejercicio propio: mapa salvo que lo hayan apagado; los de antes también lo muestran', () => {
    expect(mediaKindFor({ ...CUSTOM, map: true })).toBe('map')
    expect(mediaKindFor(CUSTOM)).toBe('map')
    expect(mediaKindFor({ ...CUSTOM, map: false })).toBeNull()
  })

  it('sin gif en el catálogo, o sin ejercicio, no muestra nada', () => {
    expect(mediaKindFor({ ...BENCH, gif: undefined }, true)).toBeNull()
    expect(mediaKindFor(null)).toBeNull()
  })
})

describe('exerciseGifsOn', () => {
  it('lee exercise_gifs de la config y, sin ella, quedan encendidos', () => {
    expect(exerciseGifsOn({ exercise_gifs: false })).toBe(false)
    expect(exerciseGifsOn({ exercise_gifs: true })).toBe(true)
    expect(exerciseGifsOn({})).toBe(true)
    expect(exerciseGifsOn(null)).toBe(true)
  })
})
