// Ofrecer los avisos justo cuando sirven: al reservar una clase o al quedar en la lista de espera.
// Primero esta hoja explica para qué; el permiso del sistema sale recién al tocar "Activar".
// Cerrarla sin activar (botón, gesto o fondo) cuenta como "Ahora no" (notif-ask.js).
import { useEffect, useRef } from 'react'
import { useUI } from '../../store/useUI.js'
import { useStore } from '../../store/useStore.js'
import { askInContext, pushStatus, snoozeAsk } from '../../lib/notif-ask.js'
import { t } from '../../lib/i18n.js'
import { Button } from '../ui.jsx'
import Icon from '../Icon.jsx'
import { activateNotifs } from './activate.js'

const COPY = {
  class: ['¿Te avisamos antes de la clase?', 'Te llega un aviso antes de que empiece y si cambia el horario o se suspende.'],
  waitlist: ['¿Te avisamos si se libera un lugar?', 'Si alguien cancela y te toca el lugar, te avisamos en el momento.'],
  supplement: ['¿Te avisamos para tus suplementos?', 'Te llega un aviso a la hora que elegiste, solo si todavía no lo marcaste.'],
}

function NotifAsk({ context, uid, close }) {
  const decided = useRef(false)
  useEffect(() => () => { if (!decided.current) snoozeAsk(uid) }, [uid])
  const [title, body] = COPY[context] || COPY.class
  const activate = async () => {
    decided.current = true
    await activateNotifs()
    close()
  }
  return <div className="notif-ask">
    <div className="notif-ask-icon"><Icon name="bell" /></div>
    <h3>{t(title)}</h3>
    <p className="muted">{t(body)}</p>
    <Button variant="primary" icon="bell" onClick={activate}>{t('Activar avisos')}</Button>
    <Button variant="ghost" className="dim" onClick={close}>{t('Ahora no')}</Button>
    <div className="dim small notif-ask-foot">{t('Nada de publicidad. Lo podés cambiar en Ajustes → Notificaciones.')}</div>
  </div>
}

// context: 'class' (se anotó, también fija o toda la semana) | 'waitlist' | 'supplement' (prendió un
// recordatorio de suplemento). No hace nada si los
// avisos ya están, están bloqueados, no hay soporte o el socio dijo "Ahora no" hace poco.
export async function maybeAskNotif(context) {
  const uid = useStore.getState().user?.id
  if (!uid) return
  const status = await pushStatus()
  if (!askInContext(uid, status)) return
  useUI.getState().openSheet(close => <NotifAsk context={context} uid={uid} close={close} />)
}
