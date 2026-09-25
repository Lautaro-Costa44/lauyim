// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { moveItem, useDragReorder } from './useDragReorder.js'

describe('moveItem', () => {
  it('moves one item and leaves the input untouched', () => {
    const list = ['a', 'b', 'c', 'd']
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(list).toEqual(['a', 'b', 'c', 'd'])
  })
})

function List({ ids, onCommit }) {
  const drag = useDragReorder(ids, onCommit)
  return <div>{drag.order.map(id => <div key={id} ref={drag.rowRef(id)} data-row={id} className={drag.draggingId === id ? 'dragging' : ''}>
    <span data-handle={id} tabIndex={0} {...drag.handleProps(id)}>{id}</span>
  </div>)}</div>
}

let root, container
const mount = async (ids, onCommit) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<List ids={ids} onCommit={onCommit} />) })
}
afterEach(async () => { if (!root) return; await act(async () => root.unmount()); container.remove(); root = null })
const rows = () => [...container.querySelectorAll('[data-row]')].map(el => el.dataset.row)
const pointer = (el, type, clientY) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientY, button: 0, pointerId: 1 }))

describe('useDragReorder', () => {
  it('drags a row down: previews while moving, commits the new order on release', async () => {
    const onCommit = vi.fn()
    await mount(['a', 'b', 'c'], onCommit)
    // rows 40 px tall at y = 0, 40, 80 (middles 20, 60, 100)
    container.querySelectorAll('[data-row]').forEach((el, i) => { el.getBoundingClientRect = () => ({ top: i * 40, height: 40 }) })
    const handle = container.querySelector('[data-handle="a"]')
    await act(async () => { pointer(handle, 'pointerdown', 20) })
    await act(async () => { pointer(handle, 'pointermove', 90) })
    expect(rows()).toEqual(['b', 'a', 'c'])
    await act(async () => { pointer(handle, 'pointermove', 110) })
    expect(rows()).toEqual(['b', 'c', 'a'])
    await act(async () => { pointer(handle, 'pointerup', 110) })
    expect(onCommit).toHaveBeenCalledWith(['b', 'c', 'a'])
  })

  it('a release where it started commits nothing; arrow keys move one step', async () => {
    const onCommit = vi.fn()
    await mount(['a', 'b', 'c'], onCommit)
    const handle = container.querySelector('[data-handle="b"]')
    await act(async () => { pointer(handle, 'pointerdown', 60); pointer(handle, 'pointerup', 60) })
    expect(onCommit).not.toHaveBeenCalled()
    await act(async () => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })) })
    expect(onCommit).toHaveBeenCalledWith(['b', 'a', 'c'])
    const first = container.querySelector('[data-handle="a"]')
    await act(async () => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })) })
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
})
