// La hoja de la racha (al tocar la llama, en Inicio o en el calendario): semanas seguidas, qué
// falta esta semana y las últimas 8 semanas. Una semana cuenta cuando se llega a los entrenos del
// plan con el que empezó (las clases suman).
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { streakSummary } from '../lib/history.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

const ui = () => useUI.getState()
const dm = iso => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`
const DAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const dayName = iso => DAY_SHORT[new Date(iso + 'T12:00:00').getDay()]

function Streak({ close, onCalendar }) {
  const S = useStore(s => s.S)
  const { streak, weeks, current } = streakSummary(S)
  const pending = current.pendingDays.map(dayName)
  const status = current.complete ? t('Esta semana ya está cumplida.')
    : current.target ? t('Esta semana {0} de {1}', current.done, current.target) + (current.left
      ? ' · ' + (current.left === 1 ? t('falta 1') : t('faltan {0}', current.left)) + (pending.length ? ` (${pending.length > 1 ? t('{0} y {1}', pending.slice(0, -1).join(', '), pending.at(-1)) : pending[0]})` : '')
      : '')
    : t('Entrená al menos una vez esta semana para sumarla.')
  return <div className="streak-sheet">
    <div className="streak-hero">
      <span className={'streak-flame' + (streak ? ' on' : '')}><Icon name="flame" /></span>
      <div>
        <div className="streak-num">{streak === 1 ? t('1 semana seguida') : streak ? t('{0} semanas seguidas', streak) : t('Empezá tu racha')}</div>
        <div className="small muted">{status}</div>
      </div>
    </div>
    <div className="streak-weeks" role="list" aria-label={t('Últimas 8 semanas')}>
      {weeks.map((w, i) => {
        const now = i === weeks.length - 1
        return <div key={w.monday} role="listitem" className={'streak-week' + (w.complete ? ' ok' : '') + (now ? ' now' : '')}
          title={`${dm(w.monday)}: ${w.done}/${w.target || 1}${w.classes ? ' · ' + t('{0} clases', w.classes) : ''}`}>
          <span className="streak-block" style={!w.complete && w.target ? { '--p': Math.min(1, w.done / w.target) } : undefined} />
          <span className="streak-label">{now ? t('Hoy') : dm(w.monday)}</span>
        </div>
      })}
    </div>
    <div className="small dim streak-help">{t('Verde: semana cumplida. Cuenta cuando llegás a los entrenos de tu plan; las clases suman. Cada semana usa el plan con el que la empezaste.')}</div>
    <Button variant="tinted" icon="calendar" onClick={() => { close(); onCalendar && onCalendar() }}>{t('Ver el calendario')}</Button>
  </div>
}

export function streakSheet({ onCalendar } = {}) {
  ui().openSheet(close => <Streak close={close} onCalendar={onCalendar} />)
}
