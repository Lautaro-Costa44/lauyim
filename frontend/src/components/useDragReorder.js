import { useRef, useState } from 'react'

// Reorder a list by dragging a handle. Pointer events rather than HTML5 drag-and-drop, which
// never fires on touch screens; the same handle also takes ArrowUp/ArrowDown, so a keyboard
// (or a screen reader) can reorder without dragging at all.
//
//   const drag = useDragReorder(ids, nextIds => save(nextIds))
//   drag.order.map(id => <div ref={drag.rowRef(id)} className={drag.draggingId === id ? 'dragging' : ''}>
//     <button {...drag.handleProps(id)} /> …)
//
// While dragging, `order` is the preview (the dragged row already sits where it would land).
// `onCommit` gets the final ids only when the position actually changed.

export function moveItem(list, from, to) {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function useDragReorder(ids, onCommit) {
  const [drag, setDrag] = useState(null)          // { id, from, over, mids }
  const rows = useRef({})

  const order = drag ? moveItem(ids, drag.from, drag.over) : ids

  // Insertion index = how many of the *other* rows have their middle above the pointer. The
  // middles are measured once, at the start, in the original order: the preview moving rows
  // around must not feed back into where the pointer is "over".
  const overIndex = (state, y) => state.mids.filter((mid, i) => i !== state.from && mid < y).length

  const start = (id, e) => {
    if (e.button !== undefined && e.button !== 0) return
    const from = ids.indexOf(id)
    if (from < 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const mids = ids.map(x => {
      const r = rows.current[x]?.getBoundingClientRect()
      return r ? r.top + r.height / 2 : 0
    })
    setDrag({ id, from, over: from, mids })
  }
  const move = e => {
    if (!drag) return
    const over = overIndex(drag, e.clientY)
    if (over !== drag.over) setDrag({ ...drag, over })
  }
  const end = () => {
    if (!drag) return
    const { from, over } = drag
    setDrag(null)
    if (over !== from) onCommit(moveItem(ids, from, over))
  }
  const cancel = () => setDrag(null)
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
    rowRef: id => el => { if (el) rows.current[id] = el; else delete rows.current[id] },
    handleProps: id => ({
      onPointerDown: e => start(id, e),
      onPointerMove: move,
      onPointerUp: end,
      onPointerCancel: cancel,
      onKeyDown: e => key(id, e),
      onClick: e => e.stopPropagation(),
      style: { touchAction: 'none', cursor: drag ? 'grabbing' : 'grab' },
    }),
  }
}
