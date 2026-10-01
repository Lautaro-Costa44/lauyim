// @vitest-environment happy-dom
// Compartir un plan por QR: el código se dibuja en el dispositivo, nunca en un servicio externo.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

const { QrShare } = await import('../sheets.jsx')

let root, container
afterEach(async () => { await act(async () => { root.unmount() }); container.remove() })

describe('QR de compartir plan', () => {
  it('es un canvas local con el link del plan; ninguna imagen externa', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<QrShare code="ABC123" close={() => {}} />) })
    expect(container.querySelector('canvas')).not.toBeNull()
    expect([...container.querySelectorAll('img')].map(i => i.src)).toEqual([])
    expect(container.textContent).toContain('/#/import?code=ABC123')
  })
})
