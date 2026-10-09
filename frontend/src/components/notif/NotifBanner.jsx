// Inicio, arriba de "Tu semana": volver a ofrecer los avisos a quien no los activó. Mismo cartel
// que el del cierre (ClosureBanner), uno solo a la vez: el del cierre gana. Cuándo aparece lo
// decide bannerKind (notif-ask.js): espera, pausa de 14 días con la ✕, máximo 3 veces.
import { useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { bannerKind, snoozeAsk } from '../../lib/notif-ask.js'
import { t } from '../../lib/i18n.js'
import { Button } from '../ui.jsx'
import Icon from '../Icon.jsx'
import { usePushStatus, useNotifReasons, joinReasons } from './usePushStatus.js'
import { activateNotifs } from './activate.js'

export default function NotifBanner({ busy = false }) {
  const uid = useStore(s => s.user?.id)
  const active = useStore(s => !!s.S?.active)
  const status = usePushStatus()
  const reasons = useNotifReasons()
  const [, force] = useState(0)
  const kind = bannerKind({ uid, status, busy: busy || active })
  if (!kind) return null
  const hide = () => { snoozeAsk(uid); force(n => n + 1) }
  const howTo = () => import('./IosInstallSheet.jsx').then(m => m.iosInstallSheet())
  return <div className="closure-banner notif-banner" role="status">
    <Icon name="bell" />
    <div className="grow">
      <b>{kind === 'ios-install' ? t('Instalá la app para recibir avisos') : t('Activá los avisos')}</b>
      <div className="small muted">{kind === 'ios-install'
        ? t('En iPhone los avisos llegan solo con la app en tu pantalla de inicio.')
        : t('Te avisamos {0}.', joinReasons(reasons))}</div>
      <div className="notif-banner-acts">
        {kind === 'ios-install'
          ? <Button size="sm" variant="primary" onClick={howTo}>{t('Cómo instalarla')}</Button>
          : <Button size="sm" variant="primary" icon="bell" onClick={activateNotifs}>{t('Activar')}</Button>}
      </div>
    </div>
    <button type="button" className="iconbtn" onClick={hide} aria-label={t('Ocultar aviso')}><Icon name="xmark" /></button>
  </div>
}
