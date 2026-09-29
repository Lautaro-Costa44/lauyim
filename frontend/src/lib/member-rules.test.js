// @vitest-environment node
// Las reglas del formulario (lib/member-rules.js) son una copia de las del servidor
// (api/members.js). Misma tabla de casos contra las dos: si alguien cambia una sola, falla acá.
import { describe, expect, it } from 'vitest'
import * as server from '../../../api/members.js'
import { dniError, phoneError, emailError, fullNameError, usernameError, profileErrors } from './member-rules.js'

const CASES = {
  dni: ['20123456', '20.123.456', ' 020 123 456 ', '0012345678', '12345', '123456789', '12a456', '', '   ', 20123456, null, '1'.repeat(21), '1.2.3.4.5.6'],
  phone: ['11 2345-6789', '+54 9 11 2345-6789', '0054 9 11 1234 5678', '1234567', '+1 (415) 555-2671', '12345678', 'abc12345678', '', '1'.repeat(16), '00' + '1'.repeat(16), '+' + '1'.repeat(16), '1'.repeat(31), 1123456789, null],
  email: ['ana@gym.com', ' ANA@Gym.com ', 'ana@gym', 'ana gym@x.com', '@x.com', '', 'a@b.c.', 'x'.repeat(250) + '@a.co', null],
  fullName: ['Juan Pérez', '  Juan   Pérez ', '', '   ', 'x'.repeat(80), 'x'.repeat(81), 42],
  username: ['juan', '  juan ', '', '   ', undefined, 'x'.repeat(60)],
}
const serverError = (fn, v) => fn(v).error || null

describe('reglas del formulario = reglas del servidor', () => {
  it.each(CASES.dni)('DNI %j', v => expect(dniError(v)).toBe(serverError(server.normalizeDni, v)))
  it.each(CASES.phone)('celular %j', v => expect(phoneError(v)).toBe(serverError(server.normalizePhone, v)))
  it.each(CASES.email)('mail %j', v => expect(emailError(v)).toBe(serverError(server.normalizeEmail, v)))
  it.each(CASES.fullName)('nombre y apellido %j', v => expect(fullNameError(v)).toBe(serverError(server.normalizeFullName, v)))
  it.each(CASES.username)('usuario %j', v => expect(usernameError(v)).toBe(serverError(server.normalizeUsername, v)))

  const CONFIGS = [
    server.DEFAULT_MEMBER_FIELDS,
    { full_name: { enabled: true, required: false }, dni: { enabled: false, required: false }, phone: { enabled: true, required: false }, email: { enabled: true, required: true } },
  ]
  const PROFILES = [
    {}, { fullName: 'Ana', dni: '20123456', phone: '11 2345-6789' }, { fullName: '', dni: '12', phone: '123', email: 'x@' },
    { fullName: 'Ana', dni: '1.2.3', email: 'ana@gym.com' },
  ]
  it.each(CONFIGS.flatMap(c => PROFILES.map(p => [c, p])))('perfil completo %#', (fields, values) => {
    const r = server.validateMemberProfile(values, fields)
    expect(profileErrors(values, fields)).toEqual(r.fields || {})
  })
})
