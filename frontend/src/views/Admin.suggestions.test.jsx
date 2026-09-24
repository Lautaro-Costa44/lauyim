// @vitest-environment happy-dom
// Recorre "Administrar Nutrición/Rutina" como lo hace un admin real: toca los controles,
// navega el wizard de sugerencias, crea comidas y edita la lista. Los bugs que motivaron
// estos tests (pantalla negra, "te saca del control de usuario") no aparecen en tests de
// unidad: sólo se ven montando el árbol entero y haciendo clic paso a paso.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
// El escáner de códigos de barras toca APIs de cámara que no existen fuera del navegador.
vi.mock('html5-qrcode/third_party/zxing-js.umd.js', () => ({ BrowserMultiFormatReader: class {} }))

const { AdminManageSheet } = await import('./admin/shared.jsx')
const { default: Modals } = await import('../components/Modals.jsx')
const { useUI } = await import('../store/useUI.js')
const { bindUI } = await import('../components/ui.jsx')
const { setLang } = await import('../lib/i18n.js')

// Mismo binding que hace App.jsx al arrancar: sin esto los controles compartidos no pueden
// abrir sheets (Objetivo, confirmaciones).
bindUI(useUI)

const TEMPLATE = {
  id: 10, nombre: 'Pollo con arroz', categoria: 'fitness', franjas: ['almuerzo'],
  ingredientes: [{ nombre_alimento: 'Pollo', cantidad_gramos: 150, calorias: 250, proteina: 45, carbohidratos: 0, grasas: 6 }],
}

let goals
let suggestions
let limitarSugeridas
let lesiones
let container
let root
let close

// Router mínimo con el mismo contrato que el server real, para que cada clic recorra el
// camino de datos de verdad en vez de un stub por pantalla.
function handleApi(url, options = {}) {
  const method = options.method || 'GET'
  const body = options.body ? JSON.parse(options.body) : null
  if (method === 'GET' && /\/nutrition$/.test(url)) return Promise.resolve({ goals, suggestions, userObjetivo: 'hipertrofia', limitarSugeridas })
  if (method === 'PUT' && /\/nutrition\/goals$/.test(url)) { goals = { ...goals, ...body }; return Promise.resolve({ goals }) }
  if (method === 'PUT' && /\/suggestions-limit$/.test(url)) { limitarSugeridas = body.limitarSugeridas; return Promise.resolve({ limitarSugeridas }) }
  if (method === 'GET' && /\/admin\/nutrition\/templates$/.test(url)) return Promise.resolve({ templates: [TEMPLATE] })
  if (method === 'POST' && /\/admin\/nutrition\/templates$/.test(url)) return Promise.resolve({ template: { ...TEMPLATE, id: 11, nombre: body.nombre } })
  if (method === 'POST' && /\/nutrition\/suggestions$/.test(url)) {
    suggestions = [...suggestions, { ...TEMPLATE, id: 99, sourcePlantillaId: body.plantilla_id, franjas: [body.franja], enabled: true, position: 0 }]
    return Promise.resolve({ suggestion: suggestions[suggestions.length - 1] })
  }
  if (method === 'POST' && /\/nutrition\/suggestions\/custom$/.test(url)) {
    suggestions = [...suggestions, { ...TEMPLATE, id: 98, nombre: body.nombre, franjas: ['extra'], enabled: true, position: 1 }]
    return Promise.resolve({ suggestion: suggestions[suggestions.length - 1] })
  }
  if (method === 'PUT' && /\/nutrition\/suggestions\/\d+$/.test(url)) return Promise.resolve({ suggestion: { ...TEMPLATE, ...body } })
  if (method === 'DELETE' && /\/nutrition\/suggestions\/\d+$/.test(url)) {
    const id = Number(url.split('/').pop())
    suggestions = suggestions.filter(s => s.id !== id)
    return Promise.resolve({ ok: true })
  }
  if (method === 'PUT' && /\/injuries$/.test(url)) { lesiones = body.lesiones; return Promise.resolve({ ok: true }) }
  if (method === 'GET' && /\/routines$/.test(url)) return Promise.resolve({ routines: [], week: {}, dayPlan: {}, routineGroups: [], lesiones, unit: 'kg', body: 'male' })
  return Promise.reject(new Error('ruta no mockeada: ' + method + ' ' + url))
}

const text = () => container.textContent
const all = selector => [...container.querySelectorAll(selector)]
// Coincidencia exacta primero: "Guardar" no debe agarrar "Guardar metas".
const byText = (selector, label) => all(selector).find(el => el.textContent.trim() === label)
  || all(selector).find(el => el.textContent.includes(label))

async function click(el) {
  expect(el, 'el control buscado no está en pantalla').toBeTruthy()
  await act(async () => { el.click() })
  await act(async () => {})
}

async function clickText(selector, label) {
  await click(byText(selector, label))
}

// React ignora una asignación directa a .value (su value tracker cree que no cambió nada),
// así que se escribe por el setter nativo, igual que hace un teclado real.
async function type(input, value) {
  expect(input, 'el campo buscado no está en pantalla').toBeTruthy()
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {})
}

beforeEach(async () => {
  goals = { mode: 'automatic', objetivo: null, calories: null, caloriesBurn: null, protein: null, carbs: null, fat: null }
  suggestions = []
  limitarSugeridas = true
  lesiones = []
  apiMock.mockReset()
  apiMock.mockImplementation(handleApi)
  close = vi.fn()
  useUI.setState({ sheets: [] })
  // i18n carga el diccionario español de forma asíncrona al importarse: sin esperarlo el
  // primer render sale con las claves en inglés y buscar por texto es una carrera.
  await setLang('es')

  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    // Modals va montado igual que en App.jsx: los sheets anidados que abre esta pantalla
    // (elegir Objetivo, confirmar un borrado) son parte del flujo real.
    root.render(React.createElement(React.Fragment, null,
      React.createElement(AdminManageSheet, { userId: 'u1', userName: 'Ana', close, setOnBack: () => {} }),
      React.createElement(Modals),
    ))
  })
  await act(async () => {})
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.restoreAllMocks()
})

describe('Administrar Nutrición/Rutina — metas', () => {
  it('muestra los campos manuales y los guarda sin salir del sheet', async () => {
    expect(text()).toContain('Metas nutricionales')

    await click(container.querySelector('[role="switch"]'))
    expect(text()).toContain('Kcalorías a consumir')

    await type(byText('.lrow', 'Kcalorías a consumir').querySelector('input'), '2100')
    await type(byText('.lrow', 'Proteínas (g)').querySelector('input'), '150')

    await clickText('button', 'Guardar metas')

    const saved = apiMock.mock.calls.find(([url, opt]) => opt?.method === 'PUT' && /\/nutrition\/goals$/.test(url))
    expect(saved, 'no se hizo el PUT de metas').toBeTruthy()
    expect(JSON.parse(saved[1].body)).toMatchObject({ mode: 'manual', calories: 2100, protein: 150 })
    expect(close).not.toHaveBeenCalled()
    expect(text()).toContain('Metas nutricionales')
  })

  it('elige un objetivo desde su sheet y lo manda con las metas', async () => {
    await click(container.querySelector('[role="switch"]'))
    await clickText('.lrow', 'Objetivo')
    expect(text()).toContain('Perder grasa')

    await clickText('#modal-root .lrow', 'Perder grasa')
    await clickText('button', 'Guardar metas')

    const saved = apiMock.mock.calls.find(([url, opt]) => opt?.method === 'PUT' && /\/nutrition\/goals$/.test(url))
    expect(JSON.parse(saved[1].body)).toMatchObject({ mode: 'manual', objetivo: 'perder_grasa' })
    expect(close).not.toHaveBeenCalled()
  })

  it('muestra un error inline y no guarda un macro mayor al límite', async () => {
    await click(container.querySelector('[role="switch"]'))
    await type(byText('.lrow', 'Proteínas (g)').querySelector('input'), '2000.1')
    const callsBeforeSave = apiMock.mock.calls.length

    await clickText('button', 'Guardar metas')

    expect(text()).toContain('Proteínas: máximo 2000 g')
    expect(apiMock.mock.calls.slice(callsBeforeSave).some(([, options]) => options?.method === 'PUT')).toBe(false)
  })

  it('permite guardar un macro igual a cero', async () => {
    await click(container.querySelector('[role="switch"]'))
    await type(byText('.lrow', 'Proteínas (g)').querySelector('input'), '0')

    await clickText('button', 'Guardar metas')

    const saved = apiMock.mock.calls.find(([url, options]) => options?.method === 'PUT' && /\/nutrition\/goals$/.test(url))
    expect(saved).toBeTruthy()
    expect(JSON.parse(saved[1].body)).toMatchObject({ mode: 'manual', protein: 0 })
  })
})

describe('Administrar Nutrición/Rutina — sugerencias', () => {
  // El bug reportado: tocar cualquiera de las dos opciones del chooser cerraba el sheet
  // entero y devolvía al admin a la lista de socios.
  it('abre el chooser y las dos ramas se quedan dentro del sheet', async () => {
    await clickText('button', 'Agregar sugerencia')
    expect(text()).toContain('Desde plantilla existente')

    await clickText('button', 'Desde plantilla existente')
    expect(close).not.toHaveBeenCalled()
    expect(text()).toContain('Elegir plantilla existente')
    expect(text()).toContain('Pollo con arroz')
  })

  it('asigna una plantilla a una franja de punta a punta', async () => {
    await clickText('button', 'Agregar sugerencia')
    await clickText('button', 'Desde plantilla existente')
    await clickText('.lrow', 'Pollo con arroz')
    expect(text()).toContain('Ingredientes')

    await clickText('button', 'Agregar')
    expect(text()).toContain('¿A qué franja querés agregarla?')

    await clickText('.survey-pill', 'Cena')
    await clickText('button', 'Confirmar')

    const posted = apiMock.mock.calls.find(([url, opt]) => opt?.method === 'POST' && /\/nutrition\/suggestions$/.test(url))
    expect(posted, 'no se asignó la sugerencia').toBeTruthy()
    expect(JSON.parse(posted[1].body)).toMatchObject({ plantilla_id: 10, franja: 'cena' })
    expect(close).not.toHaveBeenCalled()
    expect(text()).toContain('Metas nutricionales')
  })

  it('abre el editor custom desde "Crear nueva"', async () => {
    await clickText('button', 'Agregar sugerencia')
    await clickText('button', 'Crear nueva')

    expect(close).not.toHaveBeenCalled()
    expect(text()).toContain('Nueva sugerencia')
  })

  it('cancelar una comida global vuelve al catálogo, no cierra el wizard', async () => {
    await clickText('button', 'Agregar sugerencia')
    await clickText('button', 'Desde plantilla existente')
    await clickText('button', 'Crear comida global')
    expect(text()).toContain('Franjas')

    await clickText('button', 'Cancelar')
    expect(close).not.toHaveBeenCalled()
    expect(text()).toContain('Elegir plantilla existente')
  })
})

describe('Administrar Nutrición/Rutina — comidas', () => {
  // Agrega un ingrediente por la pestaña Manual del FoodPicker, el mismo componente que usa
  // el socio. Evita la búsqueda por red y recorre el armado real.
  async function agregarIngredienteManual(nombre) {
    await clickText('button', 'Agregar ingrediente')
    await clickText('.seg button', 'Manual')
    await type(byText('label', 'Nombre').querySelector('input'), nombre)
    for (const [label, value] of [['Gramos', '200'], ['Calorías / 100 g', '120'], ['Proteínas / 100 g', '20'], ['Carbohidratos / 100 g', '5'], ['Grasas / 100 g', '3']]) {
      await type(byText('label', label).querySelector('input'), value)
    }
    await clickText('button', 'Guardar comida')
  }

  it('crea una sugerencia custom para el socio de punta a punta', async () => {
    await clickText('button', 'Agregar sugerencia')
    await clickText('button', 'Crear nueva')

    await type(container.querySelector('input.field'), 'Licuado post entreno')
    await agregarIngredienteManual('Banana')
    expect(text()).toContain('Banana')

    await clickText('button', 'Guardar')

    const posted = apiMock.mock.calls.find(([url, opt]) => opt?.method === 'POST' && /\/suggestions\/custom$/.test(url))
    expect(posted, 'no se creó la sugerencia custom').toBeTruthy()
    expect(JSON.parse(posted[1].body)).toMatchObject({ nombre: 'Licuado post entreno' })
    expect(JSON.parse(posted[1].body).ingredientes).toHaveLength(1)
    expect(close).not.toHaveBeenCalled()
    expect(text()).toContain('Metas nutricionales')
  })

  it('crea una comida global y aterriza de vuelta en el catálogo', async () => {
    await clickText('button', 'Agregar sugerencia')
    await clickText('button', 'Desde plantilla existente')
    await clickText('button', 'Crear comida global')

    await type(container.querySelector('input.field'), 'Ensalada César')
    await clickText('.survey-pill', 'fitness')
    await clickText('.survey-pill', 'Cena')
    await agregarIngredienteManual('Lechuga')

    await clickText('button', 'Guardar')

    const posted = apiMock.mock.calls.find(([url, opt]) => opt?.method === 'POST' && /\/admin\/nutrition\/templates$/.test(url))
    expect(posted, 'no se creó la comida global').toBeTruthy()
    expect(JSON.parse(posted[1].body)).toMatchObject({ nombre: 'Ensalada César', categoria: 'fitness', franjas: ['cena'] })
    expect(close).not.toHaveBeenCalled()
    expect(text()).toContain('Elegir plantilla existente')
  })

  it('edita una sugerencia ya asignada desde la lista', async () => {
    suggestions = [{ ...TEMPLATE, id: 99, franjas: ['cena'], enabled: true, position: 0 }]
    await clickText('.seg button', 'Rutina')
    await clickText('.seg button', 'Nutrición')
    expect(text()).toContain('Pollo con arroz')

    await click(container.querySelector('[aria-label="Editar"]'))
    expect(close).not.toHaveBeenCalled()
    expect(text()).toContain('Editar sugerencia')
  })

  it('quita una sugerencia asignada por el sheet de confirmación', async () => {
    suggestions = [{ ...TEMPLATE, id: 99, franjas: ['cena'], enabled: true, position: 0 }]
    await clickText('.seg button', 'Rutina')
    await clickText('.seg button', 'Nutrición')

    await click(container.querySelector('[aria-label="Quitar"]'))
    expect(text()).toContain('¿Quitar sugerencia?')

    await clickText('#modal-root button', 'Quitar')
    expect(apiMock.mock.calls.some(([url, opt]) => opt?.method === 'DELETE' && url.endsWith('/suggestions/99'))).toBe(true)
    expect(close).not.toHaveBeenCalled()
  })
})

describe('Administrar Nutrición/Rutina — pestañas', () => {
  it('cambia a la pestaña Rutina y vuelve sin cerrarse', async () => {
    await clickText('.seg button', 'Rutina')
    expect(close).not.toHaveBeenCalled()
    expect(text()).toContain('Lesiones')

    await clickText('.seg button', 'Nutrición')
    expect(text()).toContain('Metas nutricionales')
  })

  it('apaga y vuelve a prender el límite de sugerencias', async () => {
    expect(text()).toContain('Sin sugerencias asignadas')

    const limitSwitch = () => byText('.lrow', 'Limitar comidas sugeridas').querySelector('[role="switch"]')
    await click(limitSwitch())
    expect(text()).toContain('Activá el toggle para asignarle sugerencias puntuales')

    await click(limitSwitch())
    expect(text()).toContain('Sin sugerencias asignadas')
    expect(close).not.toHaveBeenCalled()
  })
})
