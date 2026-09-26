// @vitest-environment happy-dom
// QrCanvas baja zxing recién al dibujar (import dinámico, chunk propio en vite.config.js).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

const encode = vi.hoisted(() => vi.fn(() => ({ getWidth: () => 21, get: (x, y) => (x + y) % 2 === 0 })))
vi.mock('html5-qrcode/third_party/zxing-js.umd.js', () => ({ QRCodeWriter: class { encode(...a) { return encode(...a) } }, BarcodeFormat: { QR_CODE: 11 } }))
window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {} })

const { default: QrCanvas } = await import('./QrCanvas.jsx')

it('dibuja cuando llega zxing y avisa con el canvas', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const onCanvas = vi.fn()
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => { root.render(<QrCanvas value="https://gym.test/?qr=abc" onCanvas={onCanvas} />) })
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  expect(encode).toHaveBeenCalledWith('https://gym.test/?qr=abc', 11, 280, 280, expect.any(Map))
  expect(onCanvas).toHaveBeenCalledTimes(1)
  expect(onCanvas.mock.calls[0][0].width).toBe(84)
  await act(async () => { root.unmount() })
})
