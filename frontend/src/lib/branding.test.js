import { describe, expect, it } from 'vitest'
import { contrastRatio, onAccentFor, darken, resolveAccent, contrastWarnings, isCustomBrand, shortNameFor, themeFor, notificationIcon } from './branding.js'

describe('colores', () => {
  it('contraste WCAG y texto sobre el acento', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(onAccentFor('#ffd60a')).toBe('#000')   // amarillo: texto negro
    expect(onAccentFor('#0a3d91')).toBe('#fff')   // azul oscuro: texto blanco
  })

  it('darken baja el brillo sin cambiar el tono', () => {
    expect(darken('#ff8800', 0.5)).toBe('#804400')
    expect(darken('#000000', 0.3)).toBe('#000000')
  })

  it('avisa si el color se lee mal sobre el fondo de un tema', () => {
    expect(contrastWarnings('#30d158')).toEqual(['light'])          // verde claro: flojo en modo claro
    expect(contrastWarnings('#0a0a0a')).toEqual(['dark'])            // casi negro: flojo en modo oscuro
    expect(contrastWarnings('#0a84ff')).toEqual([])
  })
})

describe('qué acento ve cada usuario', () => {
  const brand = { color: '#ff8800', lockColor: false }
  it('sin color del gym, el que eligió el usuario', () => {
    expect(resolveAccent('sky', {})).toEqual({ key: 'sky' })
    expect(resolveAccent('gym', {})).toEqual({ key: 'lime' })
    expect(resolveAccent(undefined, null)).toEqual({ key: 'lime' })
  })
  it('con color del gym: es el de entrada (el lime de fábrica) y el que eligió "gym"', () => {
    expect(resolveAccent('lime', brand)).toEqual({ key: 'custom', color: '#ff8800' })
    expect(resolveAccent('gym', brand)).toEqual({ key: 'custom', color: '#ff8800' })
    expect(resolveAccent('violet', brand)).toEqual({ key: 'violet' })
  })
  it('con "solo el color del gym", todos lo ven', () => {
    expect(resolveAccent('violet', { ...brand, lockColor: true })).toEqual({ key: 'custom', color: '#ff8800' })
  })
})

describe('tema', () => {
  it('con el tema bloqueado manda el del gym; si no, el que eligió cada uno', () => {
    expect(themeFor('light', { theme: 'dark', lockTheme: true })).toBe('dark')
    expect(themeFor('dark', { theme: 'system', lockTheme: true })).toBe('system')
    expect(themeFor('light', { theme: 'dark', lockTheme: false })).toBe('light')
    expect(themeFor(undefined, { theme: 'light', lockTheme: false })).toBe('dark')
    // Sin config todavía (primer arranque sin conexión): la del usuario.
    expect(themeFor('light', null)).toBe('light')
  })
})

describe('nombre', () => {
  it('es una marca propia cuando no es lauyim; el nombre corto sale del largo', () => {
    expect(isCustomBrand({ appName: 'lauyim' })).toBe(false)
    expect(isCustomBrand({ appName: 'Gym Centro' })).toBe(true)
    expect(isCustomBrand(null)).toBe(false)
    expect(shortNameFor({ appName: 'Gimnasio Centro Norte', shortName: '' })).toBe('Gimnasio Cen')
    expect(shortNameFor({ appName: 'Gimnasio Centro Norte', shortName: 'Centro' })).toBe('Centro')
  })
})

describe('notificaciones', () => {
  it('la foto es el ícono del gym con logo propio; si no, el de lauyim', () => {
    expect(notificationIcon({ logo: 7 })).toBe('/api/branding/icon-192.png?v=7')
    expect(notificationIcon({ logo: null })).toBe('icon-512.png?v=3')
    expect(notificationIcon(null)).toBe('icon-512.png?v=3')
  })
})
