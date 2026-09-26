import { useState } from 'react'
import { useUI } from '../store/useUI.js'
import { enablePush } from '../lib/push.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// Primer ingreso, antes del tour y la encuesta (spec 12.6): ofrecer las notificaciones. Nunca es
// obligatorio: cualquier botón sigue. El prompt nativo sale del toque en "Activar" (los
// navegadores lo exigen). En iOS sin la app instalada no hay push web: se explica cómo instalarla.
export default function NotificationsStep({ kind, onDone }) {
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)
  const activate = async () => {
    setBusy(true)
    try {
      await enablePush()
      toast(t('Notifications on'))
    } catch {
      // Permiso negado o sin conexión: se puede activar después desde Ajustes.
      toast(t('No se activaron. Podés hacerlo cuando quieras desde Ajustes.'))
    }
    onDone()
  }

  return <div className="view notif-step">
    <div className="notif-step-icon"><Icon name="bell" size={32} /></div>
    {kind === 'ios-install' ? <>
      <h1>{t('Instalá la app para recibir avisos')}</h1>
      <p className="muted">{t('En iPhone y iPad, las notificaciones solo llegan si la app está en tu pantalla de inicio.')}</p>
      <ol className="notif-step-list">
        <li>{t('Tocá el botón Compartir de Safari (el cuadrado con la flecha hacia arriba).')}</li>
        <li>{t('Elegí "Agregar a inicio" y confirmá.')}</li>
        <li>{t('Abrí la app desde el ícono nuevo y activá las notificaciones en Ajustes.')}</li>
      </ol>
      <div className="notif-step-actions">
        <Button variant="primary" onClick={onDone}>{t('Entendido')}</Button>
      </div>
    </> : <>
      <h1>{t('¿Activamos las notificaciones?')}</h1>
      <p className="muted">{t('Te avisamos cuando termina el descanso entre series, los días que tenés entrenamiento y antes de que venza tu cuota. Nada de publicidad.')}</p>
      <div className="notif-step-actions">
        <Button variant="primary" disabled={busy} onClick={activate}>{busy ? t('Activando…') : t('Activar')}</Button>
        <Button variant="ghost" className="dim" disabled={busy} onClick={onDone}>{t('Ahora no')}</Button>
      </div>
    </>}
    <div className="dim small notif-step-foot">{t('Lo podés cambiar cuando quieras en Ajustes → Notificaciones.')}</div>
  </div>
}
