// @vitest-environment happy-dom
// Formulario de ejercicio propio, por el stack de sheets real: interruptores de mapa,
// instrucciones y compartir según el rol, y compartir que espera al servidor.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const apiMock = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('./api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock.api }))

const { useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { customExSheet, exerciseDetailSheet } = await import('../sheets.jsx')

const mounted = []
function renderTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const type = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const switchFor = (host, label) => host.querySelector(`[role="switch"][aria-label="${label}"]`)
// Las etiquetas pueden salir en inglés o en español según el idioma activo del worker.
const LABELS = { 'Create exercise': ['Create exercise', 'Crear ejercicio'], Edit: ['Edit', 'Editar'], Delete: ['Delete', 'Eliminar'] }
const button = (host, text) => [...host.querySelectorAll('button')].find(b => (LABELS[text] || [text]).includes(b.textContent.trim()))
const fillBasics = host => {
  act(() => type(host.querySelector('input[name="app-exercise-name"]'), 'Remo en polea'))
  act(() => button(host, 'back')?.click() || [...host.querySelectorAll('.chip')].find(c => /espalda|back/i.test(c.textContent))?.click())
}

describe('formulario de ejercicio propio', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    apiMock.api.mockReset()
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, customEx: [], routines: [], workouts: [] }, user: null }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

  it('socio: mapa encendido, instrucciones apagadas y sin "Visible para todos"', () => {
    useStore.setState({ user: { id: 'u1', name: 'ana', admin: false } })
    customExSheet(null)
    const host = renderTopSheet()
    expect(switchFor(host, 'Mapa muscular').getAttribute('aria-checked')).toBe('true')
    expect(switchFor(host, 'Instrucciones').getAttribute('aria-checked')).toBe('false')
    expect(switchFor(host, 'Visible para todos los socios')).toBeNull()
    expect(host.querySelector('textarea[name="app-exercise-steps"]')).toBeNull()
  })

  it('staff: mapa, instrucciones y compartir encendidos; el editor arranca en "1. "', () => {
    useStore.setState({ user: { id: 'a1', name: 'admin', admin: true } })
    customExSheet(null)
    const host = renderTopSheet()
    expect(switchFor(host, 'Instrucciones').getAttribute('aria-checked')).toBe('true')
    expect(switchFor(host, 'Visible para todos los socios').getAttribute('aria-checked')).toBe('true')
    expect(host.querySelector('textarea[name="app-exercise-steps"]').value).toBe('1. ')
  })

  it('compartir que falla no crea nada; si anda, la copia local queda marcada como compartida', async () => {
    useStore.setState({ user: { id: 'a1', name: 'admin', admin: true } })
    customExSheet(null)
    const host = renderTopSheet()
    fillBasics(host)
    apiMock.api.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'network_error' }))
    await act(async () => { button(host, 'Create exercise').click() })
    expect(useStore.getState().S.customEx).toHaveLength(0)

    apiMock.api.mockResolvedValueOnce({ ok: true })
    await act(async () => { button(host, 'Create exercise').click() })
    const [saved] = useStore.getState().S.customEx
    expect(saved.shared).toBe(true)
    expect(saved.map).toBe(true)
    expect(apiMock.api).toHaveBeenLastCalledWith('/api/admin/public-exercises', expect.objectContaining({ method: 'POST' }))
  })

  it('un socio no ve Editar ni Borrar en un ejercicio compartido; en uno propio, sí', () => {
    useStore.setState({ user: { id: 'u1', name: 'ana', admin: false } })
    const shared = { id: 'cpub', n: 'Hip thrust', bp: 'upper legs', tg: 'upper legs', eq: 'barbell', custom: true, shared: true, st: [] }
    exerciseDetailSheet(shared)
    let host = renderTopSheet()
    expect(button(host, 'Edit')).toBeUndefined()
    expect(button(host, 'Delete')).toBeUndefined()
    exerciseDetailSheet({ ...shared, id: 'cmine', shared: undefined })
    host = renderTopSheet()
    expect(button(host, 'Edit')).toBeDefined()
  })
})

describe('ejercicio compartido duplicado en el estado local (copia propia de antes del arreglo)', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    apiMock.api.mockReset()
    useUI.setState({ sheets: [] })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

  it('sin conexión, borrarlo avisa y no lo saca (antes se borraba y volvía al reconectar)', async () => {
    const shared = { id: 'cdup', n: 'Hip thrust', bp: 'upper legs', tg: 'upper legs', eq: 'barbell', custom: true, shared: true, st: [] }
    const personal = { ...shared, shared: undefined }
    useStore.setState({ user: { id: 'a1', name: 'admin', admin: true } })
    useStore.getState().update(s => { s.customEx = [shared, personal]; s.routines = []; s.workouts = [] })
    const { EXIDX } = await import('./exercises.js')
    expect(EXIDX.cdup.shared).toBe(true)
    exerciseDetailSheet(EXIDX.cdup)
    const host = renderTopSheet()
    apiMock.api.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'network_error' }))
    act(() => button(host, 'Delete').click())
    const confirm = renderTopSheet()
    await act(async () => { confirm.querySelector('.confirm-dialog .btn.danger').click() })
    expect(useStore.getState().S.customEx.filter(e => e.id === 'cdup').length).toBeGreaterThan(0)
  })
})

describe('equipamiento', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState({ user: { id: 'u1', name: 'ana', admin: false } })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

  it('se elige uno solo: elegir otro reemplaza al anterior', () => {
    customExSheet(null)
    const host = renderTopSheet()
    const chip = label => [...host.querySelectorAll('.chip')].find(c => c.textContent.trim() === label)
    const on = () => ['Mancuernas', 'Barra', 'Máquina/Polea', 'Calistenia/Peso corporal', 'Cinta/Bici']
      .filter(l => chip(l)?.classList.contains('on'))
    expect(on()).toEqual(['Calistenia/Peso corporal'])
    act(() => chip('Máquina/Polea').click())
    expect(on()).toEqual(['Máquina/Polea'])
    act(() => chip('Barra').click())
    expect(on()).toEqual(['Barra'])
  })
})

describe('dejar de compartir', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    apiMock.api.mockReset()
    useUI.setState({ sheets: [] })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

  it('el admin apaga "Visible para todos": pide al servidor dejar de compartirlo y queda como propio', async () => {
    const shared = { id: 'cuns', n: 'Press Pallof', tipo: 'fuerza', grupo_muscular: 'waist', bp: 'waist', tg: 'waist', eq: 'body weight', equipamiento: ['body weight'], custom: true, shared: true, st: [] }
    useStore.setState({ user: { id: 'a1', name: 'admin', admin: true } })
    useStore.getState().update(s => { s.customEx = [shared]; s.routines = []; s.workouts = [] })
    customExSheet(shared)
    const host = renderTopSheet()
    const sw = switchFor(host, 'Visible para todos los socios')
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(sw.disabled).toBe(false)
    act(() => sw.click())
    apiMock.api.mockResolvedValueOnce({ ok: true, copies: 2 })
    await act(async () => { [...host.querySelectorAll('button')].find(b => ['Save', 'Guardar'].includes(b.textContent.trim())).click() })
    expect(apiMock.api).toHaveBeenLastCalledWith('/api/admin/public-exercises/unshare', expect.objectContaining({ body: JSON.stringify({ id: 'cuns' }) }))
    const [saved] = useStore.getState().S.customEx
    expect(saved.shared).toBeUndefined()
    expect(saved.id).toBe('cuns')
  })

  it('el buscador muestra una sola entrada si el estado trae el compartido y su copia', async () => {
    const { allExercises } = await import('./exercises.js')
    const list = allExercises({ customEx: [{ id: 'cx', n: 'A', origin: 'cx', custom: true }, { id: 'cx', n: 'A', custom: true, shared: true }] })
    const mine = list.filter(e => e.id === 'cx')
    expect(mine).toHaveLength(1)
    expect(mine[0].shared).toBe(true)
  })
})
