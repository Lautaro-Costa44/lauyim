import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { askInContext, snoozeAsk } from '../lib/notif-ask.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'
import { usePushStatus } from './notif/usePushStatus.js'
import { activateNotifs } from './notif/activate.js'

const clock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')

// One bar, two meanings: the rest countdown between sets, and the work countdown during a
// timed set (issue #16). They are mutually exclusive by construction — startWork() stops any
// running rest — so the bar can never have to show both, and a work set gets its own colour
// plus a "Done" that logs the time actually held.
export default function RestTimer() {
  const timer = useUI(s => s.timer)
  const work = useUI(s => s.work)
  const { addRest, stopRest, finishWorkEarly, stopWork } = useUI()
  const on = work || timer
  // Sin avisos: una línea para activarlos (el aviso de fin del descanso con la app en segundo
  // plano). No abre ninguna hoja: no corta el entreno. La ✕ cuenta como "Ahora no".
  const uid = useStore(s => s.user?.id)
  const status = usePushStatus()
  const [askHidden, setAskHidden] = useState(false)
  const askRest = !askHidden && askInContext(uid, status)
  // The bar is fixed above the tab bar and floats over whatever is beneath it — during a
  // rest that was the next set's row. Extra bottom padding lets the page scroll clear.
  useEffect(() => {
    document.body.classList.toggle('resting', !!on)
    return () => document.body.classList.remove('resting')
  }, [!!on])
  if (!on) return null
  const pct = (on.left / on.total) * 100

  if (work) return (
    <div id="timer" className="working">
      <div className="t">{clock(work.left)}</div>
      <div className="grow">
        {work.label && <div className="lbl">{work.label}</div>}
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
      </div>
      <Button size="sm" onClick={stopWork}>{t('Cancel')}</Button>
      <Button size="sm" variant="primary" icon="check" onClick={finishWorkEarly}>{t('Done')}</Button>
    </div>
  )
  // Three controls plus the clock don't fit one line on a phone — at 360px the bar is left
  // with about 30px and stops saying anything. So the rest variant stacks: clock and bar
  // read at a glance, controls get their own row. −15 and +15 sit together in number-line
  // order; Skip is pushed to the far edge, away from the button you tap to buy more time.
  return (
    <div id="timer" className="rest">
      <div className="head">
        <div className="t">{clock(timer.left)}</div>
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
      </div>
      <div className="acts">
        <Button size="sm" icon="minus" onClick={() => addRest(-15)}>15s</Button>
        <Button size="sm" icon="plus" onClick={() => addRest(15)}>15s</Button>
        <Button size="sm" variant="primary" className="skip" onClick={stopRest}>{t('Skip')}</Button>
      </div>
      {askRest && <div className="rest-notif">
        <Icon name="bell" />
        <span className="grow">{t('Avisarme cuando termine el descanso')}</span>
        <button type="button" className="rest-notif-on" onClick={activateNotifs}>{t('Activar')}</button>
        <button type="button" className="iconbtn" onClick={() => { snoozeAsk(uid); setAskHidden(true) }} aria-label={t('Ocultar aviso')}><Icon name="xmark" /></button>
      </div>}
    </div>
  )
}
