import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Modals from './Modals.jsx'

const mocks = vi.hoisted(() => {
  const listeners = new Set()
  const state = {
    sheets: [],
    closeSheet(id) {
      state.sheets = state.sheets.filter(sheet => sheet.id !== id)
      listeners.forEach(listener => listener())
    },
    setSheetOnBack(id, fn) {
      const cur = state.sheets.find(sheet => sheet.id === id)
      if (!cur || cur.onBack === fn) return
      state.sheets = state.sheets.map(sheet => sheet.id === id ? { ...sheet, onBack: fn } : sheet)
      listeners.forEach(listener => listener())
    },
  }
  return {
    state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setSheets(sheets) {
      state.sheets = sheets
      listeners.forEach(listener => listener())
    },
  }
})

vi.mock('../store/useUI.js', async () => {
  const React = await import('react')
  const useUI = (selector = state => state) => React.useSyncExternalStore(
    mocks.subscribe,
    () => selector(mocks.state),
    () => selector(mocks.state),
  )
  useUI.getState = () => mocks.state
  return { useUI }
})

let dom
let root
let container
let historyMock
let locationMock

function sheet(id, { locked = false, render = () => React.createElement('div') } = {}) {
  return { id, locked, kind: 'sheet', render }
}

function installDom() {
  const parsed = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  dom = parsed.window
  dom.scrollTo = vi.fn()
  globalThis.window = dom
  globalThis.document = dom.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  for (const key of ['HTMLElement', 'Node', 'Element', 'Event']) globalThis[key] = dom[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  locationMock = { href: 'https://opengym.test/#/workout' }
  historyMock = { pushState: vi.fn(), go: vi.fn() }
  Object.defineProperty(globalThis, 'location', { configurable: true, value: locationMock })
  Object.defineProperty(globalThis, 'history', { configurable: true, value: historyMock })

  container = document.getElementById('root')
  root = createRoot(container)
}

async function setSheets(sheets) {
  await act(async () => { mocks.setSheets(sheets) })
}

async function popstate() {
  await act(async () => { window.dispatchEvent(new dom.Event('popstate')) })
}

function mouse(target, type, clientY) {
  const event = new dom.Event(type, { bubbles: true })
  Object.defineProperties(event, {
    button: { value: 0 },
    clientY: { value: clientY },
  })
  target.dispatchEvent(event)
}

beforeEach(async () => {
  mocks.state.sheets = []
  installDom()
  await act(async () => { root.render(React.createElement(Modals)) })
})

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  root = null
  container = null
  dom = null
  vi.restoreAllMocks()
})

describe('Modals sheet history accounting', () => {
  it('does not rewind a real page after back spends a locked FinishSummary entry', async () => {
    const confirm = sheet('confirm')
    const summary = sheet('summary', { locked: true })

    await setSheets([confirm])
    expect(historyMock.pushState).toHaveBeenCalledTimes(1)

    // ConfirmDialog closes and FinishSummary opens in the same batch: length remains one,
    // so the existing pushed entry now belongs to the locked summary.
    await setSheets([summary])
    await popstate()
    expect(mocks.state.sheets).toEqual([summary])

    await act(async () => { mocks.state.closeSheet('summary') })
    expect(historyMock.go).not.toHaveBeenCalled()
  })

  it('pushes and rewinds the exact number of entries for batched sheets', async () => {
    await setSheets([sheet('one'), sheet('two')])
    expect(historyMock.pushState).toHaveBeenCalledTimes(2)

    await setSheets([])
    expect(historyMock.go).toHaveBeenCalledTimes(1)
    expect(historyMock.go).toHaveBeenCalledWith(-2)
  })

  it('closes stacked sheets one entry at a time on back', async () => {
    await setSheets([sheet('one'), sheet('two')])
    await popstate()

    expect(mocks.state.sheets.map(item => item.id)).toEqual(['one'])
    expect(historyMock.pushState).toHaveBeenCalledTimes(2)

    await popstate()
    expect(mocks.state.sheets).toEqual([])
    expect(historyMock.go).not.toHaveBeenCalled()
  })

  it('closes an unlocked sheet on back without rewinding its already-spent entry', async () => {
    await setSheets([sheet('open')])
    await popstate()

    expect(mocks.state.sheets).toEqual([])
    expect(historyMock.go).not.toHaveBeenCalled()
  })

  it('accounts for a moved-on entry even when popstate has no current sheet', async () => {
    await setSheets([sheet('navigating')])
    locationMock.href = 'https://opengym.test/#/home'
    await setSheets([])
    expect(historyMock.go).not.toHaveBeenCalled()

    // This spends the deliberately leaked entry with top === undefined.
    await popstate()

    const locked = sheet('locked', { locked: true })
    await setSheets([locked])
    await popstate()
    await setSheets([])
    expect(historyMock.go).not.toHaveBeenCalled()
  })
})

describe('Modals sheet callback identity', () => {
  // Regresión: "Administrar Nutrición/Rutina" dejaba la app en pantalla negra. El contenido
  // registra su onBack en un efecto que depende de close/setOnBack; si esas funciones cambiaban
  // de identidad en cada render, el efecto se realimentaba hasta "Maximum update depth exceeded"
  // y el árbol entero moría.
  it('keeps close and setOnBack stable so a setOnBack effect cannot loop', async () => {
    let renders = 0
    const Content = ({ close, setOnBack }) => {
      renders++
      React.useEffect(() => { setOnBack(() => close()) }, [close, setOnBack])
      return React.createElement('div', null, 'content')
    }

    await setSheets([sheet('manage', {
      locked: true,
      render: (close, { setOnBack }) => React.createElement(Content, { close, setOnBack }),
    })])

    expect(renders).toBeLessThanOrEqual(4)
    expect(typeof mocks.state.sheets[0].onBack).toBe('function')

    const settled = renders
    await act(async () => {})
    expect(renders).toBe(settled)
  })
})

describe('Modals mouse dragging', () => {
  it('does not start sheet dragging from editable fields', async () => {
    await setSheets([sheet('textarea', {
      render: () => React.createElement('textarea'),
    })])
    const sheetEl = container.querySelector('.sheet')
    const textarea = container.querySelector('textarea')
    sheetEl.scrollTop = 0

    await act(async () => {
      mouse(textarea, 'mousedown', 10)
      mouse(sheetEl, 'mousemove', 150)
      window.dispatchEvent(new dom.Event('mouseup'))
    })

    expect(sheetEl.style.transform).toBe('')
    expect(mocks.state.sheets).toHaveLength(1)
  })

  it('leaves range sliders opted out of sheet dragging', async () => {
    await setSheets([sheet('slider', {
      render: () => React.createElement('input', { type: 'range' }),
    })])
    const sheetEl = container.querySelector('.sheet')
    const slider = container.querySelector('input[type="range"]')
    sheetEl.scrollTop = 0

    await act(async () => {
      mouse(slider, 'mousedown', 10)
      mouse(sheetEl, 'mousemove', 150)
      window.dispatchEvent(new dom.Event('mouseup'))
    })

    expect(sheetEl.style.transform).toBe('')
    expect(mocks.state.sheets).toHaveLength(1)
  })

  it('releases a drag when mouseup occurs outside the sheet', async () => {
    await setSheets([sheet('drag')])
    const sheetEl = container.querySelector('.sheet')
    sheetEl.scrollTop = 0

    await act(async () => {
      mouse(sheetEl, 'mousedown', 10)
      mouse(sheetEl, 'mousemove', 60)
    })
    expect(sheetEl.style.transform).toBe('translateY(50px)')

    await act(async () => { window.dispatchEvent(new dom.Event('mouseup')) })
    expect(sheetEl.style.transform).toBe('')

    await act(async () => { mouse(sheetEl, 'mousemove', 120) })
    expect(sheetEl.style.transform).toBe('')
    expect(mocks.state.sheets).toHaveLength(1)
  })
})
