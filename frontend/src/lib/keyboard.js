const EDITABLE_SELECTOR = 'input:not([type="file"]):not([type="hidden"]), textarea, [contenteditable="true"]'

const raf = callback => {
  if (typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(callback)
  return window.setTimeout(callback, 0)
}

const cancelRaf = id => {
  if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(id)
  else window.clearTimeout(id)
}

export function syncKeyboardViewport() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const viewport = window.visualViewport
  const visibleHeight = Math.max(1, viewport?.height || window.innerHeight || document.documentElement.clientHeight || 1)
  const viewportTop = Math.max(0, viewport?.offsetTop || 0)
  const keyboardOffset = Math.max(0, (window.innerHeight || visibleHeight) - visibleHeight - viewportTop)
  const root = document.documentElement
  root.style.setProperty('--viewport-height', `${visibleHeight}px`)
  root.style.setProperty('--keyboard-offset', `${keyboardOffset}px`)
}

function isEditable(element) {
  return element instanceof Element && element.matches(EDITABLE_SELECTOR)
}

function keepFocusedFieldVisible() {
  const active = document.activeElement
  if (!isEditable(active)) return

  const viewport = window.visualViewport
  const top = Math.max(0, viewport?.offsetTop || 0)
  const bottom = Math.min(window.innerHeight || Infinity, (viewport?.height || window.innerHeight || Infinity) + top)
  const rect = active.getBoundingClientRect()
  const margin = 16
  const sheet = active.closest('.sheet, .center')

  if (sheet) {
    const scrollContainer = sheet.querySelector('.compound-builder-content') || sheet
    const containerRect = scrollContainer.getBoundingClientRect()
    const visibleTop = Math.max(top + margin, containerRect.top + margin)
    const visibleBottom = Math.min(bottom - margin, containerRect.bottom - margin)
    if (rect.bottom > visibleBottom) scrollContainer.scrollTop += rect.bottom - visibleBottom
    else if (rect.top < visibleTop) scrollContainer.scrollTop -= visibleTop - rect.top
    return
  }

  if (rect.bottom > bottom - margin || rect.top < top + margin) {
    active.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }
}

export function installKeyboardViewport() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const viewport = window.visualViewport
  let frame = null
  const schedule = () => {
    if (frame !== null) return
    frame = raf(() => {
      frame = null
      syncKeyboardViewport()
      keepFocusedFieldVisible()
    })
  }
  const onFocusIn = event => {
    if (isEditable(event.target)) schedule()
  }

  syncKeyboardViewport()
  document.addEventListener('focusin', onFocusIn, true)
  window.addEventListener('resize', schedule, { passive: true })
  window.addEventListener('orientationchange', schedule, { passive: true })
  viewport?.addEventListener('resize', schedule, { passive: true })
  viewport?.addEventListener('scroll', schedule, { passive: true })

  return () => {
    document.removeEventListener('focusin', onFocusIn, true)
    window.removeEventListener('resize', schedule)
    window.removeEventListener('orientationchange', schedule)
    viewport?.removeEventListener('resize', schedule)
    viewport?.removeEventListener('scroll', schedule)
    if (frame !== null) cancelRaf(frame)
  }
}
