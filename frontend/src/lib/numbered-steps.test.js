import { describe, expect, it } from 'vitest'
import { stepsToText, textToSteps, normalizeSteps, enterSteps, backspaceSteps, MAX_STEPS, MAX_STEP_LENGTH } from './numbered-steps.js'

describe('instrucciones numeradas', () => {
  it('una lista vacía arranca en "1. "', () => {
    expect(stepsToText([])).toBe('1. ')
    expect(stepsToText(['Sentate.', 'Tirá.'])).toBe('1. Sentate.\n2. Tirá.')
  })

  it('textToSteps saca los números y descarta las líneas vacías', () => {
    expect(textToSteps('1. Sentate.\n2. \n3. Tirá.')).toEqual(['Sentate.', 'Tirá.'])
    expect(textToSteps('1. ')).toEqual([])
  })

  it('Enter al final agrega el número siguiente y deja el cursor después de él', () => {
    const text = '1. Sentate.'
    const typed = text + '\n'
    expect(normalizeSteps(typed, typed.length)).toEqual({ text: '1. Sentate.\n2. ', caret: '1. Sentate.\n2. '.length })
  })

  it('Enter en el medio renumera lo que sigue', () => {
    const text = '1. Sentate.\n2. Tirá.'
    const caret = '1. Sentate.'.length
    const typed = text.slice(0, caret) + '\n' + text.slice(caret)
    expect(normalizeSteps(typed, caret + 1)).toEqual({ text: '1. Sentate.\n2. \n3. Tirá.', caret: '1. Sentate.\n2. '.length })
  })

  it('borrar el salto de línea une el paso con el anterior y renumera', () => {
    // Backspace al principio de "2. " deja "1. Sentate.2. Tirá." → queda un solo paso.
    expect(normalizeSteps('1. Sentate.\n3. Tirá.', 3).text).toBe('1. Sentate.\n2. Tirá.')
    const merged = normalizeSteps('1. Sentate.Tirá.', 11)
    expect(merged).toEqual({ text: '1. Sentate.Tirá.', caret: 11 })
  })

  it('un texto pegado se numera línea por línea, aunque traiga viñetas o "1)"', () => {
    expect(normalizeSteps('- Sentate.\n2) Tirá.\n• Volvé.', 0).text).toBe('1. Sentate.\n2. Tirá.\n3. Volvé.')
  })

  it('"1.5 kg" al principio de un paso no se toma como número', () => {
    expect(normalizeSteps('1. 1.5 kg por lado', 0).text).toBe('1. 1.5 kg por lado')
    expect(textToSteps('1. 1.5 kg por lado')).toEqual(['1.5 kg por lado'])
  })

  it('respeta el máximo de pasos y de largo por paso', () => {
    const many = Array.from({ length: MAX_STEPS + 3 }, (_, i) => `paso ${i}`).join('\n')
    expect(normalizeSteps(many, 0).text.split('\n')).toHaveLength(MAX_STEPS)
    const long = '1. ' + 'x'.repeat(MAX_STEP_LENGTH + 20)
    expect(textToSteps(normalizeSteps(long, 0).text)[0]).toHaveLength(MAX_STEP_LENGTH)
  })

  it('enterSteps corta el paso en el cursor y no pasa del máximo', () => {
    expect(enterSteps('1. Sentate y tirá.', '1. Sentate'.length)).toEqual({ text: '1. Sentate\n2.  y tirá.', caret: '1. Sentate\n2. '.length })
    const full = Array.from({ length: MAX_STEPS }, (_, i) => `${i + 1}. p`).join('\n')
    expect(enterSteps(full, full.length)).toBeNull()
  })

  it('backspaceSteps en el número une con el paso anterior; en el texto deja el Backspace normal', () => {
    const text = '1. Sentate.\n2. Tirá.\n3. Volvé.'
    const atSecond = '1. Sentate.\n2. '.length
    expect(backspaceSteps(text, atSecond)).toEqual({ text: '1. Sentate.Tirá.\n2. Volvé.', caret: '1. Sentate.'.length })
    expect(backspaceSteps(text, atSecond + 2)).toBeNull()
    expect(backspaceSteps('1. ', 3)).toEqual({ text: '1. ', caret: 3 })
  })
})
