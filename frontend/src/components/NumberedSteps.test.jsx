// @vitest-environment happy-dom
// Editor de instrucciones numeradas: Enter agrega el número siguiente y avisa la lista sin números.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { default: NumberedSteps } = await import('./NumberedSteps.jsx')

let root, container
const mount = async props => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<NumberedSteps {...props} />) })
}
const area = () => container.querySelector('textarea')
const key = async (k) => {
  await act(async () => { area().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) })
}
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true })
afterEach(async () => { await act(async () => { root.unmount() }); container.remove() })

describe('NumberedSteps', () => {
  it('arranca en "1. " y Enter agrega "2. " con el cursor después', async () => {
    const onChange = vi.fn()
    await mount({ value: [], onChange })
    expect(area().value).toBe('1. ')
    area().value = '1. Sentate.'
    area().setSelectionRange(11, 11)
    await key('Enter')
    expect(area().value).toBe('1. Sentate.\n2. ')
    expect(area().selectionStart).toBe('1. Sentate.\n2. '.length)
    expect(onChange).toHaveBeenLastCalledWith(['Sentate.'])
  })

  it('muestra los pasos que ya tenía, numerados', async () => {
    await mount({ value: ['Sentate.', 'Tirá.'], onChange: () => {} })
    expect(area().value).toBe('1. Sentate.\n2. Tirá.')
  })

  it('Backspace en el número une el paso con el anterior', async () => {
    const onChange = vi.fn()
    await mount({ value: ['Sentate.', 'Tirá.'], onChange })
    const at = '1. Sentate.\n2. '.length
    area().setSelectionRange(at, at)
    await key('Backspace')
    expect(area().value).toBe('1. Sentate.Tirá.')
    expect(onChange).toHaveBeenLastCalledWith(['Sentate.Tirá.'])
  })
})
