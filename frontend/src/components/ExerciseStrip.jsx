import { useEffect, useRef } from 'react'
import { exOr } from '../lib/exercises.js'
import { exerciseNameFor, t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Thumb } from './Media.jsx'

// The whole session at a glance, one card per unit (a superset is one card with its exercises
// side by side). Still images only, never gifs: several animations at once cost data and
// battery, and the gif already plays in the card below. Tap a unit to go there; its "⋯" holds
// replace / remove, and the last card reorders the session.
export default function ExerciseStrip({ entries, units, current, onJump, onMore, onReorder }) {
  const ref = useRef(null)
  useEffect(() => {
    const box = ref.current
    const el = box?.querySelector('[data-current="true"]')
    if (box && el) box.scrollLeft = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2
  }, [current])
  return <div className="xstrip" ref={ref} data-noswipe>
    {units.map((u, k) => {
      const done = u.every(i => entries[i].sets.length > 0 && entries[i].sets.every(s => s.done))
      const names = u.map(i => exerciseNameFor(exOr(entries[i].id))).join(' + ')
      return <div key={u.map(i => i + ':' + entries[i].id).join('+')} className={'xs-unit' + (u.length > 1 ? ' ss' : '') + (k === current ? ' cur' : done ? ' done' : '')}
        data-current={k === current}>
        <button type="button" className="xs-main" aria-current={k === current ? 'step' : undefined}
          aria-label={done ? t('Done: {0}', names) : names} onClick={() => onJump(k)}>
          <span className="xs-thumbs">
            {u.map(i => <Thumb key={i + ':' + entries[i].id} ex={exOr(entries[i].id)} />)}
            {u.length > 1 && <span className="xs-link"><Icon name="link" /></span>}
            {done && <span className="xs-ok"><Icon name="check" /></span>}
          </span>
          <span className="xs-name">{names}</span>
        </button>
        {onMore && <button type="button" className="xs-more" aria-label={t('Options for {0}', names)} onClick={() => onMore(k)}><Icon name="more" /></button>}
      </div>
    })}
    {onReorder && units.length > 1 && <button type="button" className="xs-unit xs-reorder" onClick={onReorder}>
      <Icon name="grip" /><span className="xs-name">{t('Reorder')}</span>
    </button>}
  </div>
}
