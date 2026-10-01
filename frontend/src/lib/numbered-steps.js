// Instrucciones de un ejercicio creado por un socio o por el staff, editadas como una lista
// numerada en un textarea: cada línea es un paso y lleva su número ("1. ", "2. "…). Todo cambio
// del texto pasa por normalizeSteps, que vuelve a numerar y recoloca el cursor: Enter agrega el
// número siguiente, borrar un salto de línea une dos pasos, y lo pegado se numera solo.
// Se guardan sin los números (ex.st), igual que las instrucciones del catálogo.
// Mismos límites que api/custom-exercise.js.
export const MAX_STEPS = 15
export const MAX_STEP_LENGTH = 300

// Número, viñeta o "1)" al principio de una línea. Necesita un espacio o el fin de la línea
// después, así "1.5 kg" no se toma como un número.
const PREFIX = /^\s*(?:\d+[.)]|[-•*])(?:\s|$)/

const contentOf = line => line.replace(PREFIX, '')
const prefixLength = line => (line.match(PREFIX) || [''])[0].length
const numbered = (contents) => contents.map((c, i) => `${i + 1}. ${c}`).join('\n')

export const stepsToText = steps => numbered(steps?.length ? steps : [''])

export const textToSteps = text => String(text || '').split('\n')
  .map(line => contentOf(line).trim().slice(0, MAX_STEP_LENGTH))
  .filter(Boolean)

// → { text, caret }: el texto con cada línea numerada, y el cursor en el mismo lugar del mismo
// paso (nunca dentro del número).
export function normalizeSteps(text, caret) {
  const lines = String(text || '').split('\n').slice(0, MAX_STEPS)
  let lineIndex = 0
  let column = 0
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    const end = offset + lines[i].length
    if (caret <= end || i === lines.length - 1) {
      lineIndex = i
      column = Math.max(0, Math.min(caret, end) - offset - prefixLength(lines[i]))
      break
    }
    offset = end + 1
  }
  const contents = lines.map(line => contentOf(line).slice(0, MAX_STEP_LENGTH))
  const out = numbered(contents)
  let newCaret = 0
  for (let i = 0; i < lineIndex; i++) newCaret += `${i + 1}. `.length + contents[i].length + 1
  newCaret += `${lineIndex + 1}. `.length + Math.min(column, contents[lineIndex].length)
  return { text: out, caret: newCaret }
}

// Enter: corta el paso en el cursor y numera el nuevo. null si ya se llegó al máximo de pasos.
export function enterSteps(text, caret, selectionEnd = caret) {
  if (String(text || '').split('\n').length >= MAX_STEPS) return null
  return normalizeSteps(text.slice(0, caret) + '\n' + text.slice(selectionEnd), caret + 1)
}

// Backspace con el cursor en el número de un paso (o justo después): une el paso con el
// anterior en vez de borrar el número a medias. En el primer paso no hace nada. null si el
// cursor está en el texto del paso (el Backspace normal alcanza).
export function backspaceSteps(text, caret) {
  const before = text.slice(0, caret)
  const lineStart = before.lastIndexOf('\n') + 1
  const line = text.slice(lineStart).split('\n')[0]
  if (caret - lineStart > prefixLength(line)) return null
  if (lineStart === 0) return { text, caret: prefixLength(line) }
  const previousEnd = lineStart - 1
  return normalizeSteps(text.slice(0, previousEnd) + contentOf(line) + text.slice(lineStart + line.length), previousEnd)
}
