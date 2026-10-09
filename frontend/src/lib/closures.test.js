// Cierres del gimnasio en el cliente: helpers de fechas para el aviso, el banner y la semana.
import { describe, expect, it } from 'vitest'
import { closureOn, closureLabel, closureLongLabel, upcomingClosure, weekClosedDays } from './closures.js'
import { closureOn as fromClasses, closureLabel as labelFromClasses } from './classes.js'

const feriado = { id: 'k1', from: '2026-10-12', to: '2026-10-12', reason: 'Feriado' }
const vacas = { id: 'k2', from: '2026-12-24', to: '2027-01-02', reason: 'Vacaciones' }

describe('cierres', () => {
  it('closureOn y closureLabel como antes (y classes.js los sigue exportando)', () => {
    expect(closureOn([feriado], '2026-10-12')).toBe(feriado)
    expect(closureOn([feriado], '2026-10-13')).toBe(null)
    expect(closureOn(null, '2026-10-12')).toBe(null)
    expect(closureLabel(feriado)).toBe('Lun 12/10')
    expect(closureLabel(vacas)).toBe('24/12 al 2/1')
    expect(fromClasses).toBe(closureOn)
    expect(labelFromClasses).toBe(closureLabel)
  })
  it('closureLongLabel: hoy, mañana, el día con nombre o el rango', () => {
    expect(closureLongLabel(feriado, '2026-10-12')).toBe('hoy')
    expect(closureLongLabel(feriado, '2026-10-11')).toBe('mañana')
    expect(closureLongLabel(feriado, '2026-10-09')).toBe('el lunes 12')
    expect(closureLongLabel(vacas, '2026-12-20')).toBe('del 24/12 al 2/1')
  })
  it('upcomingClosure: desde 7 días antes hasta el último día; el más próximo', () => {
    expect(upcomingClosure([vacas, feriado], '2026-10-04')).toBe(null)
    expect(upcomingClosure([vacas, feriado], '2026-10-05')).toBe(feriado)
    expect(upcomingClosure([vacas, feriado], '2026-10-12')).toBe(feriado)
    expect(upcomingClosure([vacas, feriado], '2026-10-13')).toBe(null)
    expect(upcomingClosure([vacas], '2027-01-02')).toBe(vacas)
  })
  it('weekClosedDays: las fechas cerradas de la semana que empieza ese lunes', () => {
    expect(weekClosedDays([feriado], '2026-10-12')).toEqual(['2026-10-12'])
    expect(weekClosedDays([vacas], '2026-12-21')).toEqual(['2026-12-24', '2026-12-25', '2026-12-26', '2026-12-27'])
    expect(weekClosedDays([], '2026-10-12')).toEqual([])
  })
})
