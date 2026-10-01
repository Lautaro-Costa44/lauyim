// @vitest-environment happy-dom
// Ajustes con la personalización del gym: con "solo el color del gym" no hay paleta; con color
// del gym, su muestra va primera y reemplaza al lime de fábrica.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { default: Settings } = await import('./Settings.jsx')
const { useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { bindUI } = await import('../components/ui.jsx')
const { setLang } = await import('../lib/i18n.js')
bindUI(useUI)

let container, root
async function render(branding) {
  useStore.setState({ user: { id: 'm1', name: 'Socio', admin: false }, config: { branding } })
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<MemoryRouter><Settings /></MemoryRouter>) })
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}
const swatches = () => [...container.querySelectorAll('.swatches .swatch')].map(b => b.getAttribute('aria-label'))

beforeEach(async () => { await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true })
afterEach(async () => { await act(async () => { root.unmount() }); container.remove(); useStore.setState({ config: null }) })

describe('tema en Ajustes', () => {
  const themeButtons = () => [...container.querySelectorAll('button')].filter(b => ['Oscuro', 'Claro', 'Sistema'].includes(b.textContent.trim()))
  it('bloqueado por el gym: se ve el del gym y no se puede cambiar', async () => {
    useStore.setState({ S: { ...useStore.getState().S, theme: 'light' } })
    await render({ appName: 'Gym', color: null, lockColor: false, theme: 'dark', lockTheme: true })
    expect(themeButtons()).toHaveLength(3)
    expect(themeButtons().every(b => b.disabled)).toBe(true)
    expect(themeButtons().find(b => b.classList.contains('on')).textContent.trim()).toBe('Oscuro')
    expect(container.textContent).toContain('El gimnasio eligió el tema')
  })

  it('libre: cada uno elige', async () => {
    await render({ appName: 'Gym', color: null, lockColor: false, theme: 'dark', lockTheme: false })
    expect(themeButtons().some(b => b.disabled)).toBe(false)
    expect(container.textContent).not.toContain('El gimnasio eligió el tema')
  })
})

describe('paleta de colores en Ajustes', () => {
  it('sin color del gym: la paleta de siempre, con lime', async () => {
    await render({ appName: 'lauyim', color: null, lockColor: false })
    expect(swatches()).toContain('lime')
    expect(swatches()).not.toContain('Color del gimnasio')
  })

  it('con color del gym: va primero, elegido de entrada, y lime sale', async () => {
    await render({ appName: 'Gym', color: '#ff8800', lockColor: false })
    expect(swatches()[0]).toBe('Color del gimnasio')
    expect(swatches()).not.toContain('lime')
    expect(container.querySelector('.swatch.on').getAttribute('aria-label')).toBe('Color del gimnasio')
  })

  it('con "solo el color del gym": no hay paleta', async () => {
    await render({ appName: 'Gym', color: '#ff8800', lockColor: true })
    expect(swatches()).toEqual([])
  })
})
