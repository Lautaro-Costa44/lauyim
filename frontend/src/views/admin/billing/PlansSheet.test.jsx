// @vitest-environment happy-dom
// Planes: "Clases incluidas" (libre, por semana o por mes) se guarda con el plan y se lee en la lista.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { setLang } = await import('../../../lib/i18n.js')
const { PlansSheet } = await import('./PlansSheet.jsx')

let container, root
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
const button = label => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === label)

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockReset()
  apiMock.mockImplementation((url, opts) => {
    if (url === '/api/admin/billing/plans' && !opts) return Promise.resolve({ plans: [{ id: 1, name: 'Mensual', price: 20000, durationDays: 30, active: true, classLimit: 2, classPeriod: 'week' }] })
    return Promise.resolve({ plan: {} })
  })
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<PlansSheet close={() => {}} />) })
  await tick()
})
afterEach(async () => { await act(async () => { root.unmount() }); container.remove() })

it('la lista dice las clases incluidas', () => {
  expect(container.textContent).toContain('2 clases por semana')
})

it('editar: pasar a "Por mes" con 8 clases se guarda', async () => {
  await act(async () => { container.querySelector('.lrow.tap').click() })
  await tick()
  await act(async () => { button('Por mes').click() })
  const input = [...container.querySelectorAll('input')].at(-1)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '8')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { button('Guardar').click() })
  await tick()
  const put = apiMock.mock.calls.find(([u, o]) => u === '/api/admin/billing/plans/1' && o?.method === 'PUT')
  expect(JSON.parse(put[1].body)).toMatchObject({ classLimit: 8, classPeriod: 'month' })
})
