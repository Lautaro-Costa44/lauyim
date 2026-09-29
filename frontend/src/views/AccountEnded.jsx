import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// La cuenta se dio de baja con la app abierta (o al abrirla, o al intentar entrar): los datos de
// este dispositivo ya se borraron (store/useStore.js → endSession). Mismo patrón que MembershipBlocked.
// El motivo queda guardado en el dispositivo: se ve también al abrir sin conexión, antes del login.
const MESSAGES = {
  account_disabled: ['Tu cuenta fue desactivada', 'Consultá en recepción.'],
  account_rejected: ['Tu cuenta no fue habilitada', 'Consultá en recepción.'],
  account_deleted: ['Tu cuenta fue eliminada', 'Si fue un error, consultá en recepción.'],
}
// Resultado de "Verificar de nuevo" que no cambia de pantalla.
const RESULTS = {
  ended: 'Tu cuenta sigue desactivada. Consultá en recepción.',
  offline: 'Sin conexión. Conectate a internet para verificar tu cuenta.',
}

export default function AccountEnded() {
  const reason = useStore(s => s.accountEnded)
  const verify = useStore(s => s.verifyAccountEnded)
  const dismiss = useStore(s => s.dismissAccountEnded)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [title, sub] = MESSAGES[reason] || MESSAGES.account_disabled
  const check = async () => {
    setBusy(true); setResult(null)
    try { setResult(await verify()) } finally { setBusy(false) }
  }
  return <div className="view account-ended" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', padding: 24, textAlign: 'center' }}>
    <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'color-mix(in srgb, var(--danger) 16%, transparent)', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
      <Icon name="lock" size={32} />
    </div>
    <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 10 }}>{t(title)}</h1>
    <p className="muted" style={{ fontSize: 15, maxWidth: 400, lineHeight: 1.5, marginBottom: 8 }}>{t(sub)}</p>
    <p className="dim small" style={{ maxWidth: 360, lineHeight: 1.45, marginBottom: 20 }}>{t('Los datos de la app se borraron de este dispositivo.')}</p>
    {RESULTS[result] && <div className="card small" role="status" style={{ maxWidth: 320, width: '100%', marginBottom: 16, textAlign: 'left' }}>{t(RESULTS[result])}</div>}
    <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Button variant="primary" icon="reset" disabled={busy} onClick={check}>{busy ? t('Verificando…') : t('Verificar de nuevo')}</Button>
      <Button variant="ghost" disabled={busy} onClick={dismiss}>{t('Ingresar con otra cuenta')}</Button>
    </div>
  </div>
}
