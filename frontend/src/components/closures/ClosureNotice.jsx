// El día que el gimnasio está cerrado, al abrir la app (y al volver a primer plano): un cartel con
// "Aceptar", una vez por cierre y por día. "Hoy" es la fecha del gimnasio que manda el servidor,
// nunca el reloj del celular. No interrumpe un entreno en curso. Además carga los cierres
// (useClosures) para la semana, el calendario y la racha.
import { useEffect, useRef } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { useClosures, loadClosures } from '../../store/useClosures.js'
import { closureOn } from '../../lib/closures.js'
import { t } from '../../lib/i18n.js'
import { Button } from '../ui.jsx'
import Icon from '../Icon.jsx'

const ui = () => useUI.getState()
const seenKey = (c, today) => `closure-seen:${c.id}:${today}`
const readSeen = key => { try { return localStorage.getItem(key) === '1' } catch { return false } }
const markSeen = key => { try { localStorage.setItem(key, '1') } catch { /* sin storage: puede volver a salir */ } }

// El cierre a avisar hoy (o null): hay uno que toca `today` y todavía no se vio ese día.
export function shouldShowNotice({ today, closures, seen }) {
  if (!today) return null
  const c = closureOn(closures, today)
  return c && !seen(seenKey(c, today)) ? c : null
}

const LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const dayLabel = iso => { const d = new Date(iso + 'T12:00:00'); return `${LONG[d.getDay()]} ${d.getDate()}` }

function Notice({ closure, today, close }) {
  const classes = useStore(s => !!s.config?.classes_available)
  const ok = () => { markSeen(seenKey(closure, today)); close() }
  return <div className="closure-notice">
    <div className="closure-notice-icon" aria-hidden="true"><Icon name="lock" /></div>
    <h3>{t('Hoy el gimnasio está cerrado')}</h3>
    <div className="muted">{[closure.reason, dayLabel(today)].filter(Boolean).join(' · ')}</div>
    <p className="small muted">{classes ? t('Las clases de hoy se suspendieron.') + ' ' : ''}{t('Podés seguir usando la app: entrenar en casa o cargar tus comidas.')}</p>
    <Button variant="primary" onClick={ok}>{t('Aceptar')}</Button>
  </div>
}

function check() {
  const { today, closures } = useClosures.getState()
  if (useStore.getState().S?.active || ui().sheets.length) return
  const c = shouldShowNotice({ today, closures, seen: readSeen })
  if (c) ui().openSheet(close => <Notice closure={c} today={today} close={close} />, { kind: 'center' })
}

export default function ClosureNotice() {
  const on = useStore(s => !!s.user && s.pulled)
  const active = useStore(s => !!s.S?.active)
  useEffect(() => {
    if (!on) return
    let alive = true
    const run = () => loadClosures().then(() => { if (alive) check() })
    run()
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive = false; document.removeEventListener('visibilitychange', onVisible) }
  }, [on])
  // Terminó el entreno: si hoy está cerrado y no se vio, ahora sí (solo al terminar: al montar manda
  // la carga de arriba, con el "hoy" recién pedido al servidor).
  const wasActive = useRef(active)
  useEffect(() => {
    if (on && wasActive.current && !active) check()
    wasActive.current = active
  }, [on, active])
  return null
}
