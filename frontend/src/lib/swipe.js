// Swipe between exercises: the decisions, kept free of React and the DOM so each rule is a
// plain function a test can call. useSwipeNav wires them to pointer events.

// Anything you tap or drag on its own keeps its gesture: a stepper, a checkbox, a set row.
export const SWIPE_EXCLUDE = 'button, input, textarea, select, a, .stp, .chip, [role=checkbox], .setrow, .subrow, [data-noswipe]'
export const EDGE_PX = 20          // iOS "back" lives at the left edge
export const AXIS_LOCK_PX = 10     // how far the finger moves before the gesture picks an axis
export const COMMIT_FRACTION = 0.25
export const COMMIT_VELOCITY = 0.5 // px/ms — a flick changes exercise even when short
export const EDGE_RESISTANCE = 0.3

/** Whether a gesture starting here may become a swipe at all. */
export function swipeAllowed({ target, x, disabled }) {
  if (disabled) return false
  if (x < EDGE_PX) return false
  if (target && typeof target.closest === 'function' && target.closest(SWIPE_EXCLUDE)) return false
  return true
}

/** 'x', 'y', or null while the movement is still too small to tell. */
export function swipeAxis(dx, dy) {
  if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return null
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
}

/** How far the card follows the finger: fully, or with resistance where there is nothing to go to. */
export function swipeOffset(dx, { canPrev, canNext }) {
  if ((dx > 0 && !canPrev) || (dx < 0 && !canNext)) return dx * EDGE_RESISTANCE
  return dx
}

/** On release: 'prev', 'next' or null (spring back). Swiping left goes to the next exercise. */
export function swipeDecision({ dx, dt, width, canPrev, canNext }) {
  const far = Math.abs(dx) > width * COMMIT_FRACTION
  const fast = dt > 0 && Math.abs(dx) / dt > COMMIT_VELOCITY
  if (!far && !fast) return null
  if (dx < 0 && canNext) return 'next'
  if (dx > 0 && canPrev) return 'prev'
  return null
}
