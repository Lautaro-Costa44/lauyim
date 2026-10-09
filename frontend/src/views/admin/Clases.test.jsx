// @vitest-environment happy-dom
// Admin → Clases: calendario semana (PC) y día (celular), botones según el permiso, hoja de la
// fecha (anotar a mano, suspender) y el editor con el aviso de superposición.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
const desktop = vi.hoisted(() => ({ on: true }))
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
vi.mock('./useDesktop.js', () => ({ useDesktop: () => desktop.on }))

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { setLang } = await import('../../lib/i18n.js')
const { AdminContext } = await import('./context.js')
const { default: AdminClases, mondayOf, gridHours } = await import('./Clases.jsx')
const { sessionSheet } = await import('./clases/SessionSheet.jsx')
const { classEditorSheet } = await import('./clases/ClassEditor.jsx')

const TODAY = '2026-10-07'   // miércoles
const occ = (extra = {}) => ({ key: 's1:' + TODAY, classId: 'c1', slotId: 's1', sessionId: 'x1', date: TODAY, start: '19:00', end: '20:00', movedFrom: null, teacherUserId: 'profe', teacherName: 'Caro', room: 'Sala 1', cancelled: false, name: 'Spinning', color: '#ff9f0a', icon: 'bike', capacity: 12, booked: 3, waitlist: 1, editable: true, canBook: true, ...extra })
let canManage, overlap, sessionOcc
const calendar = () => ({ today: TODAY, from: '2026-10-05', days: 7, canManage, canOwn: canManage, settings: { enabled: true, allowOverlap: false }, occurrences: [occ(), occ({ key: 's2:2026-10-05', slotId: 's2', date: '2026-10-05', name: 'Pilates', start: '08:00', end: '09:00' })], summary: { classes: 2, occupancy: 25, lateCancels: 1, waitlist: 1 } })

let container, root
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
const mount = async el => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<MemoryRouter><AdminContext.Provider value={{ users: [{ id: 'ana', name: 'Ana' }, { id: 'beto', name: 'Beto' }] }}>{el}</AdminContext.Provider></MemoryRouter>) })
  for (let i = 0; i < 5; i++) await tick()
}
const button = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
async function openLastSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => { r.render(<MemoryRouter>{sheet.render(() => useUI.getState().closeSheet(sheet.id))}</MemoryRouter>) })
  for (let i = 0; i < 5; i++) await tick()
  return { host, unmount: async () => { await act(async () => r.unmount()); host.remove() } }
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  canManage = true; overlap = { blocking: [], warnings: [] }; desktop.on = true; sessionOcc = null
  apiMock.mockReset()
  apiMock.mockImplementation((url, opts) => {
    if (url.startsWith('/api/admin/classes/calendar')) return Promise.resolve(calendar())
    if (url === '/api/admin/classes/types') return Promise.resolve({ types: [{ id: 'c1', name: 'Spinning', color: '#ff9f0a', durationMin: 60, capacity: 12, teacherName: '', room: 'Sala 1', editable: canManage }], slots: [], teachers: canManage ? [{ id: 'profe', name: 'Caro' }] : [], canManage, canOwn: canManage, settings: { allowOverlap: false } })
    if (url.startsWith('/api/admin/classes/session?')) return Promise.resolve({ occurrence: sessionOcc || occ(), booked: [{ bookingId: 'b1', userId: 'ana', name: 'Ana', addedBy: null }], waitlist: [{ bookingId: 'b2', userId: 'cami', name: 'Cami', pos: 1 }] })
    if (url === '/api/admin/classes/overlap-check') return Promise.resolve(overlap)
    return Promise.resolve({ occurrence: occ(), booking: { id: 'b9' } })
  })
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ user: { id: 'owner', owner: true, permissions: [] } })
})
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove() })

describe('cálculos', () => {
  it('lunes de la semana y horas de la grilla', () => {
    expect(mondayOf('2026-10-07')).toBe('2026-10-05')
    expect(mondayOf('2026-10-11')).toBe('2026-10-05')
    expect(mondayOf('2026-10-05')).toBe('2026-10-05')
    expect(gridHours([{ start: '06:30', end: '07:30' }, { start: '21:30', end: '22:15' }])).toEqual({ from: 360, to: 1380 })
    expect(gridHours([])).toEqual({ from: 480, to: 1260 })
  })
})

describe('calendario', () => {
  it('PC: la semana con las clases, los números y los botones de quien gestiona', async () => {
    await mount(<AdminClases />)
    expect([...container.querySelectorAll('.class-week-head span')].map(s => s.textContent).slice(1)).toEqual(['Lun 5', 'Mar 6', 'Mié 7', 'Jue 8', 'Vie 9', 'Sáb 10', 'Dom 11'])
    expect([...container.querySelectorAll('.class-block-name')].map(b => b.textContent).sort()).toEqual(['Pilates', 'Spinning'])
    expect(container.querySelector('.class-stats').textContent).toContain('25%')
    for (const label of ['Nueva clase', 'Clase suelta', 'Ajustes']) expect(button(container, label)).toBeTruthy()
  })

  it('celular: un día por vez; la profe que solo toma lista no ve botones de edición', async () => {
    desktop.on = false; canManage = false
    useStore.setState({ user: { id: 'profe', permissions: ['members.view', 'classes.attendance'] } })
    await mount(<AdminClases />)
    expect([...container.querySelectorAll('.class-item .tt')].map(e => e.textContent)).toEqual(['Spinning'])
    expect(button(container, 'Nueva clase')).toBeFalsy()
    expect(button(container, 'Ajustes')).toBeFalsy()
    await act(async () => { container.querySelector('[aria-label="Día anterior"]').click() })
    await act(async () => { container.querySelector('[aria-label="Día anterior"]').click() })
    expect([...container.querySelectorAll('.class-item .tt')].map(e => e.textContent)).toEqual(['Pilates'])
  })
})

describe('hoja de la fecha', () => {
  it('anotados, lista de espera, anotar a mano y suspender', async () => {
    const onChange = vi.fn()
    sessionSheet(occ(), { canManage: true, users: [{ id: 'ana', name: 'Ana' }, { id: 'beto', name: 'Beto' }], teachers: [{ id: 'profe', name: 'Caro' }], onChange })
    const { host, unmount } = await openLastSheet()
    expect(host.textContent).toContain('Ana')
    expect(host.textContent).toContain('Cami')
    await act(async () => { button(host, 'Anotar a mano').click() })
    // Ana ya está anotada: solo aparece Beto.
    expect([...host.querySelectorAll('.list button.item .tt')].map(e => e.textContent)).toEqual(['Beto'])
    await act(async () => { host.querySelector('.list button.item').click() })
    await tick()
    expect(apiMock).toHaveBeenCalledWith('/api/admin/classes/sessions/add', { method: 'POST', body: JSON.stringify({ sessionId: 'x1', slotId: 's1', date: TODAY, userId: 'beto' }) })
    expect(onChange).toHaveBeenCalled()
    const before = useUI.getState().sheets.length
    await act(async () => { button(host, 'Suspender este día').click() })
    for (let i = 0; i < 200 && useUI.getState().sheets.length === before; i++) await tick()
    const confirm = useUI.getState().sheets.at(-1)
    expect(confirm.kind).toBe('center')
    await unmount()
  })
})

describe('fecha suspendida', () => {
  it('suelta: quien la puede editar la quita de la vista; sin permiso, no hay botón', async () => {
    sessionOcc = occ({ cancelled: true, slotId: null })
    sessionSheet(sessionOcc, { canManage: true, users: [], teachers: [], onChange: vi.fn() })
    let sheet = await openLastSheet()
    expect(button(sheet.host, 'Quitar de la vista')).toBeTruthy()
    expect(button(sheet.host, 'Anotar a mano')).toBeFalsy()
    const before = useUI.getState().sheets.length
    await act(async () => { button(sheet.host, 'Quitar de la vista').click() })
    for (let i = 0; i < 200 && useUI.getState().sheets.length === before; i++) await tick()
    const confirm = useUI.getState().sheets.at(-1)
    const host = document.createElement('div'); document.body.appendChild(host)
    const r = createRoot(host)
    await act(async () => { r.render(confirm.render(() => useUI.getState().closeSheet(confirm.id))) })
    await act(async () => { button(host, 'Quitar').click() })
    await tick()
    expect(apiMock).toHaveBeenCalledWith('/api/admin/classes/sessions/hide', { method: 'POST', body: JSON.stringify({ sessionId: 'x1' }) })
    await act(async () => r.unmount()); host.remove()
    await sheet.unmount()
    sessionOcc = occ({ cancelled: true, editable: false, slotId: null })
    sessionSheet(sessionOcc, { canManage: false, users: [], teachers: [] })
    sheet = await openLastSheet()
    expect(button(sheet.host, 'Quitar de la vista')).toBeFalsy()
    await sheet.unmount()
  })

  it('profe de sus clases: puede cambiar la hora y suspender, no la profe', async () => {
    sessionOcc = occ({ canBook: false })
    sessionSheet(sessionOcc, { canManage: false, users: [], teachers: [] })
    const { host, unmount } = await openLastSheet()
    expect(button(host, 'Cambiar horario este día')).toBeTruthy()
    expect(button(host, 'Suspender este día')).toBeTruthy()
    expect(button(host, 'Cambiar profe este día')).toBeFalsy()
    await unmount()
  })
})

describe('editor', () => {
  it('sin "todas las clases" no se elige profe: la da quien la crea', async () => {
    classEditorSheet({ type: null, slots: [], teachers: [], canManage: false, me: { id: 'profe', name: 'Caro' }, allowOverlap: false })
    const { host, unmount } = await openLastSheet()
    expect(host.querySelector('select[aria-label="Profe"]')).toBeNull()
    expect(host.textContent).toContain('Caro · las clases que creás las das vos')
    await unmount()
  })

  it('cupo: se puede apagar (sin cupo) y al guardar va null', async () => {
    classEditorSheet({ type: { id: 'c1', name: 'Yoga', color: '#ff9f0a', icon: 'dumbbell', description: '', durationMin: 60, capacity: 12, teacherUserId: null, teacherName: '', room: '', logMode: 'muscles', log: { muscles: ['abs'], intensity: 'low' } }, slots: [], teachers: [], allowOverlap: false })
    const { host, unmount } = await openLastSheet()
    expect(host.querySelector('input[name="class-capacity"]')).toBeTruthy()
    await act(async () => { host.querySelector('[role="switch"][aria-label="Cupo limitado"]').click() })
    expect(host.querySelector('input[name="class-capacity"]')).toBeNull()
    expect(host.textContent).toContain('Se anota quien quiera, sin lista de espera.')
    await act(async () => { button(host, 'Guardar').click() })
    await tick()
    const call = apiMock.mock.calls.find(([u]) => u === '/api/admin/classes/types/save')
    expect(JSON.parse(call[1].body).capacity).toBeNull()
    await unmount()
  })

  it('músculos por defecto; un horario que choca muestra el aviso y deshabilita Guardar', async () => {
    overlap = { blocking: [{ text: 'Ya hay Pilates el lunes de 18:30 a 19:30 en Sala 1, con Ana.' }], warnings: [] }
    classEditorSheet({ type: null, slots: [], teachers: [{ id: 'profe', name: 'Caro' }], allowOverlap: false })
    const { host, unmount } = await openLastSheet()
    expect(host.textContent).toContain('Músculos e intensidad')
    const name = host.querySelector('input[name="class-name"]')
    const setter = Object.getOwnPropertyDescriptor(name.constructor.prototype, 'value').set
    await act(async () => { setter.call(name, 'Spinning'); name.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(button(host, 'Guardar').disabled).toBe(false)
    await act(async () => { button(host, 'Agregar día').click() })
    await act(async () => { await new Promise(r => setTimeout(r, 450)) })
    expect(host.textContent).toContain('Ya hay Pilates el lunes de 18:30 a 19:30 en Sala 1, con Ana.')
    expect(button(host, 'Guardar').disabled).toBe(true)
    await unmount()
  })
})

describe('tomar lista', () => {
  it('al tomar lista no se duplica: la lista de anotados se reemplaza por Presente / Ausente', async () => {
    apiMock.mockImplementation(url => {
      if (url.startsWith('/api/admin/classes/session?')) return Promise.resolve({ occurrence: occ(), canTakeAttendance: true, attendanceTaken: false, booked: [{ bookingId: 'b1', userId: 'ana', name: 'Ana', status: 'booked' }, { bookingId: 'b2', userId: 'beto', name: 'Beto', status: 'booked' }], waitlist: [] })
      return Promise.resolve({ ok: true })
    })
    sessionSheet(occ(), { canManage: true, users: [], teachers: [] })
    const { host, unmount } = await openLastSheet()
    const names = () => [...host.querySelectorAll('.tt')].map(e => e.textContent)
    expect(names()).toEqual(['Ana', 'Beto'])
    await act(async () => { button(host, 'Tomar lista').click() })
    expect(names()).toEqual(['Ana', 'Beto'])
    expect(host.textContent).not.toContain('Anotados')
    await act(async () => { button(host, 'Guardar lista').click() })
    await tick()
    expect(apiMock).toHaveBeenCalledWith('/api/admin/classes/sessions/attendance', { method: 'POST', body: JSON.stringify({ sessionId: 'x1', present: ['ana', 'beto'], absent: [] }) })
    await unmount()
  })
})

describe('mensaje a los anotados', () => {
  const detail = extra => ({ occurrence: occ(), canMessage: true, booked: [{ bookingId: 'b1', userId: 'ana', name: 'Ana', status: 'booked' }], waitlist: [{ bookingId: 'b2', userId: 'cami', name: 'Cami', pos: 1 }], ...extra })
  it('la profe escribe, elige si va a la lista de espera y se manda como push', async () => {
    apiMock.mockImplementation(url => {
      if (url.startsWith('/api/admin/classes/session?')) return Promise.resolve(detail())
      if (url === '/api/admin/classes/sessions/message') return Promise.resolve({ sent: 2, left: 2 })
      return Promise.resolve({ ok: true })
    })
    sessionSheet(occ(), { canManage: false, users: [], teachers: [] })
    const { host, unmount } = await openLastSheet()
    await act(async () => { button(host, 'Mandar un mensaje a los anotados').click() })
    expect(button(host, 'Mandar').disabled).toBe(true)
    const area = host.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, 'Traigan toalla')
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.textContent).toContain('14/200')
    expect(host.textContent).toContain('Les llega como notificación a 1 persona, con tu nombre.')
    await act(async () => { host.querySelector('.class-message [role="switch"], .class-message input[type="checkbox"]').click() })
    expect(host.textContent).toContain('a 2 personas')
    await act(async () => { button(host, 'Mandar').click() })
    await tick()
    expect(apiMock).toHaveBeenCalledWith('/api/admin/classes/sessions/message', { method: 'POST', body: JSON.stringify({ sessionId: 'x1', slotId: 's1', date: TODAY, text: 'Traigan toalla', waitlist: true }) })
    expect(useUI.getState().toastMsg).toBe('Mensaje enviado a 2 personas')
    expect(host.querySelector('textarea')).toBeNull()
    await unmount()
  })

  it('sin permiso no aparece; sin anotados se ve apagado y dice por qué', async () => {
    apiMock.mockImplementation(url => url.startsWith('/api/admin/classes/session?') ? Promise.resolve(detail({ canMessage: false })) : Promise.resolve({}))
    sessionSheet(occ(), { canManage: false, users: [], teachers: [] })
    let sheet = await openLastSheet()
    expect(button(sheet.host, 'Mandar un mensaje a los anotados')).toBeFalsy()
    await sheet.unmount()
    apiMock.mockImplementation(url => url.startsWith('/api/admin/classes/session?') ? Promise.resolve(detail({ booked: [], waitlist: [] })) : Promise.resolve({}))
    sessionSheet(occ(), { canManage: false, users: [], teachers: [] })
    sheet = await openLastSheet()
    expect(button(sheet.host, 'Mandar un mensaje a los anotados').disabled).toBe(true)
    expect(sheet.host.textContent).toContain('Cuando alguien se anote, le vas a poder escribir.')
    await sheet.unmount()
  })

  it('anotar a mano no ofrece a la profe de esa fecha', async () => {
    sessionSheet(occ(), { canManage: true, users: [{ id: 'profe', name: 'Caro' }, { id: 'beto', name: 'Beto' }], teachers: [] })
    const { host, unmount } = await openLastSheet()
    await act(async () => { button(host, 'Anotar a mano').click() })
    expect([...host.querySelectorAll('.member-form .tt')].map(e => e.textContent)).toEqual(['Beto'])
    await unmount()
  })
})

describe('compartir la lista', () => {
  const detail = { occurrence: occ(), canMessage: true, booked: [{ bookingId: 'b1', userId: 'ana', name: 'Ana Pérez', status: 'booked' }], waitlist: [] }
  beforeEach(() => {
    try { localStorage.removeItem('lauyim_share_names') } catch {}
    apiMock.mockImplementation(url => url.startsWith('/api/admin/classes/session?') ? Promise.resolve(detail) : Promise.resolve({}))
  })
  afterEach(() => { delete navigator.share })

  it('desde la hoja de la fecha: vista previa con inicial; cambia a nombre completo y lo recuerda; comparte', async () => {
    const shared = vi.fn(() => Promise.resolve())
    navigator.share = shared
    sessionSheet(occ(), { canManage: false, users: [], teachers: [] })
    let sheet = await openLastSheet()
    await act(async () => { button(sheet.host, 'Compartir lista').click() })
    await sheet.unmount()
    sheet = await openLastSheet()
    const preview = () => sheet.host.querySelector('.class-share-preview').textContent
    expect(preview()).toContain('1. Ana P.')
    await act(async () => { button(sheet.host, 'Nombre completo').click() })
    expect(preview()).toContain('1. Ana Pérez')
    expect(localStorage.getItem('lauyim_share_names')).toBe('full')
    await act(async () => { button(sheet.host, 'Compartir').click() })
    expect(shared).toHaveBeenCalledWith({ text: expect.stringContaining('Anotados (1/12):') })
    await sheet.unmount()
  })

  it('sin compartir del sistema (PC): copia y ofrece abrir WhatsApp', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { shareListSheet } = await import('./clases/SessionSheet.jsx')
    shareListSheet(occ(), detail)
    const sheet = await openLastSheet()
    await act(async () => { button(sheet.host, 'Compartir').click() })
    expect(writeText).toHaveBeenCalled()
    expect(sheet.host.querySelector('a[href^="https://wa.me/?text="]')).toBeTruthy()
    await sheet.unmount()
  })
})

describe('cierres en Clases', () => {
  it('el día cerrado sigue marcado y no hay botón de cerrar (está en Resumen)', async () => {
    apiMock.mockImplementation(url => {
      if (url.startsWith('/api/admin/classes/calendar')) return Promise.resolve({ ...calendar(), closures: [{ id: 'k2', from: '2026-10-07', to: '2026-10-07', reason: 'Feriado' }] })
      if (url === '/api/admin/classes/types') return Promise.resolve({ types: [], slots: [], teachers: [], canManage: true, canOwn: true, settings: {} })
      return Promise.resolve({})
    })
    await mount(<AdminClases />)
    expect(container.querySelector('.class-week-head span.closed').textContent).toBe('Mié 7')
    expect(button(container, 'Cerrar el gimnasio')).toBeFalsy()
  })
})

describe('eliminar una clase', () => {
  const confirmLast = async () => {
    for (let i = 0; i < 100 && !useUI.getState().sheets.at(-1)?.render; i++) await tick()
    return openLastSheet()
  }
  it('semanal suspendida: sin "Quitar de la vista"; "Eliminar del horario" pregunta solo ese día o toda la clase', async () => {
    sessionOcc = occ({ cancelled: true })
    apiMock.mockImplementation((url, opts) => {
      if (url.startsWith('/api/admin/classes/session?')) return Promise.resolve({ occurrence: sessionOcc, booked: [], waitlist: [] })
      if (url.startsWith('/api/admin/classes/retire-preview')) return Promise.resolve({ slot: { id: 's1', weekday: 3, start: '19:00', dates: 2, people: 5 }, class: { id: 'c1', name: 'Spinning', slots: 2, dates: 4, people: 9 } })
      return Promise.resolve({ ok: true, notified: 5 })
    })
    sessionSheet(sessionOcc, { canManage: true, users: [], teachers: [], onChange: vi.fn() })
    const sheet = await openLastSheet()
    expect(button(sheet.host, 'Quitar de la vista')).toBeFalsy()
    const n = useUI.getState().sheets.length
    await act(async () => { button(sheet.host, 'Eliminar del horario').click() })
    for (let i = 0; i < 100 && useUI.getState().sheets.length === n; i++) await tick()
    const retire = await confirmLast()
    expect(retire.host.textContent).toContain('Spinning deja de darse los miércoles 19:00.')
    expect(retire.host.textContent).toContain('Se borran 2 fechas y le avisamos a 5 personas.')
    await act(async () => { button(retire.host, 'Toda la clase').click() })
    expect(retire.host.textContent).toContain('Se borran 4 fechas y le avisamos a 9 personas.')
    await act(async () => { button(retire.host, 'Solo los miércoles 19:00').click() })
    await act(async () => { button(retire.host, 'Eliminar').click() })
    await tick()
    expect(apiMock).toHaveBeenCalledWith('/api/admin/classes/slots/delete', { method: 'POST', body: JSON.stringify({ id: 's1' }) })
    await retire.unmount(); await sheet.unmount()
  })

  it('suelta: "Eliminar esta clase" (suspende con aviso y la saca, en un paso)', async () => {
    sessionOcc = occ({ slotId: null })
    sessionSheet(sessionOcc, { canManage: true, users: [], teachers: [], onChange: vi.fn() })
    const sheet = await openLastSheet()
    expect(button(sheet.host, 'Eliminar del horario')).toBeFalsy()
    const n = useUI.getState().sheets.length
    await act(async () => { button(sheet.host, 'Eliminar esta clase').click() })
    for (let i = 0; i < 100 && useUI.getState().sheets.length === n; i++) await tick()
    const confirm = await confirmLast()
    await act(async () => { button(confirm.host, 'Eliminar').click() })
    await tick()
    expect(apiMock).toHaveBeenCalledWith('/api/admin/classes/sessions/delete', { method: 'POST', body: JSON.stringify({ sessionId: 'x1' }) })
    await confirm.unmount(); await sheet.unmount()
  })
})
