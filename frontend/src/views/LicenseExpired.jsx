import Icon from '../components/Icon.jsx'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { SUPPORT_EMAIL } from '../components/LicenseBanner.jsx'

// Servicio suspendido (api/license.js): abono impago (reason 'unpaid') o corte fijo vencido
// ('expired'). El staff ve el motivo y cómo reactivarlo; el socio, solo que la app no está
// disponible: el atraso es entre el gimnasio y lauyim.
export default function LicenseExpired() {
  const user = useStore(s => s.user)
  const reason = useStore(s => s.licenseReason)
  const staff = !!(user?.admin || user?.owner)
  const title = staff
    ? (reason === 'unpaid' ? t('Servicio suspendido por falta de pago') : t('La licencia de lauyim venció'))
    : t('La app no está disponible')
  const text = staff
    ? (reason === 'unpaid'
      ? t('El abono de lauyim de este gimnasio está impago. Los datos de tus socios están guardados y no se perdió nada. Para reactivar el servicio, regularizá el pago y escribinos.')
      : t('El período de la licencia de este gimnasio terminó. Los datos de tus socios están guardados. Escribinos para renovarla.'))
    : t('La app de este gimnasio no está disponible por el momento. Tus datos están guardados. Consultá en la recepción.')
  const subject = encodeURIComponent(t('Reactivar el servicio') + ' - ' + window.location.hostname)
  return (
    <div className="narrow license-expired">
      <div className="license-expired-icon"><Icon name="lock" size={32} /></div>
      <h1 className="privacy-title">{title}</h1>
      <p className="muted">{text}</p>
      {staff && <a href={`mailto:${SUPPORT_EMAIL}?subject=${subject}`} className="btn primary license-expired-btn">
        <Icon name="mail" size={18} />{t('Escribir a lauyim')}
      </a>}
      <p className="dim small">{t('lauyim')} · <a className="privacy-link" href="#/terminos">{t('Términos')}</a> · <a className="privacy-link" href="#/privacidad">{t('Privacidad')}</a></p>
    </div>
  )
}
