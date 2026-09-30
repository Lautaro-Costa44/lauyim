import { useState } from 'react'
import { imgSrc, gifSrc } from '../lib/exercises.js'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Big autoplaying animation; tap toggles to the still frame. `compact` shrinks it (superset cards).
// Custom exercises have no media — the animation stays blank by design (issue #11).
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts (issue #12).
//
// `steps` (las instrucciones del ejercicio): botón "Ver instrucciones" en la esquina del gif; al
// tocarlo, la lista se despliega debajo con animación y se vuelve a plegar. No pausa el gif.
export default function Media({ ex, id, compact, minimizable, steps }) {
  const [playing, setPlaying] = useState(true)
  const [showSteps, setShowSteps] = useState(false)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  if (!ex || !ex.gif) return null
  const mini = minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  const hasSteps = Array.isArray(steps) && steps.length > 0
  const stepsId = 'steps-' + ex.id
  return (<>
    <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '') + (hasSteps && showSteps ? ' with-steps' : '')} id={id} onClick={() => setPlaying(p => !p)}>
      {hasSteps && (
        <button type="button" className="gifsteps" aria-expanded={showSteps} aria-controls={stepsId}
          onClick={e => { e.stopPropagation(); setShowSteps(v => !v) }}>
          <Icon name="list" />{showSteps ? t('Ocultar instrucciones') : t('Ver instrucciones')}
        </button>
      )}
      <img decoding="async" src={playing ? gifSrc(ex) : imgSrc(ex)} alt={exerciseNameFor(ex)} />
      {minimizable && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {!mini && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
    {hasSteps && <div className={'exsteps' + (showSteps ? ' open' : '')} id={stepsId} aria-hidden={!showSteps}>
      <div className="exsteps-in"><ol className="steps-list">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
    </div>}
  </>)
}

export function Thumb({ ex }) {
  if (!ex || !ex.img) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  return <img className="thumb" loading="lazy" decoding="async" src={imgSrc(ex)} alt="" />
}
