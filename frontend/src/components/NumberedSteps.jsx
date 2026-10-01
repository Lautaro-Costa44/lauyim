import { useLayoutEffect, useRef, useState } from 'react'
import { NO_AUTOFILL } from '../lib/input-safety.js'
import { stepsToText, textToSteps, normalizeSteps, enterSteps, backspaceSteps, MAX_STEPS } from '../lib/numbered-steps.js'
import { t } from '../lib/i18n.js'

// Instrucciones como lista numerada en un textarea (ver lib/numbered-steps.js): Enter agrega el
// número siguiente, Backspace en un número une el paso con el anterior y lo pegado se numera.
// `value` y `onChange` son la lista de pasos sin números (lo que se guarda en ex.st).
export default function NumberedSteps({ value, onChange, name = 'app-exercise-steps' }) {
  const [text, setText] = useState(() => stepsToText(value))
  const ref = useRef(null)
  const caret = useRef(null)

  useLayoutEffect(() => {
    if (caret.current === null || !ref.current) return
    ref.current.setSelectionRange(caret.current, caret.current)
    caret.current = null
  }, [text])

  const apply = next => {
    caret.current = next.caret
    setText(next.text)
    onChange(textToSteps(next.text))
  }
  const onKeyDown = e => {
    const el = e.currentTarget
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      const next = enterSteps(el.value, el.selectionStart, el.selectionEnd)
      if (next) apply(next)
    } else if (e.key === 'Backspace' && el.selectionStart === el.selectionEnd) {
      const next = backspaceSteps(el.value, el.selectionStart)
      if (next) { e.preventDefault(); apply(next) }
    }
  }
  const lines = text.split('\n').length
  return <>
    <textarea {...NO_AUTOFILL} ref={ref} name={name} className="input steps-input" rows={Math.max(3, lines)}
      aria-label={t('Instrucciones')} value={text} onKeyDown={onKeyDown}
      onChange={e => apply(normalizeSteps(e.target.value, e.target.selectionStart))} />
    <div className="small dim steps-hint">
      {lines >= MAX_STEPS ? t('Máximo {0} pasos.', MAX_STEPS) : t('Enter agrega el paso siguiente.')}
    </div>
  </>
}
