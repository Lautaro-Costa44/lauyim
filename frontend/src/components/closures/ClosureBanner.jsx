// Inicio: aviso de un cierre desde 7 días antes hasta el último día. Con ✕ se oculta; durante los días
// del cierre vuelve como "Hoy el gimnasio está cerrado" (sin ✕).
import { useState } from 'react'
import { useClosures, useClosuresToday } from '../../store/useClosures.js'
import { upcomingClosure, closureLongLabel } from '../../lib/closures.js'
import { t } from '../../lib/i18n.js'
import Icon from '../Icon.jsx'

const hiddenKey = c => `closure-banner-hidden:${c.id}`
const isHidden = c => { try { return localStorage.getItem(hiddenKey(c)) === '1' } catch { return false } }

export default function ClosureBanner() {
  const closures = useClosures(s => s.closures)
  const today = useClosuresToday()
  const [, force] = useState(0)
  const c = upcomingClosure(closures, today)
  if (!c) return null
  const now = c.from <= today
  if (!now && isHidden(c)) return null
  const hide = () => { try { localStorage.setItem(hiddenKey(c), '1') } catch { /* sin storage */ } force(n => n + 1) }
  const label = closureLongLabel(c, today)
  const title = now ? t('Hoy el gimnasio está cerrado')
    : c.from === c.to ? t('{0} el gimnasio cierra', label.charAt(0).toUpperCase() + label.slice(1))
    : t('El gimnasio cierra {0}', label)
  return <div className="closure-banner" role="status">
    <Icon name="lock" />
    <div className="grow"><b>{title}</b>{c.reason && <div className="small muted">{c.reason}</div>}</div>
    {!now && <button type="button" className="iconbtn" onClick={hide} aria-label={t('Ocultar aviso')}><Icon name="xmark" /></button>}
  </div>
}
