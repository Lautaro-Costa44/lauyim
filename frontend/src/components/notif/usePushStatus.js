// Estado de los avisos en este dispositivo (lib/notif-ask.js → pushStatus), al día: se vuelve a
// leer al activarlos o apagarlos (PUSH_CHANGED) y al volver a la app (el permiso se puede cambiar
// desde la configuración del navegador o del celular). null mientras se lee.
import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { pushStatus, notifReasons } from '../../lib/notif-ask.js'
import { PUSH_CHANGED } from '../../lib/push.js'

export function usePushStatus() {
  const [status, setStatus] = useState(null)
  useEffect(() => {
    let alive = true
    const read = () => pushStatus().then(s => { if (alive) setStatus(s) }).catch(() => {})
    const onVisible = () => { if (document.visibilityState === 'visible') read() }
    read()
    window.addEventListener(PUSH_CHANGED, read)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.removeEventListener(PUSH_CHANGED, read)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return status
}

// Para qué sirven los avisos para este socio en este gym.
export function useNotifReasons() {
  const classes = useStore(s => !!s.config?.classes_available)
  const billing = useStore(s => s.billingEnabled !== false && !!s.billing?.hasPlan)
  const routine = useStore(s => Object.values(s.S?.week || {}).some(Boolean))
  return notifReasons({ classes, billing, routine })
}

// "a, b y c"
export const joinReasons = list => list.length < 2 ? list[0] || '' : list.slice(0, -1).join(', ') + ' y ' + list.at(-1)
