import { useEffect, useState, useRef } from 'react'
import { useAdmin } from './context.js'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { confirmSheet } from '../../sheets.jsx'
import { t } from '../../lib/i18n.js'
import { Button } from '../../components/ui.jsx'
import * as ZXing from 'html5-qrcode/third_party/zxing-js.umd.js'

function QrCanvas({ value, onCanvas }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!value || !ref.current) return
    const matrix = new ZXing.QRCodeWriter().encode(value, ZXing.BarcodeFormat.QR_CODE, 280, 280, new Map())
    const canvas = ref.current
    const size = matrix.getWidth()
    const scale = 4
    canvas.width = size * scale
    canvas.height = size * scale
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#000'
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (matrix.get(x, y)) ctx.fillRect(x * scale, y * scale, scale, scale)
    }
    onCanvas?.(canvas)
  }, [value])
  return <canvas ref={ref} aria-label={t('QR access code')} style={{ width: 280, height: 280, maxWidth: '100%', imageRendering: 'pixelated', borderRadius: 8 }} />
}

function QrAccessCard({ data, reload }) {
  const toast = useUI(s => s.toast)
  const config = useStore(s => s.config)
  const loadConfig = useStore(s => s.loadConfig)
  const [qrCanvas, setQrCanvas] = useState(null)
  useEffect(() => { loadConfig().catch(e => toast(e.message || t('Failed to load configuration'))) }, [loadConfig])
  const link = data?.token ? window.location.origin + '/?qr=' + encodeURIComponent(data.token) : ''
  const copy = () => link && navigator.clipboard?.writeText(link).then(() => toast(t('QR link copied'))).catch(() => toast(t('Could not copy the QR link')))
  const save = () => {
    if (!qrCanvas) return toast(t('Could not save the QR'))
    try {
      const name = String(config?.instance_name || 'lauyim').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '') || 'lauyim'
      const a = document.createElement('a')
      a.href = qrCanvas.toDataURL('image/png')
      a.download = `${name}-qr-acceso.png`
      a.click()
    } catch (e) {
      toast(e.message || t('Could not save the QR'))
    }
  }
  const regenerate = () => confirmSheet({
    title: t('Regenerate QR access?'),
    message: t('This immediately invalidates the QR currently printed or shared. A new QR link will be generated.'),
    confirmText: t('Regenerate'), danger: true,
    onConfirm: () => api('/api/owner/qr/regenerate', { method: 'POST', body: '{}' })
      .then(d => { reload(d); toast(t('QR access regenerated')) })
      .catch(e => toast(e.message || t('Failed to regenerate QR access')))
  })
  return <div className="card">
    <h2 style={{ margin: 0 }}>{t('QR access')}</h2>
    <div className="small muted" style={{ margin: '6px 0 12px' }}>{t('Anyone who opens this link can register without an invite code. The QR itself does not expire; regenerating it invalidates the previous one.')}</div>
    {data?.token ? <>
      <div className="row" style={{ alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <QrCanvas value={link} onCanvas={setQrCanvas} />
        <div className="grow" style={{ minWidth: 220 }}>
          <div className="small dim" style={{ marginBottom: 5 }}>{t('Current link')}</div>
          <div style={{ wordBreak: 'break-all', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: '.78rem', padding: 10, background: 'var(--surface-2)', borderRadius: 8 }}>{link}</div>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <Button size="sm" variant="primary" onClick={save}>{t('Save QR')}</Button>
            <Button size="sm" onClick={copy}>{t('Copy link')}</Button>
            <Button size="sm" variant="danger" onClick={regenerate}>{t('Regenerate')}</Button>
          </div>
        </div>
      </div>
    </> : <div className="dim small">{t('Loading…')}</div>}
  </div>
}

// Owner only: AdminLayout redirects non-owners to Resumen before this mounts.
export default function Qr() {
  const { qrAccess, setQrAccess } = useAdmin()
  return <div className="admin-single"><QrAccessCard data={qrAccess} reload={setQrAccess} /></div>
}
