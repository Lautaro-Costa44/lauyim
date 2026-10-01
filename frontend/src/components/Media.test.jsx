// @vitest-environment happy-dom
// "Ver instrucciones" sobre el gif: despliega y pliega la lista debajo, sin pausar el gif.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const { default: Media } = await import('./Media.jsx')
const { setLang } = await import('../lib/i18n.js')
const { useStore } = await import('../store/useStore.js')

const EX = { id: '0025', gif: '0025.gif', img: '0025.jpg', n: 'Bench press' }
let root, container
const mount = async (props, ex = EX) => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<Media ex={ex} {...props} />) })
}
const button = () => container.querySelector('.gifsteps')
beforeEach(async () => { await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true })
afterEach(async () => { await act(async () => { root.unmount() }); container.remove(); useStore.setState({ config: null }) })

describe('Media: instrucciones', () => {
  it('el botón despliega y pliega la lista debajo del gif, sin pausarlo', async () => {
    await mount({ steps: ['Acostate en el banco.', 'Bajá la barra al pecho.'] })
    const steps = container.querySelector('.exsteps')
    expect(button().textContent).toBe('Ver instrucciones')
    expect(button().getAttribute('aria-expanded')).toBe('false')
    expect(steps.classList.contains('open')).toBe(false)
    expect(steps.getAttribute('aria-hidden')).toBe('true')
    expect([...steps.querySelectorAll('li')].map(li => li.textContent)).toEqual(['Acostate en el banco.', 'Bajá la barra al pecho.'])
    // La lista está después del gif, no adentro.
    expect(container.querySelector('.exmedia').nextElementSibling).toBe(steps)
    await act(async () => { button().click() })
    expect(steps.classList.contains('open')).toBe(true)
    expect(button().textContent).toBe('Ocultar instrucciones')
    expect(container.querySelector('img').getAttribute('src')).toContain('.gif')   // el gif sigue andando
    await act(async () => { button().click() })
    expect(steps.classList.contains('open')).toBe(false)
  })

  it('sin instrucciones no hay botón ni lista', async () => {
    await mount({ steps: [] })
    expect(button()).toBeNull()
    expect(container.querySelector('.exsteps')).toBeNull()
  })
})

const CUSTOM = { id: 'cx', n: 'Remo en polea', bp: 'back', tg: 'upper back', primaries: ['back'], secondaries: ['biceps'], custom: true }

describe('Media: mapa muscular en lugar del gif', () => {
  it('con EXERCISE_GIFS apagado, el catálogo muestra el mapa y conserva "Ver instrucciones"', async () => {
    useStore.setState({ config: { exercise_gifs: false } })
    await mount({ steps: ['Acostate en el banco.'] }, { ...EX, bp: 'chest', tg: 'pectorals' })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.exmedia.exmap .bodymap')).not.toBeNull()
    expect(button().textContent).toBe('Ver instrucciones')
  })

  it('un ejercicio propio muestra el mapa, salvo que lo hayan apagado', async () => {
    await mount({}, CUSTOM)
    expect(container.querySelector('.exmedia.exmap')).not.toBeNull()
    await act(async () => { root.render(<Media ex={{ ...CUSTOM, map: false }} />) })
    expect(container.querySelector('.exmedia')).toBeNull()
  })
})
