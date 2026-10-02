// @vitest-environment happy-dom
// Ajustes → Recordatorios de clases: a quien da clases (tomar lista) se le suma cuánto antes de
// sus clases le avisamos (1 h de entrada); al socio, no.
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

let container, root

async function render(user) {
  useStore.setState({ user, config: { classes_available: true } })
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
  apiMock.mockImplementation(url => url === '/api/classes' ? Promise.resolve({ enabled: true, reminderDefaults: [60], teacherReminder: 60, occurrences: [] }) : Promise.resolve({}))
})
afterEach(async () => { await act(async () => { root.unmount() }); container.remove(); useStore.setState({ config: null }) })

describe('Ajustes · aviso a la profe', () => {
  it('la profe elige cuánto antes (1 h de entrada) y se guarda', async () => {
    await render({ id: 'profe', name: 'Caro', permissions: ['members.view', 'classes.attendance'] })
    const group = container.querySelector('[aria-label="Antes de las clases que doy"]')
    const chips = [...group.querySelectorAll('.chip')]
    expect(chips.map(c => [c.textContent, c.getAttribute('aria-checked')])).toEqual([['No', 'false'], ['30 min antes', 'false'], ['1 h antes', 'true'], ['2 h antes', 'false']])
    await act(async () => { chips[0].click() })
    expect(apiMock).toHaveBeenCalledWith('/api/classes/teacher-reminder', { method: 'PUT', body: JSON.stringify({ minutes: 0 }) })
    expect(chips[0].getAttribute('aria-checked')).toBe('true')
  })

  it('el socio no lo ve', async () => {
    await render({ id: 'm1', name: 'Socio', admin: false })
    expect(container.textContent).toContain('Recordatorios de clases')
    expect(container.querySelector('[aria-label="Antes de las clases que doy"]')).toBeNull()
  })
})
