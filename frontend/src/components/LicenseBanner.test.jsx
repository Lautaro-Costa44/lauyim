// @vitest-environment happy-dom
// Aviso del abono de lauyim al staff y pantalla de suspensión según el rol.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const { useStore } = await import('../store/useStore.js')
const { setLang } = await import('../lib/i18n.js')
const { default: LicenseBanner, licenseMessage } = await import('./LicenseBanner.jsx')
const { default: LicenseExpired } = await import('../views/LicenseExpired.jsx')

let root, container
const mount = async el => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(el) })
}
beforeEach(async () => { await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear() })
afterEach(async () => { if (root) { await act(async () => { root.unmount() }); container.remove(); root = null } useStore.setState({ license: null, licenseReason: null, user: null }) })

const DUE = { status: 'due', reason: 'unpaid', month: '2026-11', dueDate: '2026-11-10', suspendDate: '2026-11-26' }

describe('aviso del abono', () => {
  it('textos por estado', () => {
    expect(licenseMessage(DUE)).toBe('El abono de lauyim de noviembre vence el 10/11.')
    expect(licenseMessage({ ...DUE, status: 'overdue' })).toBe('El abono de lauyim de noviembre está vencido. El servicio se suspende el 26/11.')
    expect(licenseMessage({ status: 'due', reason: 'expired', dueDate: '2026-12-31', suspendDate: '2026-12-31' })).toBe('La licencia de lauyim vence el 31/12.')
    expect(licenseMessage({ status: 'ok' })).toBeNull()
    expect(licenseMessage(null)).toBeNull()
  })

  it('en mora se ve en rojo; cerrarlo lo oculta por el día', async () => {
    useStore.setState({ license: { ...DUE, status: 'overdue' } })
    await mount(<LicenseBanner />)
    expect(container.querySelector('.license-banner.overdue')).not.toBeNull()
    await act(async () => { container.querySelector('.license-banner-x').click() })
    expect(container.querySelector('.license-banner')).toBeNull()
  })
})

describe('servicio suspendido', () => {
  it('el staff ve el motivo y cómo reactivarlo; el socio, solo que no está disponible', async () => {
    useStore.setState({ user: { id: 'o', name: 'dueña', admin: true, owner: true }, licenseReason: 'unpaid' })
    await mount(<LicenseExpired />)
    expect(container.textContent).toContain('Servicio suspendido por falta de pago')
    expect(container.querySelector('a[href^="mailto:soporte@lauyim.online"]')).not.toBeNull()
    await act(async () => { root.render(null) })
    useStore.setState({ user: { id: 's', name: 'socio', admin: false } })
    await act(async () => { root.render(<LicenseExpired />) })
    expect(container.textContent).toContain('La app no está disponible')
    expect(container.textContent).not.toContain('pago')
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull()
  })
})
