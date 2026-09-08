import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'

const FORMATOS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.QR_CODE
]

export default function ScannerCodigoBarras({ onScan, onCancel }) {
  const scannerRef = useRef(null)
  const resultadoRef = useRef(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const scanner = new Html5Qrcode('scanner-codigo-barras')
    scannerRef.current = scanner
    let activo = true

    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 280, height: 180 }, formatsToSupport: FORMATOS },
      async (codigo) => {
        if (!activo || resultadoRef.current) return
        resultadoRef.current = true
        try {
          await scanner.stop()
        } catch {
          // La cámara puede haberse detenido al desmontar el componente.
        }
        if (activo) onScan(codigo)
      },
      () => {}
    ).catch(() => {
      if (activo) setError('No se pudo acceder a la cámara. Revisá el permiso del navegador e intentá nuevamente.')
    })

    return () => {
      activo = false
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(() => {})
      }
    }
  }, [onScan])

  const cancelar = async () => {
    resultadoRef.current = true
    if (scannerRef.current?.isScanning) {
      await scannerRef.current.stop().catch(() => {})
    }
    onCancel?.()
  }

  return (
    <div role="dialog" aria-label="Escanear código de barras">
      <div id="scanner-codigo-barras" />
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={cancelar}>Cancelar</button>
    </div>
  )
}
