import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { countSync } from '../lib/sync-queue.js'
import { fmtDateDMY } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// Bloqueo por cuota (Cuotas v1): pantalla completa, mismo patrón que LicenseExpired. El socio
// conserva la sesión y sus datos locales; lo que registró queda en la cola hasta que el gym
// registre el pago. Nunca se muestra a staff (App.jsx y el store lo filtran).
export default function MembershipBlocked() {
  const user = useStore(s => s.user)
  const billing = useStore(s => s.billing)
  const retryMembership = useStore(s => s.retryMembership)
  const signOut = useStore(s => s.signOut)
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)

  const retry = async () => {
    setBusy(true)
    try {
      if (!(await retryMembership())) toast(t('Tu cuota sigue vencida. Si ya pagaste, pedí en recepción que registren el pago.'))
    } catch {
      toast(t('No hay conexión. Probá de nuevo en un momento.'))
    }
    setBusy(false)
  }

  const logout = async () => {
    const pending = user ? await countSync(user.id) : 0
    if (!pending) return signOut()
    // sheets.jsx queda fuera del bundle inicial a propósito; se trae solo para este aviso.
    const { confirmSheet } = await import('../sheets.jsx')
    confirmSheet({
      title: t('¿Cerrar sesión?'),
      message: t('Tenés cambios sin sincronizar en este dispositivo. Si cerrás sesión ahora, los datos locales no sincronizados se pierden.'),
      confirmText: t('Cerrar sesión igual'), danger: true,
      onConfirm: () => signOut()
    })
  }

  return (
    <div className="view membership-blocked" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', padding: 24, textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'color-mix(in srgb, var(--danger) 16%, transparent)', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <Icon name="lock" size={32} />
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 10 }}>{t('Cuota vencida')}</h1>
      <p className="muted" style={{ fontSize: 15, maxWidth: 400, lineHeight: 1.5, marginBottom: 8 }}>
        {t('Tu cuota está vencida, renovala en recepción para poder seguir usando la app')}
      </p>
      {billing?.dueDate && <p className="dim small" style={{ marginBottom: 24 }}>
        {[billing.planName, t('Venció el {0}', fmtDateDMY(billing.dueDate))].filter(Boolean).join(' · ')}
      </p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 320 }}>
        <Button variant="primary" disabled={busy} onClick={retry}>{busy ? t('Verificando…') : t('Reintentar')}</Button>
        <Button variant="ghost" className="dim" disabled={busy} onClick={logout}>{t('Cerrar sesión')}</Button>
      </div>
      <div className="dim small" style={{ marginTop: 28, maxWidth: 360, lineHeight: 1.45 }}>
        {t('Lo que registraste en este dispositivo se guarda y se sincroniza apenas se renueve la cuota.')}
      </div>
    </div>
  )
}
