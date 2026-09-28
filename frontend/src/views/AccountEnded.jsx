import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// La cuenta se dio de baja con la app abierta (o al abrirla): los datos de este dispositivo ya se
// borraron (store/useStore.js → endSession). Mismo patrón que MembershipBlocked.
const MESSAGES = {
  account_disabled: ['Tu cuenta fue desactivada', 'Consultá en recepción.'],
  account_rejected: ['Tu cuenta no fue habilitada', 'Consultá en recepción.'],
  account_deleted: ['Tu cuenta fue eliminada', 'Si fue un error, consultá en recepción.'],
}

export default function AccountEnded() {
  const reason = useStore(s => s.accountEnded)
  const dismiss = useStore(s => s.dismissAccountEnded)
  const [title, sub] = MESSAGES[reason] || MESSAGES.account_disabled
  return <div className="view account-ended" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', padding: 24, textAlign: 'center' }}>
    <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'color-mix(in srgb, var(--danger) 16%, transparent)', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
      <Icon name="lock" size={32} />
    </div>
    <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 10 }}>{t(title)}</h1>
    <p className="muted" style={{ fontSize: 15, maxWidth: 400, lineHeight: 1.5, marginBottom: 8 }}>{t(sub)}</p>
    <p className="dim small" style={{ maxWidth: 360, lineHeight: 1.45, marginBottom: 24 }}>{t('Los datos de la app se borraron de este dispositivo.')}</p>
    <div style={{ width: '100%', maxWidth: 320 }}>
      <Button variant="primary" onClick={dismiss}>{t('Volver al inicio')}</Button>
    </div>
  </div>
}
