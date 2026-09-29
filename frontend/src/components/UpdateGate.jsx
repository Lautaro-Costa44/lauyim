import { useState } from 'react'
import { useUpdate, getUpdater } from '../lib/update.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// Por qué no se aplicó al tocar el aviso (lib/update.js → trySafeApply).
const NOT_NOW = {
  active: 'Se va a actualizar cuando termines el entrenamiento.',
  pending: 'Se va a actualizar cuando se sincronicen tus cambios.',
  form: 'Se va a actualizar cuando cierres la ventana abierta.',
}

// Versión crítica: modal centrado que bloquea todo (única interrupción). Si no, el aviso discreto
// cuando una versión nueva lleva horas esperando un momento seguro.
export default function UpdateGate() {
  const { critical, criticalFailed, stale } = useUpdate()
  const [busy, setBusy] = useState(false)
  if (critical) return <div className="update-gate" role="alertdialog" aria-modal="true" aria-labelledby="update-gate-title">
    <div className="mback" />
    <div className="center">
      <div className="confirm-dialog">
        <div className="confirm-dialog-icon"><Icon name="download" /></div>
        <h3 id="update-gate-title">{t('Hay una actualización necesaria')}</h3>
        <div className="confirm-dialog-message muted">
          {criticalFailed
            ? t('No se pudo actualizar. Cerrá la app por completo y volvé a abrirla.')
            : t('Esta versión de la app ya no es compatible. Actualizá para seguir usándola; tus datos no se pierden.')}
        </div>
        <div className="confirm-dialog-actions">
          <Button variant="primary" icon="download" disabled={busy} onClick={async () => { setBusy(true); await getUpdater()?.forceUpdate() }}>
            {busy ? t('Actualizando…') : t('Actualizar')}
          </Button>
        </div>
      </div>
    </div>
  </div>
  if (!stale) return null
  const tap = async () => {
    const result = await getUpdater()?.trySafeApply()
    if (NOT_NOW[result]) useUI.getState().toast(t(NOT_NOW[result]))
  }
  return <button className="update-pill" onClick={tap}><Icon name="download" />{t('Nueva versión disponible')}</button>
}
