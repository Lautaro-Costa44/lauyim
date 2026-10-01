import { useNavigate, useLocation } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'
import { usePrivacyInfo } from '../components/PrivacyNotice.jsx'
import { TermsNotice } from '../components/TermsNotice.jsx'

// /#/terminos: pública, como el aviso de privacidad (sin sesión, y también con la licencia vencida
// o la cuota bloqueada).
export default function Terms() {
  const navigate = useNavigate()
  const loc = useLocation()
  const info = usePrivacyInfo()
  // Entrada directa (link compartido): no hay a dónde volver en el historial de la app.
  const back = () => loc.key && loc.key !== 'default' ? navigate(-1) : navigate('/home', { replace: true })
  return <div className="narrow privacy-page">
    <Button size="sm" icon="chevronLeft" onClick={back}>{t('Volver')}</Button>
    <h1 className="privacy-title">{t('Términos y condiciones')}</h1>
    {info?.gymName && <div className="muted" style={{ marginBottom: 14 }}>{info.gymName}</div>}
    <TermsNotice info={info} onSupport={() => import('../sheets.jsx').then(m => m.supportSheet())} />
  </div>
}
