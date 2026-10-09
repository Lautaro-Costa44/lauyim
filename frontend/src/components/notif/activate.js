// "Activar" desde cualquier lugar que ofrece los avisos (hoja de contexto, cartel, descanso):
// pide el permiso (tiene que salir de un toque) y avisa cómo quedó. true si quedaron activos.
import { useUI } from '../../store/useUI.js'
import { enablePush } from '../../lib/push.js'
import { errorText } from '../../lib/errors.js'
import { t } from '../../lib/i18n.js'

export async function activateNotifs() {
  const toast = useUI.getState().toast
  try {
    await enablePush()
    toast(t('Avisos activados'))
    return true
  } catch (e) {
    toast(e?.denied
      ? t('Bloqueaste los avisos. Para activarlos, mirá Ajustes → Notificaciones.')
      : errorText(e, t('No se pudieron activar los avisos')))
    return false
  }
}
