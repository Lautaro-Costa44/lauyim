import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { parsePlan } from '../lib/plan-share.js'
import { planImportSheet } from '../sheets.jsx'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

export default function ImportPlan() {
  const [searchParams] = useSearchParams()
  const code = searchParams.get('code')
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!code) {
      setError(t('Código de importación no válido.'))
      setLoading(false)
      return
    }

    fetch(`/api/share/plan/${code.trim().toUpperCase()}`)
      .then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || t('El código ha expirado o no es válido.'))
        }
        return res.json()
      })
      .then(data => {
        const bundle = parsePlan(data)
        setLoading(false)
        nav('/plan', { replace: true })
        planImportSheet(bundle)
      })
      .catch(e => {
        setError(e.message || t('No se pudo cargar el plan.'))
        setLoading(false)
      })
  }, [code, nav, toast])

  return (
    <div className="narrow" style={{ textAlign: 'center', paddingTop: '20vh' }}>
      <div style={{ marginBottom: 16 }}>
        <Icon name="qrcode" style={{ fontSize: 48, color: 'var(--acc)' }} />
      </div>
      <h2>{t('Importando plan por QR')}</h2>
      {loading ? (
        <p className="muted" style={{ marginTop: 12 }}>{t('Buscando plan compartido...')}</p>
      ) : error ? (
        <div style={{ marginTop: 20 }}>
          <p style={{ color: 'var(--orange)', marginBottom: 16 }}>{error}</p>
          <Button variant="primary" onClick={() => nav('/plan', { replace: true })}>{t('Volver al plan')}</Button>
        </div>
      ) : null}
    </div>
  )
}
