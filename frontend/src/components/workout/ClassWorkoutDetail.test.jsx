// @vitest-environment happy-dom
// Una clase en el historial: cómo quedó presente, qué se trabajó, estrellas (editables o no), la
// nota, borrar, la vista del staff y sin conexión.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { setLang } = await import('../../lib/i18n.js')
const { WorkoutDetail } = await import('../../sheets.jsx')
const { default: ClassWorkoutDetail } = await import('./ClassWorkoutDetail.jsx')

const W = { id: 'cls-b1', d: '2026-10-05', start: Date.parse('2026-10-05T22:00:00Z'), end: Date.parse('2026-10-05T22:45:00Z'), name: 'Spinning', kind: 'class', classBookingId: 'b1', classId: 'c1', teacher: 'Caro', entries: [], muscleLoad: { muscles: ['quadriceps'], intensity: 'high' } }
const detail = (booking = {}) => ({
  booking: { id: 'b1', status: 'attended', source: 'teacher', rating: null, canRate: true, ...booking },
  occurrence: { name: 'Spinning', color: '#ff9f0a', date: '2026-10-05', start: '19:00', end: '19:45', teacherName: 'Caro', room: 'Sala 2', logMode: 'muscles', log: {} }
})

let container, root, close
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
const mount = async el => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(el) })
  for (let i = 0; i < 3; i++) await tick()
}
const button = label => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === label)

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockReset()
  close = vi.fn()
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: { ...useStore.getState().S, workouts: [{ ...W }], body: 'male' } })
})
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove() })

describe('la clase en el historial', () => {
  it('el detalle de un entreno de tipo clase es el de la clase: profe, sala, cómo quedó presente y qué se trabajó', async () => {
    apiMock.mockResolvedValue(detail())
    await mount(<WorkoutDetail w={W} close={close} />)
    expect(apiMock).toHaveBeenCalledWith('/api/classes/booking?id=b1')
    expect(container.querySelector('h3').textContent).toBe('Spinning')
    expect(container.textContent).toContain('19:00–19:45 · con Caro · Sala 2')
    expect(container.textContent).toContain('La profe tomó lista')
    expect(container.textContent).toContain('Intensidad: Alta')
  })

  it('califica mientras se puede', async () => {
    apiMock.mockImplementation(url => url.startsWith('/api/classes/booking') ? Promise.resolve(detail()) : Promise.resolve({ ok: true }))
    await mount(<ClassWorkoutDetail w={W} close={close} />)
    expect(container.textContent).toContain('Podés cambiarla durante 7 días.')
    await act(async () => { container.querySelectorAll('.class-star')[3].click() })
    expect(apiMock).toHaveBeenCalledWith('/api/classes/rating', { method: 'POST', body: JSON.stringify({ bookingId: 'b1', rating: 4 }) })
    expect(container.querySelectorAll('.class-star.on')).toHaveLength(4)
  })

  it('pasado el plazo: las estrellas solo se ven; sin calificar, lo dice', async () => {
    apiMock.mockResolvedValue(detail({ canRate: false, rating: 3 }))
    await mount(<ClassWorkoutDetail w={W} close={close} />)
    expect([...container.querySelectorAll('.class-star')].every(b => b.disabled)).toBe(true)
    expect(container.querySelectorAll('.class-star.on')).toHaveLength(3)
    await act(async () => { root.unmount() }); container.remove(); root = null
    apiMock.mockResolvedValue(detail({ canRate: false, rating: null, source: 'member' }))
    await mount(<ClassWorkoutDetail w={W} close={close} />)
    expect(container.textContent).toContain('No la calificaste.')
    expect(container.textContent).toContain('Dijiste que fuiste')
  })

  it('la nota se guarda y "Borrar del historial" la saca', async () => {
    apiMock.mockResolvedValue(detail())
    await mount(<ClassWorkoutDetail w={W} close={close} />)
    const area = container.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, 'Buena música')
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { area.dispatchEvent(new Event('focusout', { bubbles: true })) })
    expect(useStore.getState().S.workouts[0].note).toBe('Buena música')
    await act(async () => { button('Borrar del historial').click() })
    await tick()
    const sheet = useUI.getState().sheets.at(-1)
    expect(sheet).toBeTruthy()
  })

  it('staff: solo mira (sin nota editable ni borrar) y pide la reserva por el panel', async () => {
    apiMock.mockResolvedValue(detail({ source: 'checkin', rating: 5 }))
    await mount(<ClassWorkoutDetail w={{ ...W, note: 'Vino cansada' }} staff />)
    expect(apiMock).toHaveBeenCalledWith('/api/admin/classes/booking?id=b1')
    expect(container.querySelector('textarea')).toBeNull()
    expect(button('Borrar del historial')).toBeFalsy()
    expect(container.textContent).toContain('Ingresó al gimnasio')
    expect(container.textContent).toContain('Vino cansada')
    expect([...container.querySelectorAll('.class-star')].every(b => b.disabled)).toBe(true)
  })

  it('sin conexión: lo que trae el entrenamiento, sin estrellas', async () => {
    apiMock.mockRejectedValue(new Error('offline'))
    await mount(<ClassWorkoutDetail w={W} close={close} />)
    expect(container.textContent).toContain('con Caro')
    expect(container.textContent).toContain('Sin conexión: la calificación se ve cuando vuelva.')
    expect(container.querySelector('.class-star')).toBeNull()
  })
})
