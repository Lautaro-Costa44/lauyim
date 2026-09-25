// @vitest-environment happy-dom
// La pantalla de bloqueo por cuota montada en la App real: aparece con el evento de api.js o con
// /api/me, tapa TabBar y RestTimer, nunca aparece para staff, y cerrar sesión con cambios sin
// sincronizar pide confirmación.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { useStore } = await import('../store/useStore.js')
const REAL_BOOT = useStore.getState().boot
const { useUI } = await import('../store/useUI.js')
const { enqueueSync } = await import('../lib/sync-queue.js')
const { default: App } = await import('../App.jsx')
const { setLang } = await import('../lib/i18n.js')

const MEMBER = { id: 'm1', name: 'Socio', admin: false, owner: false }
const BLOCKED_ME = { user: MEMBER, billing: { hasPlan: true, status: 'bloqueado', dueDate: '2026-09-01', planName: 'Mensual', blocked: true } }
const TEXT = 'Tu cuota está vencida, renovala en recepción para poder seguir usando la app'

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })
const flush = async () => { for (let i = 0; i < 10; i++) await tick() }
const text = () => document.body.textContent

let root, container
async function mount({ realBoot = false } = {}) {
  window.location.hash = '#/home'
  useStore.setState({ ready: true, licenseExpired: false, boot: realBoot ? REAL_BOOT : () => {} })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<App />) })
  await flush()
}

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  apiMock.mockReset()
  apiMock.mockResolvedValue({})
  useUI.setState({ sheets: [] })
  useStore.setState({ user: MEMBER, membershipBlocked: false, billing: null })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
})

describe('MembershipBlocked', () => {
  it('aparece con el evento membership_blocked y oculta la TabBar', async () => {
    await mount()
    expect(text()).not.toContain(TEXT)
    await act(async () => { window.dispatchEvent(new CustomEvent('gym:membership_blocked')) })
    await flush()
    expect(text()).toContain(TEXT)
    expect(document.querySelector('#tabbar')).toBeNull()
    expect(localStorage.getItem('gym_membership_blocked')).toBe('1')
  })

  it('aparece si /api/me trae billing.blocked, sin sincronizar', async () => {
    apiMock.mockImplementation(url => url === '/api/me' ? Promise.resolve(BLOCKED_ME) : Promise.resolve({ allow_guest: true }))
    await mount({ realBoot: true })
    expect(text()).toContain(TEXT)
    expect(text()).toContain('Venció el 01/09/2026')
    expect(apiMock.mock.calls.some(([url]) => url === '/api/data/sync' || url === '/api/data')).toBe(false)
  })

  it('bloqueo por prueba terminada: texto de prueba, sin vencimiento de cuota', async () => {
    const me = { user: MEMBER, billing: { hasPlan: false, status: 'bloqueado', dueDate: null, planName: null, blocked: true, trialUntil: '2026-09-23', trialEnded: true } }
    apiMock.mockImplementation(url => url === '/api/me' ? Promise.resolve(me) : Promise.resolve({ allow_guest: true }))
    await mount({ realBoot: true })
    expect(text()).toContain('Prueba terminada')
    expect(text()).toContain('Tu prueba terminó. Aboná en recepción para seguir usando la app')
    expect(text()).not.toContain(TEXT)
    expect(text()).not.toContain('Venció el')
  })

  it('persiste: con el flag guardado se muestra de entrada', async () => {
    useStore.setState({ membershipBlocked: true })
    await mount()
    expect(text()).toContain(TEXT)
  })

  it('nunca se muestra a un admin', async () => {
    useStore.setState({ user: { ...MEMBER, admin: true }, membershipBlocked: true })
    await mount()
    expect(text()).not.toContain(TEXT)
    await act(async () => { window.dispatchEvent(new CustomEvent('gym:membership_blocked')) })
    await flush()
    expect(text()).not.toContain(TEXT)
    expect(document.querySelector('#tabbar')).not.toBeNull()
  })

  it('cerrar sesión con cambios pendientes avisa que se pierden', async () => {
    useStore.setState({ membershipBlocked: true })
    await enqueueSync(MEMBER.id, [{ path: ['workouts', 'w1'], op: 'add', value: { id: 'w1', d: '2026-09-10', entries: [] } }])
    await mount()
    const logout = [...document.querySelectorAll('button')].find(b => b.textContent === 'Cerrar sesión')
    await act(async () => { logout.click() })
    await flush()
    expect(document.querySelector('#modal-root').textContent).toContain('los datos locales no sincronizados se pierden')
    expect(useStore.getState().user).toEqual(MEMBER)       // todavía no cerró nada
  })
})
