import { useEffect, useRef, useState } from 'react'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import { Button } from '../../components/ui.jsx'
import { NO_AUTOFILL } from '../../lib/input-safety.js'

function PushNotificationCard() {
  const [titulo, setTitulo] = useState('')
  const [texto, setTexto] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useUI(s => s.toast)

  const sendPush = () => {
    const cleanTitle = titulo.trim()
    const cleanText = texto.trim()
    const cleanUrl = redirectUrl.trim()

    if (!cleanTitle || !cleanText) {
      toast(t('Title and text are required'))
      return
    }

    if (cleanUrl) {
      try {
        const u = new URL(cleanUrl)
        if (!['http:', 'https:'].includes(u.protocol)) {
          toast(t('URL must start with http:// or https://'))
          return
        }
      } catch {
        toast(t('Invalid URL'))
        return
      }
    }

    setLoading(true)
    api('/api/admin/push', {
      method: 'POST',
      body: JSON.stringify({
        titulo: cleanTitle,
        texto: cleanText,
        redirectUrl: cleanUrl || null
      })
    })
      .then(res => {
        setLoading(false)
        toast(t('Notification sent to {0} subscriptions', res.sent ?? 0))
        setTitulo('')
        setTexto('')
        setRedirectUrl('')
      })
      .catch(e => {
        setLoading(false)
        toast(e.message || t('Failed to send push'))
      })
  }

  return (
    <div className="card">
      <h3 style={{ margin: '0 0 12px' }}>{t('Enviar notificación')}</h3>
      
      <div style={{ marginBottom: 10 }}>
        <div className="row between small dim" style={{ marginBottom: 4 }}>
          <span>{t('Título')}</span>
          <span>{titulo.length}/50</span>
        </div>
        <input {...NO_AUTOFILL} name="app-admin-notification-title"
          className="input"
          type="text"
          maxLength={50}
          placeholder={t('Título de la notificación')}
          value={titulo}
          onChange={e => setTitulo(e.target.value)}
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <div className="row between small dim" style={{ marginBottom: 4 }}>
          <span>{t('Texto / cuerpo')}</span>
          <span>{texto.length}/120</span>
        </div>
        <textarea {...NO_AUTOFILL} name="app-admin-notification-body"
          className="input"
          rows={3}
          maxLength={120}
          placeholder={t('Escribí el mensaje de la notificación...')}
          value={texto}
          onChange={e => setTexto(e.target.value)}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <div className="small dim" style={{ marginBottom: 4 }}>{t('Redirect (opcional)')}</div>
        <input {...NO_AUTOFILL} name="app-admin-redirect"
          className="input"
          type="url"
          placeholder="https://instagram.com/..."
          value={redirectUrl}
          onChange={e => setRedirectUrl(e.target.value)}
        />
      </div>

      <Button variant="primary" disabled={loading || !titulo.trim() || !texto.trim()} onClick={sendPush}>
        {loading ? t('Enviando…') : t('Enviar')}
      </Button>
    </div>
  )
}

// Hora del gym desde la que salen el aviso de vencimiento y el recordatorio manual de cuota.
// Se guarda sola: un reloj con flechas dispara varios cambios seguidos, así que espera a que
// el valor se quede quieto antes de mandarlo.
function NotifyHourCard() {
  const toast = useUI(s => s.toast)
  const [hour, setHour] = useState(null)
  const saved = useRef(null)
  const timer = useRef(null)
  useEffect(() => {
    api('/api/admin/notifications/settings')
      .then(d => { saved.current = d.billing_notify_hour; setHour(d.billing_notify_hour) })
      .catch(e => toast(e.message || t('Failed to load')))
    return () => clearTimeout(timer.current)
  }, [])
  const change = value => {
    setHour(value)
    clearTimeout(timer.current)
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value) || value === saved.current) return
    timer.current = setTimeout(() => {
      api('/api/admin/notifications/settings', { method: 'PUT', body: JSON.stringify({ billing_notify_hour: value }) })
        .then(d => { saved.current = d.billing_notify_hour; toast(t('Horario de avisos guardado')) })
        .catch(e => toast(e.message || t('Failed to save setting')))
    }, 600)
  }
  return <div className="card">
    <div className="row between" style={{ gap: 12 }}>
      <h3 style={{ margin: 0 }}>{t('Horario de avisos de cuota')}</h3>
      {hour == null ? <span className="dim small">{t('Loading…')}</span>
        : <input {...NO_AUTOFILL} name="app-admin-billing-notify-hour" type="time" className="timef" aria-label={t('Horario de avisos de cuota')}
          value={hour} onChange={e => change(e.target.value)} />}
    </div>
    <div className="small muted" style={{ marginTop: 8 }}>{t('Se usa para el aviso de vencimiento y el recordatorio de cuota')}</div>
  </div>
}

export default function Notificaciones() {
  return <div className="admin-cards"><PushNotificationCard /><NotifyHourCard /></div>
}
