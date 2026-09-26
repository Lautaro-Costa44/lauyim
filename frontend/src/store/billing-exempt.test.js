// @vitest-environment happy-dom
// Bloqueo por cuota con DEMO_ADMIN_ALL_USERS: todos son admin (ven el panel), pero solo el staff
// de verdad (user.staff de /api/me) queda exento. Sin ese dato vale admin, como antes.
import { beforeEach, describe, expect, it } from 'vitest'
import { billingExempt, useStore } from './useStore.js'

const block = () => window.dispatchEvent(new CustomEvent('gym:membership_blocked'))

describe('billingExempt', () => {
  beforeEach(() => { localStorage.clear(); useStore.getState().setUser(null) })

  it('staff manda sobre admin', () => {
    expect(billingExempt({ admin: true, staff: false })).toBe(false)
    expect(billingExempt({ admin: true, staff: true })).toBe(true)
    expect(billingExempt({ admin: true })).toBe(true)
    expect(billingExempt({ admin: false })).toBe(false)
    expect(billingExempt(null)).toBe(false)
  })

  it('un admin de la demo (staff: false) sí queda bloqueado', () => {
    useStore.getState().setUser({ id: 'd', name: 'demo', admin: true, staff: false })
    block()
    expect(useStore.getState().membershipBlocked).toBe(true)
  })

  it('el staff de verdad no', () => {
    useStore.getState().setUser({ id: 's', name: 'staff', admin: true, staff: true })
    block()
    expect(useStore.getState().membershipBlocked).toBe(false)
  })
})
