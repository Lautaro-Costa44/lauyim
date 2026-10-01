import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Aviso al staff del abono de lauyim (api/license.js): amarillo mientras está por vencer, rojo en
// mora con la fecha de suspensión. Los socios nunca lo ven (el servidor les manda license: null).
// Se puede cerrar por el día; al cambiar de estado vuelve a aparecer.
export const SUPPORT_EMAIL = 'soporte@lauyim.online'

const dayMonth = iso => (/^\d{4}-(\d{2})-(\d{2})$/.exec(iso || '') || []).slice(1).reverse().join('/')
const monthName = ym => {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) return ''
  return new Date(ym + '-15T12:00:00').toLocaleDateString('es-AR', { month: 'long' })
}

export function licenseMessage(license) {
  if (!license) return null
  if (license.status === 'due') return license.reason === 'expired'
    ? t('La licencia de lauyim vence el {0}.', dayMonth(license.dueDate))
    : t('El abono de lauyim de {0} vence el {1}.', monthName(license.month), dayMonth(license.dueDate))
  if (license.status === 'overdue') return t('El abono de lauyim de {0} está vencido. El servicio se suspende el {1}.', monthName(license.month), dayMonth(license.suspendDate))
  return null
}

const todayKey = () => new Date().toISOString().slice(0, 10)

export default function LicenseBanner() {
  const license = useStore(s => s.license)
  const message = licenseMessage(license)
  const key = license ? `lauyim_license_banner_${license.status}_${license.month || license.dueDate}` : null
  const [hidden, setHidden] = useState(() => { try { return !!key && localStorage.getItem(key) === todayKey() } catch { return false } })
  if (!message || hidden) return null
  const close = () => {
    try { localStorage.setItem(key, todayKey()) } catch { /* storage off */ }
    setHidden(true)
  }
  const subject = encodeURIComponent(t('Abono de lauyim') + ' - ' + window.location.hostname)
  return <div className={'license-banner ' + license.status} role="status">
    <Icon name={license.status === 'overdue' ? 'warning' : 'info'} />
    <div className="license-banner-text">
      <b>{message}</b>
      <span>{t('Si ya pagaste, avisanos y lo actualizamos:')} <a href={`mailto:${SUPPORT_EMAIL}?subject=${subject}`}>{SUPPORT_EMAIL}</a></span>
    </div>
    <button type="button" className="license-banner-x" aria-label={t('Cerrar por hoy')} onClick={close}><Icon name="xmark" /></button>
  </div>
}
