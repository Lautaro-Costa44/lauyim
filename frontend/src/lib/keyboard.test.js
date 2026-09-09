import { afterEach, describe, expect, it, vi } from 'vitest'
import { installKeyboardViewport, syncKeyboardViewport } from './keyboard.js'

const originalVisualViewport = window.visualViewport

afterEach(() => {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: originalVisualViewport })
  document.documentElement.style.removeProperty('--viewport-height')
  document.documentElement.style.removeProperty('--keyboard-offset')
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('keyboard viewport management', () => {
  it('publishes the visual viewport and keyboard offset as CSS variables', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: 520, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    })

    syncKeyboardViewport()

    expect(document.documentElement.style.getPropertyValue('--viewport-height')).toBe('520px')
    expect(document.documentElement.style.getPropertyValue('--keyboard-offset')).toBe('324px')
  })

  it('keeps a focused sheet field above the visible keyboard area', async () => {
    const sheet = document.createElement('div')
    sheet.className = 'sheet'
    const input = document.createElement('input')
    sheet.append(input)
    document.body.append(sheet)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: 520, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(); return 1 })
    vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 520 })
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ top: 470, bottom: 510 })
    Object.defineProperty(sheet, 'scrollTop', { configurable: true, writable: true, value: 0 })

    const cleanup = installKeyboardViewport()
    input.focus()
    document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))

    expect(sheet.scrollTop).toBe(6)
    cleanup()
  })
})
