import { useEffect, useRef } from 'react'
import { t } from '../lib/i18n.js'

// El codificador (zxing, ~400 KB) se baja recién cuando hay un QR para dibujar, en su propio chunk
// (vite.config.js): el panel admin no lo carga al abrir, ni arrastra el chunk de Nutrición.
const loadZXing = () => import('html5-qrcode/third_party/zxing-js.umd.js')

// Dibuja `value` como QR en un canvas. onCanvas recibe el canvas ya dibujado (para exportarlo).
export default function QrCanvas({ value, size = 280, ariaLabel, onCanvas }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!value || !ref.current) return
    let alive = true
    loadZXing().then(mod => {
      const ZXing = mod.QRCodeWriter ? mod : mod.default
      if (!alive || !ref.current) return
      const matrix = new ZXing.QRCodeWriter().encode(value, ZXing.BarcodeFormat.QR_CODE, size, size, new Map())
      const canvas = ref.current
      const cells = matrix.getWidth()
      const scale = 4
      canvas.width = cells * scale
      canvas.height = cells * scale
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#000'
      for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
        if (matrix.get(x, y)) ctx.fillRect(x * scale, y * scale, scale, scale)
      }
      onCanvas?.(canvas)
    }).catch(() => {})
    return () => { alive = false }
  }, [value, size])
  return <canvas ref={ref} aria-label={ariaLabel ?? t('QR access code')} style={{ width: size, height: size, maxWidth: '100%', imageRendering: 'pixelated', borderRadius: 8 }} />
}
