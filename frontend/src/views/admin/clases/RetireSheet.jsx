// Sacar una clase semanal del horario, desde la hoja de una fecha: solo ese día de la semana (si la
// clase tiene más de uno) o la clase entera. Las fechas que vienen se borran (no quedan como
// suspendidas), se avisa a los anotados y se borran las reservas fijas; las pasadas quedan en el
// historial. Para un solo día está "Suspender este día".
import { useEffect, useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { t } from '../../../lib/i18n.js'
import { errorText } from '../../../lib/errors.js'
import { classesApi } from '../../../lib/classes.js'
import { Button, Segmented } from '../../../components/ui.jsx'
import Icon from '../../../components/Icon.jsx'

const ui = () => useUI.getState()
const WEEKDAYS_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados']

function Retire({ occ, onDone, close }) {
  const [info, setInfo] = useState(null)
  const [scope, setScope] = useState('slot')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    classesApi.retirePreview({ slotId: occ.slotId }).then(d => { setInfo(d); if (d.class.slots < 2) setScope('class') })
      .catch(e => { ui().toast(errorText(e, t('Failed to load'))); close() })
  }, [])
  if (!info) return <div className="dim small">{t('Loading…')}</div>
  const pick = scope === 'slot' ? info.slot : info.class
  const day = `${t(WEEKDAYS_PLURAL[info.slot.weekday])} ${info.slot.start}`
  const save = async () => {
    setBusy(true)
    try {
      const r = scope === 'slot' ? await classesApi.deleteSlot(info.slot.id) : await classesApi.archiveType(info.class.id)
      ui().toast(r.notified ? t('Eliminada. Avisamos a {0}.', r.notified === 1 ? t('1 persona') : t('{0} personas', r.notified)) : t('Eliminada'))
      onDone && onDone()
      ui().closeAll()
    } catch (e) { ui().toast(errorText(e, t('No se pudo eliminar'))); setBusy(false) }
  }
  return <div className="class-retire">
    <h3>{t('Eliminar del horario')}</h3>
    {info.class.slots > 1 && <Segmented value={scope} onChange={setScope}
      options={[{ value: 'slot', label: t('Solo los {0}', day) }, { value: 'class', label: t('Toda la clase') }]} />}
    <div className="class-closure-preview small" role="status">
      <Icon name="info" />
      <div>
        {scope === 'slot' ? t('{0} deja de darse los {1}.', occ.name, day) : t('{0} deja de darse (todos sus días).', info.class.name)}{' '}
        {pick.dates === 0 ? t('No hay fechas próximas con reservas.')
          : t('{0} {1}.', pick.dates === 1 ? t('Se borra 1 fecha') : t('Se borran {0} fechas', pick.dates),
              pick.people ? t('y le avisamos a {0}', pick.people === 1 ? t('1 persona') : t('{0} personas', pick.people)) : t('(no hay nadie anotado)'))}
        {' '}{t('Las reservas fijas se borran; lo que ya pasó queda en el historial.')}
      </div>
    </div>
    <Button variant="danger" icon="trash" disabled={busy} onClick={save}>{t('Eliminar')}</Button>
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}

export function retireSheet(occ, { onDone } = {}) {
  ui().openSheet(close => <Retire occ={occ} onDone={onDone} close={close} />)
}
