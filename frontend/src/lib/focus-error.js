// Foco en el primer campo con error de un formulario (en el orden en que se ve), después de que
// React dibuje los mensajes. Los campos con error llevan aria-invalid="true".
export function focusFirstInvalid(root) {
  const run = () => {
    const el = (root || document).querySelector('[aria-invalid="true"]')
    if (!el) return
    el.focus({ preventScroll: true })
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(run))
  else setTimeout(run, 0)
}
