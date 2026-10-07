// Horizontal swipe on an element to go to the previous / next exercise. Pointer Events, no
// dependencies; every decision lives in swipe.js. The element should have `touch-action: pan-y`
// so the browser keeps vertical scrolling and hands horizontal moves to us — when it does start
// scrolling it sends pointercancel, which ends the gesture here.
import { useEffect, useRef, useState } from 'react'
import { swipeAllowed, swipeAxis, swipeOffset, swipeDecision } from './swipe.js'

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const swallow = e => { e.stopPropagation(); e.preventDefault() }

export function useSwipeNav(ref, opts) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let g = null   // the gesture in progress: { id, x, y, t, axis, width }
    const end = () => { g = null; setDragging(false); setDx(0) }
    const down = e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (!swipeAllowed({ target: e.target, x: e.clientX, disabled: optsRef.current.disabled })) return
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, axis: null, width: el.getBoundingClientRect().width || 1 }
    }
    const move = e => {
      if (!g || e.pointerId !== g.id) return
      const ddx = e.clientX - g.x
      if (!g.axis) {
        g.axis = swipeAxis(ddx, e.clientY - g.y)
        if (g.axis === 'y') { g = null; return }
        if (g.axis === 'x') { setDragging(true); try { el.setPointerCapture(e.pointerId) } catch { /* */ } }
      }
      if (g.axis === 'x' && !reducedMotion()) setDx(swipeOffset(ddx, optsRef.current))
    }
    const up = e => {
      if (!g || e.pointerId !== g.id) return
      const gesture = g
      end()
      if (gesture.axis !== 'x') return
      // A drag that ends on the gif must not also pause it: drop the click that follows.
      el.addEventListener('click', swallow, true)
      setTimeout(() => el.removeEventListener('click', swallow, true), 350)
      const o = optsRef.current
      const dir = swipeDecision({ dx: e.clientX - gesture.x, dt: e.timeStamp - gesture.t, width: gesture.width, canPrev: o.canPrev, canNext: o.canNext })
      if (dir === 'next') o.onNext()
      else if (dir === 'prev') o.onPrev()
    }
    const cancel = e => { if (g && e.pointerId === g.id) end() }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
    }
  }, [ref])

  return { dx, dragging }
}
