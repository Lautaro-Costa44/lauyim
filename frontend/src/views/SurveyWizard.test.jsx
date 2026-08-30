import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SurveyWizard from './SurveyWizard.jsx'

const mocks = vi.hoisted(() => ({
  S: {
    unit: 'kg',
    bodyweight: [],
    routines: [],
    week: {},
    respuestasEncuesta: null,
  },
  update: vi.fn(),
  toast: vi.fn(),
  nav: vi.fn(),
}))

vi.mock('../store/useStore.js', () => ({
  useStore: selector => (typeof selector === 'function' ? selector({ S: mocks.S, update: mocks.update }) : { S: mocks.S, update: mocks.update }),
}))

vi.mock('../store/useUI.js', () => ({
  useUI: selector => (typeof selector === 'function' ? selector({ toast: mocks.toast }) : { toast: mocks.toast }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.nav,
}))

vi.mock('../components/Icon.jsx', () => ({
  default: props => React.createElement('span', props),
}))

vi.mock('../lib/exercises.js', () => {
  const mockDb = [
    { id: '0001', n: 'push up', bp: 'chest', eq: 'body weight', tg: 'pectorals' },
    { id: '0002', n: 'pull up', bp: 'back', eq: 'body weight', tg: 'lats' },
    { id: '0003', n: 'squat', bp: 'upper legs', eq: 'body weight', tg: 'quads' },
  ]
  return {
    EXDB: mockDb,
    CATALOGUE: mockDb,
  }
})

describe('SurveyWizard — §1.28 Test obligatorio avisoFrecuencia en el DOM', () => {
  let root = null
  let container = null

  beforeEach(() => {
    const win = new Window()
    globalThis.document = win.document
    globalThis.window = win
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container?.remove()
  })

  it('renderiza el banner con avisoFrecuencia en el DOM cuando se selecciona PPL con 3 días', () => {
    act(() => {
      root.render(React.createElement(SurveyWizard))
    })

    // Paso 1: Avanzar al paso 2 haciendo click en Siguiente
    const nextBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Siguiente'))
    expect(nextBtn).toBeDefined()

    act(() => {
      nextBtn.click()
    })

    // Paso 2: Seleccionar el botón de split PPL
    const pplOption = Array.from(container.querySelectorAll('.survey-option')).find(o =>
      o.textContent.includes('Push / Pull / Legs') || o.textContent.includes('PPL')
    )
    expect(pplOption).toBeDefined()

    act(() => {
      pplOption.click()
    })

    // Verificar que el banner de avisoFrecuencia está en el DOM con el texto esperado
    const banner = container.querySelector('.survey-banner')
    expect(banner).not.toBeNull()
    expect(banner.textContent).toContain('1 vez por semana')
  })
})
