import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'
import { ProfileFields, missingRequired, profileBody } from '../components/ProfileFields.jsx'
import { usePrivacyStep } from '../components/PrivacyNotice.jsx'

// Socios que ya tenían cuenta antes de que el gym pidiera datos: el mismo formulario del
// registro, UNA sola vez (guardar o "Ahora no" lo cierran para siempre; después los datos los
// actualiza el staff). Nunca bloquea el uso de la app.
export default function ProfileOnce() {
  const prompt = useStore(s => s.profilePrompt)
  const dismiss = useStore(s => s.dismissProfilePrompt)
  const toast = useUI(s => s.toast)
  const fields = prompt?.fields || {}
  const [values, setValues] = useState({})
  const [accepted, setAccepted] = useState(false)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const privacy = usePrivacyStep()
  const missing = missingRequired(fields, values)

  const send = async body => {
    setBusy(true); setErrors({})
    try {
      await api('/api/me/profile', { method: 'POST', body: JSON.stringify(body) })
      if (!body.skip) toast(t('¡Gracias! Tus datos quedaron guardados.'))
      dismiss()
    } catch (e) {
      setBusy(false)
      // Ya no corresponde (lo completó en otro dispositivo): se cierra igual.
      if (e?.data?.error === 'profile_locked') return dismiss()
      if (e?.data?.field) setErrors({ [e.data.field]: e.message })
      else setErrors({ general: e?.data?.message || e?.message || t('No se pudo guardar') })
    }
  }

  return <div className="narrow profile-once">
    {privacy.view}
    <div hidden={privacy.isOpen}>
      <h1 className="privacy-title">{t('Completá tus datos')}</h1>
      <p className="muted" style={{ margin: '4px 0 18px', lineHeight: 1.5 }}>{t('El gimnasio te pide estos datos una sola vez, para identificarte como socio. Después, si hay que cambiarlos, se hace en recepción.')}</p>
      <ProfileFields fields={fields} values={values} errors={errors} accepted={accepted} onAccept={setAccepted} onPrivacy={privacy.open}
        onChange={(prop, value) => setValues(v => ({ ...v, [prop]: value }))} />
      {errors.general && <div className="form-error" role="alert">{errors.general}</div>}
      <div style={{ height: 14 }} />
      <Button variant="primary" disabled={busy || !accepted || missing.length > 0}
        onClick={() => send({ profile: profileBody(fields, values), privacyAccepted: true })}>{busy ? t('Guardando…') : t('Guardar')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" disabled={busy} onClick={() => send({ skip: true })}>{t('Ahora no')}</Button>
    </div>
  </div>
}
