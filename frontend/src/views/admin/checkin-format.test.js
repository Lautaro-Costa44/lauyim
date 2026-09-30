// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { checkinName, feeShort } from './IngresoFisico.jsx'

describe('registro de ingresos: formato', () => {
  it('nombre completo [usuario]; solo el usuario sin nombre; una vez si coinciden', () => {
    expect(checkinName({ fullName: 'Juan Fernández', nick: 'Juani' })).toBe('Juan Fernández [Juani]')
    expect(checkinName({ fullName: null, nick: 'vera' })).toBe('vera')
    expect(checkinName({ fullName: 'Carlos Díaz', nick: 'carlos díaz' })).toBe('Carlos Díaz')
  })
  it('cuota de hoy, corta', () => {
    expect(feeShort({ status: 'por_vencer', days: 3 })).toBe('Vence en 3 días')
    expect(feeShort({ status: 'al_dia', days: 1 })).toBe('Vence en 1 día')
    expect(feeShort({ status: 'por_vencer', days: 0 })).toBe('Vence hoy')
    expect(feeShort({ status: 'vencido', days: -2 })).toBe('Venció hace 2 días')
    expect(feeShort({ status: 'prueba', days: 1 })).toBe('Prueba: 1 día')
    expect(feeShort({ status: 'sin_plan', days: null })).toBe('Sin plan')
  })
})
