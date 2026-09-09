import { describe, expect, it } from 'vitest'
import { disableKeyboardAutofill } from './input-safety.js'

describe('input safety', () => {
  it('preserves input semantics while disabling autofill surfaces', () => {
    const root = document.createElement('div')
    root.innerHTML = '<input type="number" step="0.5"><input type="text"><textarea></textarea>'
    disableKeyboardAutofill(root)

    const [number, text] = root.querySelectorAll('input')
    expect(number.type).toBe('number')
    expect(number.inputMode).toBe('decimal')
    expect(text.type).toBe('text')
    expect(text.getAttribute('enterkeyhint')).toBe('next')
    for (const field of root.querySelectorAll('input, textarea')) {
      expect(field.getAttribute('name')).toMatch(/^app_field_/)
      expect(field.getAttribute('autocomplete')).toBe('off')
      expect(field.getAttribute('autocorrect')).toBe('off')
      expect(field.getAttribute('data-1p-ignore')).toBe('true')
      expect(field.getAttribute('data-bwignore')).toBe('true')
      expect(field.getAttribute('data-lpignore')).toBe('true')
    }
  })
})
