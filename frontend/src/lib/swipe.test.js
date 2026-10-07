import { describe, expect, it } from 'vitest'
import { swipeAllowed, swipeAxis, swipeOffset, swipeDecision } from './swipe.js'
import { canPrefetch } from './net.js'

const el = matches => ({ closest: sel => (matches ? { sel } : null) })

describe('swipe between exercises', () => {
  it('does not start on controls, near the left edge, or while disabled', () => {
    expect(swipeAllowed({ target: el(false), x: 100 })).toBe(true)
    expect(swipeAllowed({ target: el(true), x: 100 })).toBe(false)
    expect(swipeAllowed({ target: el(false), x: 12 })).toBe(false)
    expect(swipeAllowed({ target: el(false), x: 100, disabled: true })).toBe(false)
  })

  it('waits for 10 px before choosing an axis, and leaves mostly-vertical moves to the scroll', () => {
    expect(swipeAxis(6, 4)).toBeNull()
    expect(swipeAxis(14, 5)).toBe('x')
    expect(swipeAxis(8, 15)).toBe('y')
  })

  it('follows the finger, with resistance where there is no exercise to go to', () => {
    expect(swipeOffset(-100, { canPrev: true, canNext: true })).toBe(-100)
    expect(swipeOffset(-100, { canPrev: true, canNext: false })).toBe(-30)
    expect(swipeOffset(100, { canPrev: false, canNext: true })).toBe(30)
  })

  it('changes exercise past a quarter of the width or on a flick, otherwise springs back', () => {
    const base = { width: 400, canPrev: true, canNext: true }
    expect(swipeDecision({ ...base, dx: -120, dt: 600 })).toBe('next')
    expect(swipeDecision({ ...base, dx: 120, dt: 600 })).toBe('prev')
    expect(swipeDecision({ ...base, dx: -60, dt: 600 })).toBeNull()
    expect(swipeDecision({ ...base, dx: -60, dt: 80 })).toBe('next')
    expect(swipeDecision({ ...base, canNext: false, dx: -200, dt: 600 })).toBeNull()
  })
})

describe('canPrefetch', () => {
  it('prefetches on a good or unknown connection, never offline, on data saver or slow links', () => {
    expect(canPrefetch({ onLine: true })).toBe(true)
    expect(canPrefetch({ onLine: true, connection: { effectiveType: '4g' } })).toBe(true)
    expect(canPrefetch({ onLine: false })).toBe(false)
    expect(canPrefetch({ onLine: true, connection: { effectiveType: '4g', saveData: true } })).toBe(false)
    expect(canPrefetch({ onLine: true, connection: { effectiveType: '3g' } })).toBe(false)
  })
})
