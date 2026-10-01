import { describe, expect, it } from 'vitest'
import { can, isStaffUser, visibleSections } from './permissions.js'

const paths = (user, flags) => visibleSections(user, flags).map(s => s.path)

describe('permisos en el cliente', () => {
  it('owner todo; con rol, lo del rol; sesión vieja sin la lista: admin', () => {
    expect(can({ owner: true, permissions: [] }, 'fees.manage')).toBe(true)
    expect(can({ permissions: ['fees.view'] }, 'fees.view')).toBe(true)
    expect(can({ permissions: ['fees.view'] }, 'fees.manage')).toBe(false)
    expect(can({ admin: true }, 'fees.manage')).toBe(true)
    expect(can({ admin: false }, 'fees.manage')).toBe(false)
    expect(isStaffUser({ permissions: [] })).toBe(false)
    expect(isStaffUser({ permissions: ['checkin.operate'] })).toBe(true)
    expect(can(null, 'members.view')).toBe(false)
  })

  it('secciones: cada rol ve las suyas; las funciones apagadas desaparecen', () => {
    const recepcion = { permissions: ['members.view', 'members.edit', 'members.approve', 'fees.view', 'fees.manage', 'checkin.operate'] }
    expect(paths(recepcion, { billingEnabled: true, checkinEnabled: true })).toEqual(['usuarios', 'cuotas', 'acceso', 'ingreso-fisico'])
    expect(paths(recepcion, { billingEnabled: false, checkinEnabled: false })).toEqual(['usuarios', 'acceso'])
    expect(paths({ permissions: ['members.view', 'nutrition.manage', 'health.view'] })).toEqual(['usuarios'])
    const owner = paths({ owner: true }, { checkinEnabled: false, auditEnabled: false })
    expect(owner).toContain('personalizacion')
    expect(owner).toContain('ingreso-fisico')
    expect(owner).toContain('roles')
    expect(owner).not.toContain('logs')
  })

  it('clases: con tomar lista y el módulo prendido; el owner la ve apagada para prenderla', () => {
    const profe = { permissions: ['members.view', 'classes.attendance'] }
    expect(paths(profe, { classesEnabled: true })).toEqual(['usuarios', 'clases'])
    expect(paths(profe, { classesEnabled: false })).toEqual(['usuarios'])
    expect(paths({ owner: true }, { classesEnabled: false })).toContain('clases')
    expect(paths({ permissions: ['members.view'] }, { classesEnabled: true })).not.toContain('clases')
  })
})
