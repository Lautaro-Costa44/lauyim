// iPhone/iPad: el push web existe solo con la app en la pantalla de inicio. Los pasos los usan el
// primer ingreso (NotificationsStep) y el cartel de Inicio.
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { Button } from '../ui.jsx'

export function IosInstallSteps() {
  return <ol className="notif-step-list">
    <li>{t('Tocá el botón Compartir de Safari (el cuadrado con la flecha hacia arriba).')}</li>
    <li>{t('Elegí "Agregar a inicio" y confirmá.')}</li>
    <li>{t('Abrí la app desde el ícono nuevo y activá las notificaciones en Ajustes.')}</li>
  </ol>
}

export const iosInstallSheet = () => useUI.getState().openSheet(close => <>
  <h3>{t('Instalá la app para recibir avisos')}</h3>
  <p className="muted">{t('En iPhone y iPad, las notificaciones solo llegan si la app está en tu pantalla de inicio.')}</p>
  <IosInstallSteps />
  <Button variant="primary" onClick={close}>{t('Entendido')}</Button>
</>)
