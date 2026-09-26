// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { clearIosReoffer, isIOS, isStandalone, markIosReoffer, markNotifStepDone, notifStepFor, notifStepKind } from './notif-step.js'

describe('notif-step', () => {
  it('detecta iOS, también el iPad que se presenta como Mac', () => {
    expect(isIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe(true)
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe(true)
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 })).toBe(false)
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Linux; Android 14)' })).toBe(false)
  })

  it('instalada: display-mode standalone o navigator.standalone', () => {
    expect(isStandalone({ navigator: { standalone: true } })).toBe(true)
    expect(isStandalone({ navigator: {}, matchMedia: () => ({ matches: true }) })).toBe(true)
    expect(isStandalone({ navigator: {}, matchMedia: () => ({ matches: false }) })).toBe(false)
  })

  it('qué ofrecer', () => {
    const base = { ios: false, standalone: false, supported: true, permission: 'default' }
    expect(notifStepKind(base)).toBe('enable')
    expect(notifStepKind({ ...base, ios: true })).toBe('ios-install')
    expect(notifStepKind({ ...base, ios: true, standalone: true })).toBe('enable')
    expect(notifStepKind({ ...base, permission: 'granted' })).toBe(null)
    expect(notifStepKind({ ...base, permission: 'denied' })).toBe(null)
    expect(notifStepKind({ ...base, supported: false })).toBe(null)
  })
})

describe('notifStepFor', () => {
  it('primer ingreso una vez; en iOS, segunda oferta ya instalada', () => {
    localStorage.clear()
    expect(notifStepFor('u', { firstEntry: true, kind: 'ios-install' })).toEqual({ kind: 'ios-install', reoffer: false })
    markNotifStepDone('u'); markIosReoffer('u')
    expect(notifStepFor('u', { firstEntry: true, kind: 'ios-install' })).toBe(null)   // sigue en Safari
    expect(notifStepFor('u', { firstEntry: false, kind: 'enable' })).toEqual({ kind: 'enable', reoffer: true })
    clearIosReoffer('u')
    expect(notifStepFor('u', { firstEntry: false, kind: 'enable' })).toBe(null)
    expect(notifStepFor(null, { firstEntry: true, kind: 'enable' })).toBe(null)
  })
})
