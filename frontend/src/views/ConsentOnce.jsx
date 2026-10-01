import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, Switch } from '../components/ui.jsx'
import { HEALTH_DATA_LABEL, LegalAcceptCheck, usePrivacyStep } from '../components/PrivacyNotice.jsx'
import { setHealthConsentRemote } from './HealthConsent.jsx'
import { errorText } from '../lib/errors.js'

// Una sola pantalla al entrar, para lo que la cuenta todavía no decidió:
// - Términos y condiciones y aviso de privacidad (versión vigente, api/legal.js): obligatorios.
//   Sin aceptarlos no se usa la app; "Salir" cierra la sesión.
// - Datos de salud (Ley 25.326, art. 7): opcional. Apagado, la app sirve igual para entrenar y
//   se ocultan Nutrición, el peso corporal y las lesiones. Se cambia después en Ajustes.
// Cuentas de antes, las que cargó el staff, las de una versión vieja de la app, y todas cuando
// cambian los textos.
export default function ConsentOnce() {
  const askLegal = useStore(s => s.legalAsk)
  const askHealth = useStore(s => s.healthAsk)
  const legalVersion = useStore(s => s.legalVersion)
  const signOut = useStore(s => s.signOut)
  const [legalOk, setLegalOk] = useState(false)
  const [health, setHealth] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const step = usePrivacyStep()

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      if (askLegal) {
        try { await api('/api/me/legal', { method: 'POST', body: JSON.stringify({ version: legalVersion }) }) }
        catch (e) {
          // Los textos cambiaron mientras los leía: que vea los nuevos antes de aceptar.
          if (e?.data?.error === 'legal_version_changed') {
            useStore.setState({ legalVersion: e.data.version })
            setLegalOk(false)
            setError(t('Los textos se actualizaron recién. Revisalos y volvé a aceptar.'))
            setBusy(false)
            return
          }
          throw e
        }
        useStore.getState().setLegalAccepted()
      }
      if (askHealth) await setHealthConsentRemote(health)
    } catch (e) {
      setError(errorText(e, t('No hay conexión. Probá de nuevo en un momento.')))
      setBusy(false)
    }
  }

  return <div className="narrow consent-once">
    {step.view}
    <div hidden={step.isOpen}>
      <div className="notif-step-icon"><Icon name={askLegal ? 'shield' : 'heart'} size={32} /></div>
      <h1 className="privacy-title">{askLegal ? t('Antes de seguir') : t('Tus datos de salud')}</h1>
      {askLegal && <p className="muted consent-lead">{t('Leé y aceptá los términos de uso de la app y cómo se cuidan tus datos.')}</p>}

      {askLegal && <section className="consent-card">
        <h2>{t('Términos y aviso de privacidad')}</h2>
        <ul className="consent-points">
          <li>{t('El gimnasio es el responsable de tus datos; lauyim provee y aloja la app.')}</li>
          <li>{t('Se usan solo para tu cuenta, tu cuota y tu entrenamiento. No se venden ni se ceden.')}</li>
          <li>{t('Las rutinas y la nutrición son orientativas: no reemplazan a un profesional.')}</li>
          <li>{t('Podés pedir ver, corregir o borrar tus datos cuando quieras.')}</li>
        </ul>
        <LegalAcceptCheck className="consent-accept" checked={legalOk} onChange={setLegalOk} step={step} />
      </section>}

      {askHealth && <section className="consent-card">
        <div className="consent-card-h">
          <h2>{t('Datos de salud')} <span className="dim consent-optional">{t('opcional')}</span></h2>
          <Switch checked={health} onChange={setHealth} label={t('Datos de salud')} />
        </div>
        <p className="muted">{t('Para adaptar tu entrenamiento, la app puede guardar {0}. La ley los considera datos sensibles: solo se guardan si lo aceptás.', t(HEALTH_DATA_LABEL))}</p>
        <p className={'consent-health-state ' + (health ? 'on' : 'off')}>
          <Icon name={health ? 'checkCircle' : 'info'} />
          {health
            ? t('Con tu consentimiento: Nutrición, peso corporal y lesiones activos.')
            : t('Sin consentimiento: entrenás igual; se ocultan Nutrición, el peso corporal y las lesiones.')}
        </p>
        <p className="dim small">{t('Lo podés cambiar cuando quieras en Ajustes → Datos de salud.')}</p>
      </section>}

      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="consent-actions">
        <Button variant="primary" disabled={busy || (askLegal && !legalOk)} onClick={submit}>{busy ? t('Guardando…') : t('Continuar')}</Button>
        {askLegal && <>
          <Button variant="ghost" className="dim" disabled={busy} onClick={() => signOut()}>{t('Salir')}</Button>
          <p className="dim small">{t('Sin aceptar los términos no se puede usar la app. Si tenés dudas, consultá en la recepción.')}</p>
        </>}
      </div>
    </div>
  </div>
}
