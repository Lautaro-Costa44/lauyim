// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { errorText, fieldErrors, ERROR_TEXTS, GENERIC_ERROR } from './errors.js'

const API = path.resolve(process.cwd(), '../api')
const serverSources = () => fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.includes('.test.') && !f.startsWith('migrate-'))
  .map(f => [f, fs.readFileSync(path.join(API, f), 'utf8')])
// Todo `error: '<literal>'` que el backend pone en una respuesta o devuelve un validador.
const emittedErrors = () => serverSources().flatMap(([file, src]) => [...src.matchAll(/error: '([^']*)'/g)].map(m => ({ file, value: m[1] })))

describe('errorText', () => {
  it('un código conocido va al diccionario', () => {
    expect(errorText({ status: 400, data: { error: 'validation_error' }, message: 'validation_error' })).toBe('Revisá los datos ingresados.')
  })
  it('un código desconocido: el message en español del servidor, o el genérico', () => {
    expect(errorText({ data: { error: 'algo_nuevo', message: 'Mensaje del servidor' } })).toBe('Mensaje del servidor')
    expect(errorText({ data: { error: 'algo_nuevo' } })).toBe(GENERIC_ERROR)
    expect(errorText({ data: { error: 'algo_nuevo' } }, 'No se pudo guardar')).toBe('No se pudo guardar')
  })
  it('una frase pasa tal cual', () => {
    expect(errorText({ data: { error: 'El plan no existe' } })).toBe('El plan no existe')
    expect(errorText(new Error('Nombre de grupo inválido'))).toBe('Nombre de grupo inválido')
  })
  it('sin red: el texto de network_error', () => {
    expect(errorText(Object.assign(new Error('x'), { code: 'network_error' }))).toBe(ERROR_TEXTS.network_error)
  })
  it('"HTTP 502", errores del navegador o nada: el fallback', () => {
    expect(errorText(new Error('HTTP 502'))).toBe(GENERIC_ERROR)
    expect(errorText(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'))).toBe(GENERIC_ERROR)
    expect(errorText(null)).toBe(GENERIC_ERROR)
  })
})

describe('anti-regresión con el backend', () => {
  it('cada código snake_case que emite el backend tiene texto en el diccionario', () => {
    const codes = new Set(emittedErrors().map(e => e.value).filter(v => /^[a-z0-9_]+$/.test(v)))
    // Códigos armados en tiempo de ejecución (row-meta.js, TRIAL_ERRORS en server.js).
    for (const c of ['set_not_object', 'workout_not_object', 'set_meta_too_large', 'workout_meta_too_large', 'has_plan', 'account_disabled', 'account_rejected']) codes.add(c)
    expect(codes.size).toBeGreaterThan(30)
    expect([...codes].filter(c => !ERROR_TEXTS[c])).toEqual([])
  })

  it('ningún error nuevo del backend es una frase en inglés', () => {
    const english = /\b(invalid|not found|cannot|can't|failed|expired|required|missing|must|already|unknown|refused|exceeds|too many|no such|not allowed|try again)\b/i
    // Frases en español que nombran un campo en inglés ("required debe ser true o false").
    const spanish = /[áéíóúñ¿¡]|\b(debe|es|son|el|la|los|las|del|para|una?)\b/i
    const offenders = emittedErrors().filter(({ value }) => !/^[a-z0-9_-]+$/.test(value) && english.test(value) && !spanish.test(value))
    expect(offenders).toEqual([])
  })
})

describe('fieldErrors', () => {
  it('forma nueva: cada campo, código o frase', () => {
    expect(fieldErrors({ data: { error: 'validation_error', fields: { dni: 'El DNI debe tener entre 6 y 8 dígitos', phone: 'validation_error' } } }))
      .toEqual({ dni: 'El DNI debe tener entre 6 y 8 dígitos', phone: 'Revisá los datos ingresados.' })
  })
  it('forma vieja: field + frase', () => {
    expect(fieldErrors({ data: { error: 'Mail inválido', field: 'email' } })).toEqual({ email: 'Mail inválido' })
  })
  it('un error que no es de un campo: vacío', () => {
    expect(fieldErrors({ data: { error: 'dni_exists' } })).toEqual({})
    expect(fieldErrors(new Error('x'))).toEqual({})
  })
})
