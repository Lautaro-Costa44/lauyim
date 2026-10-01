import { describe, expect, it } from 'vitest'
import { analyzePixels, defaultIconBackground, containRect, checkLogoFile } from './branding-image.js'

// Imagen w×h de RGBA a partir de una función (x, y) → [r, g, b, a].
const pixels = (w, h, at) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(at(x, y), (y * w + x) * 4)
  return data
}

describe('análisis del logo', () => {
  it('JPG (sin transparencia) con fondo blanco y logo rojo: el fondo de los íconos es el blanco del borde', () => {
    const data = pixels(10, 10, (x, y) => x > 2 && x < 7 && y > 2 && y < 7 ? [220, 20, 20, 255] : [255, 255, 255, 255])
    const a = analyzePixels(data, 10, 10)
    expect(a).toMatchObject({ transparent: false, edgeColor: '#ffffff' })
    expect(defaultIconBackground(a)).toBe('#ffffff')
  })

  it('PNG con transparencia: logo oscuro → fondo blanco; logo claro → fondo negro', () => {
    const dark = analyzePixels(pixels(10, 10, (x, y) => x > 2 && x < 7 && y > 2 && y < 7 ? [20, 20, 20, 255] : [0, 0, 0, 0]), 10, 10)
    expect(dark).toMatchObject({ transparent: true, edgeColor: null })
    expect(defaultIconBackground(dark)).toBe('#ffffff')
    const light = analyzePixels(pixels(10, 10, (x, y) => x > 2 && x < 7 && y > 2 && y < 7 ? [250, 250, 250, 255] : [0, 0, 0, 0]), 10, 10)
    expect(defaultIconBackground(light)).toBe('#000000')
  })
})

describe('encaje', () => {
  it('una imagen ancha se centra entera, sin recortar ni deformar, dentro del margen', () => {
    expect(containRect(1000, 500, 512, 0)).toEqual({ x: 0, y: 128, w: 512, h: 256 })
    const r = containRect(500, 1000, 512, 0.2)
    expect(r.h).toBeCloseTo(512 * 0.6)
    expect(r.w).toBeCloseTo(512 * 0.3)
    expect(r.x).toBeCloseTo((512 - r.w) / 2)
  })
})

describe('archivo', () => {
  it('PNG o JPG de hasta 5 MB', () => {
    expect(checkLogoFile({ type: 'image/png', size: 1000 })).toBeNull()
    expect(checkLogoFile({ type: 'image/jpeg', size: 1000 })).toBeNull()
    expect(checkLogoFile({ type: 'image/svg+xml', size: 1000 }).error).toMatch(/PNG o JPG/)
    expect(checkLogoFile({ type: 'image/png', size: 6 * 1024 * 1024 }).error).toMatch(/5 MB/)
  })
})

describe('márgenes transparentes', () => {
  it('box marca lo visible para recortar el aire alrededor del logo', () => {
    const data = pixels(20, 10, (x, y) => x >= 5 && x < 15 && y >= 2 && y < 8 ? [255, 100, 0, 255] : [0, 0, 0, 0])
    expect(analyzePixels(data, 20, 10).box).toEqual({ x: 5, y: 2, w: 10, h: 6 })
    expect(analyzePixels(pixels(4, 4, () => [0, 0, 0, 0]), 4, 4).box).toEqual({ x: 0, y: 0, w: 4, h: 4 })
  })
})
