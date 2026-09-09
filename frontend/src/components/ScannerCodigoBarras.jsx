import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { Button, TextField } from './ui.jsx'

const FORMATOS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.EAN_14,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.QR_CODE
]

let scannerCycle = Promise.resolve()

export default function ScannerCodigoBarras({ onScan, onCancel }) {
  const scannerRef = useRef(null)
  const resultadoRef = useRef(false)
  const [error, setError] = useState('')
  const [codigoManual, setCodigoManual] = useState('')
  const [camaraActiva, setCamaraActiva] = useState(false)
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let activo = true
    let scanner = null
    resultadoRef.current = false
    setError('')
    const ciclo = scannerCycle.then(async () => {
      if (!activo) return
      scanner = new Html5Qrcode('scanner-codigo-barras')
      scannerRef.current = scanner
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 280, height: 180 }, formatsToSupport: FORMATOS },
          async (codigo) => {
            if (!activo || resultadoRef.current) return
            resultadoRef.current = true
            try { await scanner.stop() } catch { /* ya detenido al desmontar */ }
            if (activo) {
              setCamaraActiva(false)
              onScan(codigo)
            }
          },
          () => {},
        )
        if (activo) setCamaraActiva(true)
      } catch {
        if (activo) {
          setCamaraActiva(false)
          setError('No se pudo acceder a la cámara. Revisá el permiso del navegador e intentá nuevamente.')
        }
      }
    })
    scannerCycle = ciclo.catch(() => {})

    return () => {
      activo = false
      scannerCycle = ciclo.then(async () => {
        if (scanner?.isScanning) await scanner.stop().catch(() => {})
      }).catch(() => {})
    }
  }, [onScan, intento])

  const cancelar = async () => {
    resultadoRef.current = true
    setCamaraActiva(false)
    if (scannerRef.current?.isScanning) {
      await scannerRef.current.stop().catch(() => {})
    }
    onCancel?.()
  }

  const escanear = () => {
    resultadoRef.current = false
    setError('')
    setIntento(value => value + 1)
  }

  const consultarManual = async event => {
    event.preventDefault()
    const codigo = codigoManual.trim()
    if (!codigo) return
    resultadoRef.current = true
    setCamaraActiva(false)
    if (scannerRef.current?.isScanning) await scannerRef.current.stop().catch(() => {})
    onScan(codigo)
  }

  return (
    <div role="dialog" aria-label="Escanear código de barras">
      <div id="scanner-codigo-barras" />
      {error && <p role="alert">{error}</p>}
      <form className="scanner-manual" onSubmit={consultarManual}>
        <label>Código de barras<TextField type="text" inputMode="numeric" autoComplete="off" value={codigoManual} onChange={event => setCodigoManual(event.target.value)} /></label>
        <Button type="submit" variant="secondary" disabled={!codigoManual.trim()}>Consultar código</Button>
      </form>
      {!camaraActiva && <Button type="button" variant="secondary" onClick={escanear}>Escanear</Button>}
      <Button type="button" onClick={cancelar}>Cancelar</Button>
    </div>
  )
}
