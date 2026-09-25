// @vitest-environment happy-dom
// Settings con Cuotas v1: si el gym le asignó un plan al socio, el recordatorio manual de cuota
// desaparece y en su lugar se ve el plan y el vencimiento (solo lectura). Sin plan, sigue igual.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

// Push "soportado" y ya suscripto, para que se vea la sección completa de notificaciones.
Object.defineProperty(navigator, 'serviceWorker', {
  configurable: true,
  value: { ready: Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve({ endpoint: 'x' }) } }) }
})
window.PushManager = class {}
window.Notification = { permission: 'granted' }

const { default: Settings } = await import('./Settings.jsx')
const { useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { bindUI } = await import('../components/ui.jsx')
const { setLang } = await import('../lib/i18n.js')
bindUI(useUI)

const MEMBER = { id: 'm1', name: 'Socio', admin: false }
let container, root
const text = () => container.textContent

async function render(billing, billingEnabled = true) {
  useStore.setState({ user: MEMBER, billing, billingEnabled })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<MemoryRouter><Settings /></MemoryRouter>) })
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockReset()
  apiMock.mockResolvedValue({})
})
afterEach(async () => { await act(async () => { root.unmount() }); container.remove() })

describe('Settings · cuota', () => {
  it('sin plan asignado muestra el toggle del recordatorio manual', async () => {
    await render({ hasPlan: false, status: 'sin_plan', dueDate: null, planName: null, blocked: false })
    expect(text()).toContain('Cuota del gimnasio')
    expect(text()).toContain('Recibe un aviso cuando venza tu cuota.')
    expect(text()).not.toContain('Cuota del gym')
  })

  it('con plan oculta el toggle y muestra plan y vencimiento', async () => {
    await render({ hasPlan: true, status: 'al_dia', dueDate: '2026-10-24', planName: 'Mensual', blocked: false })
    expect(text()).not.toContain('Recibe un aviso cuando venza tu cuota.')
    const row = [...container.querySelectorAll('.lrow')].find(el => el.textContent.includes('Cuota del gym'))
    expect(row, 'fila de plan').toBeTruthy()
    expect(row.textContent).toContain('Mensual')
    expect(row.textContent).toContain('Vence el 24/10/2026')
    expect(row.querySelector('[role="switch"]')).toBeNull()
  })

  it('con cuotas apagado en el gym vuelve el toggle del recordatorio manual', async () => {
    await render(null, false)
    expect(text()).toContain('Recibe un aviso cuando venza tu cuota.')
    expect(text()).not.toContain('Cuota del gym')
  })

  it('con cuotas apagado ignora un plan viejo guardado en el dispositivo', async () => {
    await render({ hasPlan: true, status: 'al_dia', dueDate: '2026-10-24', planName: 'Mensual', blocked: false }, false)
    expect(text()).toContain('Recibe un aviso cuando venza tu cuota.')
    expect(text()).not.toContain('Cuota del gym')
  })
})
