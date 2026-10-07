import { useRef, useState } from 'react'

// Reorder a list by dragging a handle. Pointer events rather than HTML5 drag-and-drop, which
// never fires on touch screens; the same handle also takes ArrowUp/ArrowDown, so a keyboard
// (or a screen reader) can reorder without dragging at all.
//
//   const drag = useDragReorder(ids, nextIds => save(nextIds))
//   drag.order.map(id => <div ref={drag.rowRef(id)} className={drag.draggingId === id ? 'dragging' : ''}>
//     <button {...drag.handleProps(id)} /> …)
//
// Or the whole row, by press-and-hold: spread `drag.rowProps(id)` on the row. A quick swipe still
// scrolls; holding still for LONG_PRESS_MS picks the row up, and from then on the finger drags it.
//
// While dragging, `order` is the preview (the dragged row already sits where it would land).
// `onCommit` gets the final ids only when the position actually changed.

export const LONG_PRESS_MS = 300
const PRESS_SLOP_PX = 8   // more movement than this before the hold completes means a scroll

export function moveItem(list, from, to) {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function useDragReorder(ids, onCommit) {
  const [drag, setDrag] = useState(null)          // { id, from, over, mids }
  const rows = useRef({})
  const press = useRef(null)                      // a hold in progress: { timer, x, y }
  // Read by the native touchmove listener, which outlives renders: true from the moment a row
  // is picked up, before React has re-rendered.
  const dragging = useRef(false)
  dragging.current = !!drag

  const order = drag ? moveItem(ids, drag.from, drag.over) : ids

  // Insertion index = how many of the *other* rows have their middle above the pointer. The
  // middles are measured once, at the start, in the original order: the preview moving rows
  // around must not feed back into where the pointer is "over".
  const overIndex = (state, y) => state.mids.filter((mid, i) => i !== state.from && mid < y).length

  const begin = (id, el, pointerId) => {
    const from = ids.indexOf(id)
    if (from < 0) return
    try { el?.setPointerCapture?.(pointerId) } catch { /* pointer already gone */ }
    const mids = ids.map(x => {
      const r = rows.current[x]?.getBoundingClientRect()
      return r ? r.top + r.height / 2 : 0
    })
    dragging.current = true
    setDrag({ id, from, over: from, mids })
  }
  const start = (id, e) => {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    begin(id, e.currentTarget, e.pointerId)
  }
  const move = e => {
    if (!drag) return
    const over = overIndex(drag, e.clientY)
    if (over !== drag.over) setDrag({ ...drag, over })
  }
  const end = () => {
    if (!drag) return
    const { from, over } = drag
    dragging.current = false
    setDrag(null)
    if (over !== from) onCommit(moveItem(ids, from, over))
  }
  const cancel = () => { dragging.current = false; setDrag(null) }
  const clearPress = () => {
    if (press.current) clearTimeout(press.current.timer)
    press.current = null
  }
  const key = (id, e) => {
    const from = ids.indexOf(id)
    const to = e.key === 'ArrowUp' ? from - 1 : e.key === 'ArrowDown' ? from + 1 : null
    if (to === null) return
    e.preventDefault()
    if (to >= 0 && to < ids.length) onCommit(moveItem(ids, from, to))
  }

  return {
    order,
    draggingId: drag?.id ?? null,
    rowRef: id => el => {
      if (!el) { delete rows.current[id]; return }
      rows.current[id] = el
      // Once a row is picked up the page must not scroll under the finger. touch-action cannot
      // change mid-gesture, so cancel the scroll from a non-passive listener instead.
      if (!el.__reorderTouch) {
        el.addEventListener('touchmove', ev => { if (dragging.current) ev.preventDefault() }, { passive: false })
        el.__reorderTouch = true
      }
    },
    handleProps: id => ({
      'data-drag-handle': '',
      onPointerDown: e => start(id, e),
      onPointerMove: move,
      onPointerUp: end,
      onPointerCancel: cancel,
      onKeyDown: e => key(id, e),
      onClick: e => e.stopPropagation(),
      style: { touchAction: 'none', cursor: drag ? 'grabbing' : 'grab' },
    }),
    rowProps: id => ({
      onPointerDown: e => {
        if (drag || (e.button !== undefined && e.button !== 0)) return
        if (e.target?.closest?.('[data-drag-handle]')) return   // the handle starts its own drag
        clearPress()
        const el = e.currentTarget, pointerId = e.pointerId
        press.current = {
          x: e.clientX, y: e.clientY,
          timer: setTimeout(() => {
            press.current = null
            try { navigator.vibrate?.(10) } catch { /* not allowed yet */ }
            begin(id, el, pointerId)
          }, LONG_PRESS_MS),
        }
      },
      onPointerMove: e => {
        const p = press.current
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > PRESS_SLOP_PX) clearPress()
        move(e)
      },
      onPointerUp: () => { clearPress(); end() },
      onPointerCancel: () => { clearPress(); cancel() },
      // Android opens a context menu (and iOS a callout) on a long press.
      onContextMenu: e => e.preventDefault(),
      style: { touchAction: 'pan-y', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', cursor: drag ? 'grabbing' : 'grab' },
    }),
  }
}
