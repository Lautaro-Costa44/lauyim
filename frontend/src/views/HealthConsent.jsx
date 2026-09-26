import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { HEALTH_DATA_LABEL, PrivacyLink, usePrivacyStep } from '../components/PrivacyNotice.jsx'

// Datos de salud (Ley 25.326, art. 7): consentimiento expreso y revocable. Sin él la app sirve
// igual para entrenar; se ocultan nutrición, peso corporal, lesiones y la biometría de la encuesta.

export const setHealthConsentRemote = async granted => {
  const d = await api('/api/me/health-consent', { method: 'POST', body: JSON.stringify({ granted }) })
  useStore.getState().setHealthConsent(d.healthConsent)
  return d.healthConsent
}

// Cuentas de antes (healthConsent null): se pregunta una vez, al entrar. Hay que elegir.
export default function HealthConsentOnce() {
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)
  const privacy = usePrivacyStep()
  const answer = async granted => {
    setBusy(true)
    try { await setHealthConsentRemote(granted) }
    catch (e) { toast(e.message || t('No hay conexión. Probá de nuevo en un momento.')); setBusy(false) }
  }
  return <div className="narrow health-consent">
    {privacy.view}
    <div hidden={privacy.isOpen}>
      <div className="notif-step-icon"><Icon name="heart" size={32} /></div>
      <h1 className="privacy-title">{t('Tus datos de salud')}</h1>
      <p className="muted">{t('Para adaptar tu entrenamiento, la app guarda datos de salud: {0}. La ley los considera datos sensibles y necesitamos tu consentimiento expreso.', t(HEALTH_DATA_LABEL))}</p>
      <p className="muted">{t('Si no aceptás, podés seguir entrenando: rutinas, programas, entrenamientos e historial funcionan igual, y se ocultan Nutrición, el peso corporal y las lesiones. Lo podés cambiar cuando quieras en Ajustes → Datos de salud.')}</p>
      <p className="small"><PrivacyLink onClick={privacy.open}>{t('Leer el aviso de privacidad')}</PrivacyLink></p>
      <div className="notif-step-actions" style={{ margin: '18px auto 0' }}>
        <Button variant="primary" disabled={busy} onClick={() => answer(true)}>{t('Acepto')}</Button>
        <Button variant="ghost" className="dim" disabled={busy} onClick={() => answer(false)}>{t('No acepto')}</Button>
      </div>
    </div>
  </div>
}

// Ajustes → Datos de salud: ver el estado, darlo o retirarlo y, sin consentimiento, borrar lo
// que ya se cargó (irreversible: lo decide el socio).
export function HealthConsentSheet({ close }) {
  const consent = useStore(s => s.healthConsent)
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const privacy = usePrivacyStep()
  const granted = consent !== 'declined'
  const change = async value => {
    setBusy(true)
    try {
      await setHealthConsentRemote(value)
      toast(value ? t('Consentimiento dado') : t('Consentimiento retirado'))
      if (value) await useStore.getState().pullState()
    } catch (e) { toast(e.message || t('No se pudo guardar')) }
    setBusy(false)
  }
  const erase = async () => {
    setBusy(true)
    try {
      await api('/api/me/health-data/delete', { method: 'POST', body: '{}' })
      useStore.getState().clearLocalHealthData()
      toast(t('Tus datos de salud se borraron'))
      close()
    } catch (e) { toast(e.message || t('No se pudo borrar')); setBusy(false) }
  }
  return <>
    {privacy.view}
    <div hidden={privacy.isOpen} className="health-sheet">
      <h3>{t('Datos de salud')}</h3>
      <div className={'health-state ' + (granted ? 'on' : 'off')}>{granted ? t('Diste tu consentimiento') : t('Sin consentimiento')}</div>
      <p className="muted small">{t('Datos de salud: {0}. Solo se usan para adaptar tu entrenamiento.', t(HEALTH_DATA_LABEL))}</p>
      {granted ? <>
        <p className="muted small">{t('Si lo retirás, podés seguir entrenando; se ocultan Nutrición, el peso corporal y las lesiones, y esos datos dejan de sincronizarse.')}</p>
        <Button variant="danger" disabled={busy} onClick={() => change(false)}>{t('Retirar el consentimiento')}</Button>
      </> : <>
        <p className="muted small">{t('Lo que ya cargaste sigue guardado, sin usarse, hasta que decidas borrarlo.')}</p>
        <Button variant="primary" disabled={busy} onClick={() => change(true)}>{t('Dar mi consentimiento')}</Button>
        <div style={{ height: 10 }} />
        {confirmDelete ? <div className="health-confirm" role="alert">
          <div>{t('Se borran para siempre tu peso corporal, edad, género, altura, lesiones y registros de nutrición. Tus rutinas y entrenamientos no se tocan.')}</div>
          <Button variant="danger" disabled={busy} onClick={erase}>{t('Sí, borrar mis datos de salud')}</Button>
          <Button variant="ghost" className="dim" disabled={busy} onClick={() => setConfirmDelete(false)}>{t('Cancelar')}</Button>
        </div> : <Button variant="ghost" style={{ color: 'var(--red)' }} disabled={busy} onClick={() => setConfirmDelete(true)}>{t('Borrar mis datos de salud')}</Button>}
      </>}
      <p className="small" style={{ marginTop: 12 }}><PrivacyLink onClick={privacy.open}>{t('Aviso de privacidad')}</PrivacyLink></p>
    </div>
  </>
}
