// La hoja de la racha (al tocar la llama, en Inicio o en el calendario): la llama con las semanas
// seguidas (su color sube con la racha), la mejor racha y esta semana día por día, con lo que falta.
// Una semana cuenta cuando se llega a los entrenos del plan con el que empezó (las clases suman).
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { streakSummary } from '../lib/history.js'
import { DAYS, isoOf } from '../lib/format.js'
import { classesByDate } from '../lib/classes.js'
import { useMyClasses } from './useMyClasses.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

const ui = () => useUI.getState()
const DAY_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const weekdayOf = iso => new Date(iso + 'T12:00:00').getDay()

// "hoy", "mañana" o "el jueves".
function dayWord(iso, today) {
  if (iso === today) return t('hoy')
  const tomorrow = new Date(today + 'T12:00:00'); tomorrow.setDate(tomorrow.getDate() + 1)
  if (iso === isoOf(tomorrow)) return t('mañana')
  return t('el {0}', t(DAY_LONG[weekdayOf(iso)]))
}
// "a, b y c" (o "a, b o c" cuando alcanza con algunos de esos días).
const joinWords = (words, sep) => words.length > 1 ? `${words.slice(0, -1).join(', ')} ${sep} ${words.at(-1)}` : words[0]

// Qué le falta a la semana, en una línea.
function weekLine(cur, today) {
  if (cur.complete) return t('Semana cumplida ✓')
  const words = cur.pendingDays.map(iso => dayWord(iso, today))
  const left = cur.left === 1 ? t('Falta 1') : t('Faltan {0}', cur.left)
  if (!words.length) return cur.left === 1 ? t('Falta 1 entreno para sumar la semana.') : t('Faltan {0} entrenos para sumar la semana.', cur.left)
  return `${left}: ${joinWords(words, cur.left < words.length ? t('o') : t('y'))}`
}

function Streak({ close, onCalendar }) {
  const S = useStore(s => s.S)
  const myClasses = useMyClasses()
  const now = new Date()
  const { streak, best, level, next, current } = streakSummary(S, now, classesByDate(myClasses?.occurrences, S.workouts))
  const today = current.days.find(d => d.today)?.iso
  const routineOf = id => id ? S.routines.find(r => r.id === id) || null : null
  const sub = streak && streak >= best ? t('Tu mejor racha')
    : best ? (best === 1 ? t('Tu mejor racha: 1 semana') : t('Tu mejor racha: {0} semanas', best))
    : t('Cumplí los entrenos de tu plan esta semana para prenderla.')
  return <div className={'streak-sheet lv' + level}>
    <div className="streak-hero">
      <div className="streak-flame" aria-hidden="true"><Icon name="flame" /><b>{streak}</b></div>
      <div className="streak-num">{streak === 1 ? t('1 semana seguida') : streak ? t('{0} semanas seguidas', streak) : t('Empezá tu racha')}</div>
      <div className="small muted">{sub}</div>
    </div>
    <div className="streak-now">
      <div className="streak-now-head">{t('Esta semana')} · {t('{0} de {1}', current.done, current.target)}</div>
      <div className="streak-days" role="list">
        {current.days.map(d => {
          // Lo planeado se ve con sus puntos, como en Inicio: la rutina (gris) y la clase (en su color).
          const r = routineOf(d.routineId), cls = d.classes[0]
          const what = [r?.name, cls?.name].filter(Boolean).join(' + ')
          return <div key={d.iso} role="listitem" className={'streak-day' + (d.done ? ' done' : d.planned ? ' plan' : '') + (d.today ? ' today' : '') + (d.past ? ' past' : '')}
          aria-label={`${t(DAY_LONG[weekdayOf(d.iso)])}${d.done ? ' · ' + t('Entrenado') : what ? ' · ' + what : ''}`} title={what || undefined}>
          <span className="streak-dot">{d.done ? <Icon name="check" />
            : d.planned ? <span className="dots">{d.routineId && <i className="dot plan" />}{cls && <i className="dot cls" style={{ background: cls.color || 'var(--acc)' }} />}</span>
            : d.today ? t('hoy') : null}</span>
          <span className="streak-day-lbl">{t(DAYS[weekdayOf(d.iso)]).charAt(0)}</span>
        </div>
        })}
      </div>
      <div className="small muted streak-left">{weekLine(current, today)}</div>
    </div>
    {streak > 0 && next && <div className="small dim streak-next">{t('La llama cambia de color a las {0} semanas · faltan {1}', next, next - streak)}</div>}
    <div className="small dim streak-help">{t('Una semana suma cuando llegás a los entrenos de tu plan. Las clases cuentan.')}</div>
    <Button variant="tinted" icon="calendar" onClick={() => { close(); onCalendar && onCalendar() }}>{t('Ver el calendario')}</Button>
  </div>
}

export function streakSheet({ onCalendar } = {}) {
  ui().openSheet(close => <Streak close={close} onCalendar={onCalendar} />)
}
