import { useState } from 'react'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { IosInstallSteps } from '../components/notif/IosInstallSheet.jsx'
import { useNotifReasons, joinReasons } from '../components/notif/usePushStatus.js'
import { activateNotifs } from '../components/notif/activate.js'

// Primer ingreso, antes del tour y la encuesta (spec 12.6): ofrecer las notificaciones. Nunca es
// obligatorio: cualquier botón sigue. El prompt nativo sale del toque en "Activar" (los
// navegadores lo exigen). En iOS sin la app instalada no hay push web: se explica cómo instalarla.
// Para qué sirven: según lo que el gym tiene prendido (clases, cuotas) y si el socio tiene rutina.
export default function NotificationsStep({ kind, onDone }) {
  const [busy, setBusy] = useState(false)
  const reasons = useNotifReasons()
  const activate = async () => {
    setBusy(true)
    await activateNotifs()
    onDone()
  }

  return <div className="view notif-step">
    <div className="notif-step-icon"><Icon name="bell" size={32} /></div>
    {kind === 'ios-install' ? <>
      <h1>{t('Instalá la app para recibir avisos')}</h1>
      <p className="muted">{t('En iPhone y iPad, las notificaciones solo llegan si la app está en tu pantalla de inicio.')}</p>
      <IosInstallSteps />
      <div className="notif-step-actions">
        <Button variant="primary" onClick={onDone}>{t('Entendido')}</Button>
      </div>
    </> : <>
      <h1>{t('¿Activamos las notificaciones?')}</h1>
      <p className="muted">{t('Te avisamos {0}. Nada de publicidad.', joinReasons(reasons))}</p>
      <div className="notif-step-actions">
        <Button variant="primary" disabled={busy} onClick={activate}>{busy ? t('Activando…') : t('Activar')}</Button>
        <Button variant="ghost" className="dim" disabled={busy} onClick={onDone}>{t('Ahora no')}</Button>
      </div>
    </>}
    <div className="dim small notif-step-foot">{t('Lo podés cambiar cuando quieras en Ajustes → Notificaciones.')}</div>
  </div>
}
